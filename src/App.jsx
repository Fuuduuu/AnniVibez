import { useState, useSyncExternalStore } from 'react';
import { AV, FONT } from './design/tokens';
import { BussTab } from './components/BussTab';
import LooTab from './components/LooTab';
import { PaeviikTab } from './components/PaeviikTab';
import { SeadedTab } from './components/SeadedTab';
import { KoduTab, VeelTab } from './components/ShellViews';
import { KalenderTab } from './components/KalenderTab';
import { EventDialog } from './components/EventDialog';
import { useHouseholdEvents } from './calendar/useHouseholdEvents';
import { ShellIcon } from './components/ShellIcon';
import { useSettings } from './hooks/useSettings';
import { useSavedPlaces, createLegacyPlacesRepository, PLACES_KEY } from './hooks/useSavedPlaces';
import { StorageStatus, StorageNotice, StorageSplash, RELOAD_COPY } from './components/StorageStatus';
import { createEventRepository, EVENT_STORAGE_KEY } from './calendar/eventRepository';
import { createHouseholdRepository, HOUSEHOLD_KEY } from './waste/householdRepository';
import { canWriteLegacy } from './storage/storageAuthority.js';
import { createReplicaRepositories } from './storage/replicaRepositories.js';
import './design/shell.css';
import './design/calendar.css';
import './design/waste.css';
import { useHousehold } from './waste/useHousehold';
import { useReminders } from './reminders/useReminders';
import { withReminderDefault } from './reminders/preferences';
import { ReminderRuntime } from './components/ReminderRuntime';
import './design/reminders.css';

const TABS = [
  { id: 'kodu', label: 'Kodu' },
  { id: 'kalender', label: 'Kalender' },
  { id: 'buss', label: 'Buss' },
  { id: 'veel', label: 'Veel' },
  { id: 'seaded', label: 'Seaded' },
];

// ---- storage runtime (runtime cutover C6) ---------------------------------------------------------
// The C4 controller owns every authority decision. This runtime only forwards browser signals to it,
// mounts the mode-specific repositories once the controller has resolved LEGACY or READY, and refreshes
// domain snapshots. Every browser capability arrives by injection from src/main.jsx.

const WRITE_STATES = ['LEGACY', 'READY'];
const AUTO_RETRY_STATES = ['BLOCKED', 'AUTHORITY_HINT_PENDING'];
const DOMAINS = ['calendar', 'household', 'places'];
// Failures that mean "this tab no longer owns the storage": the writes stop and a reload is required.
const RELOAD_ERRORS = ['RuntimeAuthorityError', 'ReplicaConnectionLostError', 'ReplicaClosedError', 'LegacyWriteRefusedError', 'VersionError'];

