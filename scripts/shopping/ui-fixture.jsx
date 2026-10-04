import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ShoppingTab } from '../../src/components/ShoppingTab.jsx';
import { ShoppingHomeCard } from '../../src/components/ShoppingHomeCard.jsx';
import { KoduTab, VeelTab } from '../../src/components/ShellViews.jsx';
import { AV, FONT } from '../../src/design/tokens.js';
import { emptyTimetable } from '../../src/timetable/model.js';
import { createStorageAuthorityController } from '../../src/storage/storageAuthority.js';
import { requestResult } from '../../src/storage/indexedDb.js';
import { createShoppingStore } from '../../src/shopping/shoppingStore.js';
import { createShoppingSync } from '../../src/shopping/sync.js';
import '../../src/design/shell.css';
import '../../src/design/calendar.css';
import '../../src/design/timetable.css';

// The fixture mounts production components on the real READY shopping store.
// Only IndexedDB abort/hold and network responses are controlled system boundaries.
const stamp = '2026-10-04T08:00:00.000Z';
const timetable = { ...emptyTimetable(), lessons: [{ id: 'ui-school', studentId: 'anni', source: 'local',
  weekday: 1, period: 1, subject: 'Matemaatika', start: '08:00', end: '08:45', room: '', teacher: '' }] };
const style = {
  '--mm-bg': AV.bg, '--mm-surface': AV.card, '--mm-secondary': AV.bgWarm,
  '--mm-tint': AV.primaryTint, '--mm-primary': AV.primary, '--mm-strong': AV.primaryStrong,
  '--mm-ink': AV.text, '--mm-soft': AV.textSoft, '--mm-muted': AV.muted,
  '--mm-border': AV.border, '--mm-border-strong': AV.borderStrong,
  '--mm-shadow': AV.shadow, '--mm-shadow-md': AV.shadowMd, '--mm-display': FONT.display,
  '--mm-radius': `${AV.r}px`, '--mm-radius-sm': `${AV.rSm}px`,
  '--mm-bus': AV.bus, '--mm-bus-tint': AV.sageL, '--mm-warning': AV.warning, '--mm-quiet': AV.bgSoft,
  fontFamily: FONT.body, backgroundColor: AV.bg, color: AV.text,
};

function Fixture({ store, sync, replica, controller }) {
  const storeView = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const syncView = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const [tab, setTab] = useState('shopping');
  const [settings, setSettings] = useState({});
  const operation = name => async (...args) => {
    window.__shoppingAction = name;
    try { return await store[name](...args); } finally { window.__shoppingAction = null; }
  };
  const shopping = { ...storeView, ...settings,
    sync: { ...syncView, pendingCount: storeView.pendingCount, conflictCount: storeView.conflicts.length, ...settings.sync },
    add: operation('add'), update: operation('update'), check: operation('check'), remove: operation('remove'), clearChecked: operation('clearChecked'),
    refresh: async () => { window.__shoppingRefreshed = true; await store.refresh(); await sync.run(); },
  };
  useEffect(() => {
    window.__shoppingFixture = {
      async seed(next) {
        await replica.transact(['shoppingItems','outbox','conflicts','syncState'], 'readwrite', async ({ stores }) => {
          const outbox = await requestResult(stores.outbox.getAll());
          const conflicts = await requestResult(stores.conflicts.getAll());
          stores.shoppingItems.clear(); stores.syncState.delete('shopping');
          for (const record of outbox) if (record.entityType === 'shopping_item') stores.outbox.delete(record.mutationId);
          for (const record of conflicts) if (record.entityType === 'shopping_item') stores.conflicts.delete(record.id);
        });
        await store.refresh();
        for (const entry of next) {
          const { id, checkedAt, createdAt, syncStatus, ...input } = entry;
          window.__shoppingSeedId = id;
          try { await store.add(input); } finally { delete window.__shoppingSeedId; }
          if (checkedAt) await store.check(id, true);
        }
      },
      configure(next) { setSettings(previous => ({ ...previous, ...next })); },
      navigate(next) { setTab(next); },
      store, sync, replica, controller,
      async installAuth() {
        const uuid = '60000000-0000-4000-8000-000000000001';
        await replica.putAuth({ key: 'device', householdId: `hld_${uuid}`, userId: `usr_${uuid}`, sessionId: `ses_${uuid}`, deviceToken: `m1s_${'A'.repeat(43)}` });
        await store.refresh();
      },
      async externalAdd(input) {
        const peer = createShoppingStore({ replica, authority: controller.getReadyAuthorityIdentity(),
          newId: () => crypto.randomUUID(), clock: () => stamp, isWritable: () => controller.getState() === 'READY' });
        try { await peer.refresh(); await peer.add(input); } finally { peer.dispose(); }
      },
    };
    return () => { delete window.__shoppingFixture; };
  }, []);
  return <div data-app-shell style={style}>
    <main className="mm-main">
      {tab === 'shopping' && <ShoppingTab shopping={shopping} />}
      {tab === 'home' && <KoduTab savedPlaces={[]} onNavigate={setTab} calendar={{events:[],writable:true,error:null}}
        onAdd={() => {}} onOpen={() => {}} timetable={timetable} homework={{items:[],writable:true,error:null}}
        shoppingHomeCard={<ShoppingHomeCard shopping={shopping} onOpen={() => setTab('shopping')} />} />}
      {tab === 'more' && <VeelTab onNavigate={setTab} />}
    </main>
  </div>;
}

async function start() {
  const newId = () => {
    if (window.__shoppingSeedId) { const id = window.__shoppingSeedId; delete window.__shoppingSeedId; return id; }
    return crypto.randomUUID();
  };
  window.__shoppingAborts = [];
  const controller = createStorageAuthorityController({ indexedDb: indexedDB, storage: localStorage, cryptoApi: crypto,
    newId: () => crypto.randomUUID(), clock: () => stamp, mode: 'forward' });
  const boot = await controller.boot();
  if (boot.state !== 'READY') throw Error(`Shopping UI fixture is not READY: ${boot.state}`);
  const replica = controller.replica;
  const transact = replica.transact.bind(replica);
  replica.transact = async (names, mode, body) => {
    const action = window.__shoppingAction;
    if (mode === 'readwrite' && names.includes('shoppingItems') && action && window.__shoppingHold === action) {
      await new Promise(resolve => { window.__shoppingRelease = resolve; });
    }
    return transact(names, mode, async context => {
      const result = await body(context);
      if (mode === 'readwrite' && names.includes('shoppingItems') && action && window.__shoppingFailure === action) {
        context.transaction.abort(); window.__shoppingAborts.push(action);
      }
      return result;
    });
  };
  const store = createShoppingStore({ replica, authority: controller.getReadyAuthorityIdentity(),
    newId, clock: () => stamp, isWritable: () => controller.getState() === 'READY' });
  await store.refresh();
  const sync = createShoppingSync({ store, isReady: () => controller.getState() === 'READY', fetchImpl: async (path, options = {}) => {
    if (window.__shoppingNetwork === 'offline') throw new TypeError('Controlled offline boundary');
    let response;
    if (path === '/api/shopping/bootstrap') response = { shoppingItems: [], cursor: 0 };
    else if (path === '/api/shopping/push') {
      const mutation = JSON.parse(options.body).mutations[0];
      response = { results: [{ mutationId: mutation.mutationId, status: window.__shoppingNetwork === 'conflict' ? 'CONFLICT' : 'APPLIED', revision: mutation.baseRevision + 1 }] };
    } else response = { changes: [], cursor: 1 };
    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  } });
  createRoot(document.querySelector('#root')).render(<Fixture store={store} sync={sync} replica={replica} controller={controller} />);
}
start();