// One domain's snapshot plus its refresh/mutation plumbing. The mode-specific repository is the only
// thing that differs; LEGACY loads synchronously, READY loads asynchronously and reports `loading`.
function createDomainStore(session, { domain, repository, legacyKeys, unreadable, emptyData }) {
  const subscribers = new Set();
  let generation = 0;
  let disposed = false;
  let loading = false;
  let data = null;
  let view = null;

  const compute = () => {
    const invalid = session.invalidDomains().includes(domain);
    const unreadableNow = invalid || (data !== null && data.writable === false);
    view = { loading, data, writable: !loading && !unreadableNow && session.writesEnabled(), error: unreadableNow ? unreadable : null };
  };
  const notify = () => { compute(); subscribers.forEach(callback => callback()); };
  const apply = (nextData, nextLoading = false) => { data = nextData; loading = nextLoading; notify(); };

  // A load only lands if no newer load or mutation started meanwhile; a failed refresh keeps the previous snapshot.
  async function refresh() {
    const mine = ++generation;
    let next = null;
    try { next = await repository.load(); } catch { next = null; }
    if (disposed || mine !== generation) return;
    if (next === null) { if (loading) apply(emptyData); return; }
    apply(next);
  }

  // Never reports success before the repository promise has settled, and never writes from a React snapshot.
  async function mutate(run, saveFailed) {
    if (!session.writesEnabled()) throw new Error(RELOAD_COPY);
    let result;
    try { result = await run(repository); }
    catch (error) { throw session.mapWriteError(error, saveFailed); }
    generation += 1;
    apply(result);
    session.committed(domain);
    return result;
  }

  if (session.mode === 'LEGACY') data = repository.load();
  else loading = true;
  compute();
  session.register({ domain, legacyKeys, refresh });
  if (session.mode === 'READY') refresh();

  return {
    getSnapshot: () => view,
    subscribe: callback => { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
    mutate, recompute: notify,
    dispose: () => { disposed = true; },
  };
}

export function createStorageRuntime({ controller, storage, windowTarget, documentTarget, channel = null, newId, clock, reload }) {
  const listeners = new Set();
  const registrations = new Set();
  let snapshot = { state: controller.getState(), result: controller.getResult(), session: null };
  let session = null;
  let sessions = 0;
  let started = false;
  let bootPromise = null;

  let signalTail = Promise.resolve();
  function enqueue(task) {
    const next = signalTail.then(task, task);
    signalTail = next.catch(() => {});
    return next;
  }
  const forward = signal => enqueue(() => controller.handleRuntimeSignal(signal));
  const retry = () => {
    if (controller.getState() === 'BOOTING') return bootPromise;
    bootPromise = controller.retry();
    return bootPromise;
  };
  const actions = {
    retry,
    confirmStorageLost: () => (controller.getState() === 'STORAGE_LOST' ? controller.confirmStorageLost() : undefined),
    confirmRevertStorageLost: () => (controller.getState() === 'REVERT_STORAGE_LOST' ? controller.confirmRevertStorageLost() : undefined),
    reload,
  };

  // LEGACY writes go through the accepted hint guard: a non-null or unreadable hint refuses the write and
  // hands the decision to C4, which moves the tab to RELOAD_REQUIRED. There is no retry and no fallback.
  const guardedLegacyStorage = () => ({
    getItem: key => storage.getItem(key),
    setItem: (key, value) => {
      if (!canWriteLegacy(storage)) {
        forward({ type: 'storage', key: null });
        const refused = new Error(RELOAD_COPY);
        refused.name = 'LegacyWriteRefusedError';
        throw refused;
      }
      storage.setItem(key, value);
    },
  });

  function createSession(mode, identity) {
    let invalid = [];
    const stores = {};
    const owned = {
      id: ++sessions, mode, stores,
      writesEnabled: () => WRITE_STATES.includes(controller.getState()),
      invalidDomains: () => invalid,
      register: entry => { registrations.add({ ...entry, session: owned }); },
      // Storage failures get the accepted per-domain copy; domain errors keep their own message; ownership
      // loss asks C4 to re-decide and shows the reload copy.
      mapWriteError: (error, saveFailed) => {
        if (controller.getState() === 'RELOAD_REQUIRED' || RELOAD_ERRORS.includes(error?.name)) {
          if (error?.name === 'RuntimeAuthorityError') forward({ type: 'authority-changed' });
          return new Error(RELOAD_COPY);
        }
        return error?.name === 'Error' ? error : new Error(saveFailed);
      },
      // Announced only after the mutation promise settled, so other tabs never read pre-commit state.
      committed: domain => {
        if (mode !== 'READY') return;
        try { channel?.postMessage({ type: 'committed', domain }); } catch { /* best-effort */ }
      },
      applyState: result => { invalid = result.domainInvalid ?? []; Object.values(stores).forEach(store => store.recompute()); },
      dispose: () => { Object.values(stores).forEach(store => store.dispose()); [...registrations].filter(entry => entry.session === owned).forEach(entry => registrations.delete(entry)); },
    };
    let repositories;
    if (mode === 'READY') {
      repositories = createReplicaRepositories({ replica: controller.replica, authority: identity, newId, clock });
      owned.switchId = identity.switchId;
    } else {
      const guarded = guardedLegacyStorage();
      repositories = { calendar: createEventRepository(guarded, newId), household: createHouseholdRepository(guarded), places: createLegacyPlacesRepository(guarded) };
    }
    stores.calendar = createDomainStore(owned, { domain: 'calendar', repository: repositories.calendar, legacyKeys: [EVENT_STORAGE_KEY],
      unreadable: 'Kalendri andmeid ei saanud lugeda. Salvestust ei kirjutata üle.', emptyData: { events: [], writable: false } });
    stores.household = createDomainStore(owned, { domain: 'household', repository: repositories.household, legacyKeys: [HOUSEHOLD_KEY],
      unreadable: 'Majapidamise andmeid ei saanud lugeda. Salvestust ei kirjutata üle.', emptyData: { profile: { name: '', address: '' }, writable: false } });
    stores.places = createDomainStore(owned, { domain: 'places', repository: repositories.places, legacyKeys: [PLACES_KEY],
      unreadable: 'Salvestatud kohti ei saanud lugeda. Salvestust ei kirjutata üle.', emptyData: { places: [], writable: false } });
    return owned;
  }

  const disposeSession = () => { session?.dispose(); session = null; };
  const publish = (state, result) => {
    snapshot = { state, result, session };
    listeners.forEach(listener => listener());
  };

  // C4 resolved a state. LEGACY and READY mount a session (READY captures the identity C4 itself mounted,
  // once); RELOAD_REQUIRED keeps the last session read-only; every other state unmounts the shared domains.
  function onControllerUpdate(result) {
    const state = result.state;
    if (state === 'LEGACY') {
      if (!session || session.mode !== 'LEGACY') { disposeSession(); session = createSession('LEGACY', null); }
    } else if (state === 'READY') {
      const identity = controller.getReadyAuthorityIdentity();
      if (!identity || typeof identity.switchId !== 'string' || !identity.switchId) {
        disposeSession();
        publish('STORAGE_UNAVAILABLE', { state: 'STORAGE_UNAVAILABLE', reason: 'ready-identity-missing' });
        return;
      }
      if (!session || session.mode !== 'READY' || session.switchId !== identity.switchId) { disposeSession(); session = createSession('READY', identity); }
    } else if (state !== 'RELOAD_REQUIRED') {
      disposeSession();
    }
    if (session) session.applyState(result);
    publish(state, result);
  }

  const refreshWhere = predicate => Promise.all([...registrations].filter(predicate).map(entry => entry.refresh()));

  // storage events go to C4 unfiltered (it decides which keys matter); a mounted LEGACY tab also re-reads
  // the domain whose legacy key changed. A READY tab never reloads a domain from a legacy key.
  const onStorage = event => enqueue(async () => {
    await controller.handleRuntimeSignal({ type: 'storage', key: event.key });
    if (controller.getState() === 'LEGACY') await refreshWhere(entry => event.key === null || entry.legacyKeys.includes(event.key));
  });
  const foreground = type => enqueue(async () => {
    await controller.handleRuntimeSignal({ type });
    if (AUTO_RETRY_STATES.includes(controller.getState())) await retry();
    // Without BroadcastChannel a foreground signal is the only cross-tab freshness path: re-read, never poll.
    if (!channel && controller.getState() === 'READY') await refreshWhere(() => true);
  });
  const onFocus = () => foreground('focus');
  const onVisibility = () => { if (documentTarget.visibilityState === 'visible') foreground('visibility'); };
  const onMessage = event => {
    const message = event?.data;
    if (message?.type === 'authority-changed') forward({ type: 'authority-changed' });
    else if (message?.type === 'committed' && DOMAINS.includes(message.domain)) {
      enqueue(async () => {
        if (controller.getState() === 'READY') await refreshWhere(entry => entry.domain === message.domain);
      });
    }
  };

  // Wire the runtime signals, then boot: shared domains mount only after the controller resolves a state.
  function start() {
    if (started) return bootPromise;
    started = true;
    controller.subscribe(onControllerUpdate);
    windowTarget.addEventListener('storage', onStorage);
    windowTarget.addEventListener('focus', onFocus);
    documentTarget.addEventListener('visibilitychange', onVisibility);
    channel?.addEventListener('message', onMessage);
    bootPromise = controller.boot();
    return bootPromise;
  }

  return {
    start, actions,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
  };
}

// ---- application shell ----------------------------------------------------------------------------

const SHELL_STYLE = {
  '--mm-bg': AV.bg, '--mm-surface': AV.card, '--mm-secondary': AV.bgWarm,
  '--mm-tint': AV.primaryTint, '--mm-primary': AV.primary, '--mm-strong': AV.primaryStrong,
  '--mm-ink': AV.text, '--mm-soft': AV.textSoft, '--mm-muted': AV.muted,
  '--mm-border': AV.border, '--mm-border-strong': AV.borderStrong,
  '--mm-shadow': AV.shadow, '--mm-shadow-md': AV.shadowMd, '--mm-display': FONT.display,
  '--mm-radius': `${AV.r}px`, '--mm-radius-sm': `${AV.rSm}px`,
  '--mm-bus': AV.bus, '--mm-bus-tint': AV.sageL, '--mm-warning': AV.warning, '--mm-quiet': AV.bgSoft,
  fontFamily: FONT.body, backgroundColor: AV.bg, color: AV.text,
};

function ShellFrame({ tab, active, onNavigate, banner, overlay, children }) {
  return (
    <div data-app-shell style={SHELL_STYLE}>
      {banner}
      <main key={tab} id="main-content" className="mm-main">
        {['loo', 'paevik'].includes(tab) && (
          <div className="mm-back">
            <button className="mm-button mm-button-secondary" onClick={() => onNavigate('veel')}>
              <ShellIcon name="back" />Tagasi: Veel
            </button>
          </div>
        )}
        {children}
      </main>
      {overlay}
      <nav className="mm-nav" aria-label="Põhinavigatsioon">
        <div className="mm-nav-inner">
          {TABS.map(t => <button key={t.id} type="button" aria-current={active === t.id ? 'page' : undefined}
            onClick={() => onNavigate(t.id)}>
            <span className="mm-nav-icon"><ShellIcon name={t.id} /></span>
            <span>{t.label}</span>
          </button>)}
        </div>
      </nav>
    </div>
  );
}

// Device-local destinations: they never depend on the shared domains, so they stay usable in every state.
function deviceTab(tab, savedPlaces, onNavigate) {
  if (tab === 'buss') return <BussTab savedPlaces={savedPlaces} />;
  if (tab === 'veel') return <VeelTab onNavigate={onNavigate} />;
  if (tab === 'loo') return <LooTab />;
  if (tab === 'paevik') return <PaeviikTab />;
  return null;
}

function useTabNavigation(onLeave) {
  const [tab, setTab] = useState('kodu');
  const [settingsSection, setSettingsSection] = useState(null);
  const navigate = (next, section = null) => {
    onLeave?.();
    setSettingsSection(section);
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  return { tab, settingsSection, navigate };
}

// Shared domains mounted: LEGACY or READY session (read-only under RELOAD_REQUIRED).
function SharedApp({ session, state, result, actions, wasteLookup, notificationService }) {
  const [eventSelection, setEventSelection] = useState(null);
  const { tab, settingsSection, navigate } = useTabNavigation(() => setEventSelection(null));
  const calendar = useHouseholdEvents(session);
  const household = useHousehold(session);
  const reminders = useReminders(notificationService);
  const { profile, saveName } = useSettings();
  const { places, loading: placesLoading, writable: placesWritable, error: placesError, update: updatePlace } = useSavedPlaces(session);
  const active = ['loo', 'paevik'].includes(tab) ? 'veel' : tab;

  if (calendar.loading || household.loading || placesLoading) {
    return <div data-app-shell style={SHELL_STYLE}><StorageSplash /></div>;
  }

  const openAdd = (date,onSaved) => setEventSelection({date,onSaved,defaults:withReminderDefault({},reminders.preferences)});
  const openEvent = (item,onSaved) => setEventSelection({item,onSaved});
  const openWaste = date => setEventSelection({date,defaults:withReminderDefault({category:'waste',subtype:'mixed',recurrence:{frequency:'weekly',interval:1}},reminders.preferences)});
  const openSchedule = event => setEventSelection({item:{...event,eventId:event.id,occurrenceDate:event.date},seriesOnly:true});

  return (
    <ShellFrame tab={tab} active={active} onNavigate={navigate}
      banner={<StorageNotice state={state} result={result} actions={actions} />}
      overlay={<>
        {eventSelection && <EventDialog selection={eventSelection} calendar={calendar} onClose={() => setEventSelection(null)} />}
        <ReminderRuntime events={calendar.events} reminders={reminders} />
      </>}>
      {tab === 'kodu' && <KoduTab savedPlaces={places} onNavigate={navigate} calendar={calendar} onAdd={openAdd} onOpen={openEvent} />}
      {tab === 'kalender' && <KalenderTab calendar={calendar} onAdd={openAdd} onOpen={openEvent} />}
      {deviceTab(tab, places, navigate)}
      {tab === 'seaded' && <SeadedTab profile={profile} saveName={saveName} places={places} placesWritable={placesWritable} placesError={placesError}
        updatePlace={updatePlace} initialSection={settingsSection} household={household} calendar={calendar}
        onAddWaste={openWaste} onOpenEvent={openEvent} onSchedule={openSchedule} wasteLookup={wasteLookup} reminders={reminders} />}
    </ShellFrame>
  );
}

// No shared session (blocking or recovery state): the shared destinations show the storage status and no
// shared hook is mounted; Buss and the device-local destinations stay usable with no saved places.
function LimitedShell({ state, result, actions }) {
  const { tab, navigate } = useTabNavigation();
  const active = ['loo', 'paevik'].includes(tab) ? 'veel' : tab;
  const device = deviceTab(tab, [], navigate);
  return (
    <ShellFrame tab={tab} active={active} onNavigate={navigate}>
      {device ?? <div className="mm-page"><StorageStatus state={state} result={result} actions={actions} /></div>}
    </ShellFrame>
  );
}

export default function MajamajandusApp({ runtime, wasteLookup, notificationService }) {
  if (!runtime) throw new Error('MajamajandusApp requires the storage runtime created by src/main.jsx');
  const { state, result, session } = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  if (state === 'BOOTING' || state === 'REVERTING') return <div data-app-shell style={SHELL_STYLE}><StorageSplash /></div>;
  if (session) return <SharedApp key={session.id} session={session} state={state} result={result} actions={runtime.actions}
    wasteLookup={wasteLookup} notificationService={notificationService} />;
  return <LimitedShell state={state} result={result} actions={runtime.actions} />;
}
