import { createCalendarSyncStore } from './calendarSyncStore.js';
import { readDeviceLink, deviceLinkUrl } from './deviceLink.js';
import { isClientUpgradeRequired, MERGE_EVIDENCE_HEADERS } from './clientCapabilities.js';
import { calendarMutationBlocked, isOversizedCalendarConflict, isUncertainCalendarConflict } from './calendarOutbox.js';
import { digestCanonicalCalendarMutation } from '../../shared/calendarMutationDigest.js';

const mutationStatusPath = '/api/sync/mutation-status';
const recoveryView = ({ conflicts }) => ({
  oversizedEventIds: conflicts.filter(isOversizedCalendarConflict).map(record => record.entityId),
  uncertainEventIds: conflicts.filter(isUncertainCalendarConflict).map(record => record.entityId),
  fieldConflictEventIds: conflicts.filter(item => item.result?.code === 'FIELD_OVERLAP').map(record => record.entityId),
});
const noRecovery = recoveryView({ conflicts: [] });
const sizeWarning = 'Sündmus on sünkroonimiseks liiga mahukas. Sündmus on seadmes alles. Ava sündmus kalendris.';
const unknownWarning = 'Sündmuse eelmise sünkroonimise tulemus on kinnitamata. Muudatused on seadmes alles.';
const fieldWarning = 'Sama sündmuse välja muudeti ka teises seadmes. Mõlemad versioonid on alles.';

function recoveryMessage({ uncertainEventIds, fieldConflictEventIds, oversizedEventIds }) {
  if (uncertainEventIds.length) return unknownWarning;
  if (fieldConflictEventIds.length) return fieldWarning;
  return oversizedEventIds.length ? sizeWarning : null;
}

// Device credentials are private to this closure and IndexedDB auth, never part of the UI snapshot.
export function createCalendarSync({ replica, authority, fetchImpl, newId, clock, initialDeviceLink = null, isReady = () => true, onCommitted = () => {} }) {
  const store = createCalendarSyncStore({ replica, authority, newId, clock, isReady: () => !disposed && isReady() });
  const listeners = new Set();
  let incomingLink = readDeviceLink(initialDeviceLink);
  let view = { status: 'unset', active: false, ready: isReady(), loaded: false,
    setupBlocked: false, setupPending: false, error: null, recoveryCode: null, ...noRecovery,
    hasIncomingLink: typeof initialDeviceLink === 'string', deviceLinkUrl: null, deviceLinkExpiresAt: null, linkPending: false };
  let running;
  let enabling = false;
  let disposed = false;
  let rerun = false;
  let retryRequested = false;
  const publish = patch => {
    if (disposed) return;
    view = { ...view, ...patch, ready: isReady() };
    listeners.forEach(listener => listener());
  };
  async function api(path, auth, body) {
    if (!isReady() || disposed) throw new Error('Storage is not READY');
    const mergeCapable = path === '/api/sync/push' || path.startsWith(mutationStatusPath + '?');
    let response;
    try { response = await fetchImpl(path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(auth ? { Authorization: `Bearer ${auth.deviceToken}` } : {}),
        ...(mergeCapable ? MERGE_EVIDENCE_HEADERS : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      credentials: 'omit', cache: 'no-store', redirect: 'error' });
    } catch {
      const error = new Error('Network unavailable');
      error.network = true;
      throw error;
    }
    if (!response.ok) {
      const error = new Error('Sync request failed');
      error.status = response.status;
      try { error.code = (await response.json())?.error?.code; } catch { /* status remains authoritative */ }
      throw error;
    }
    return response.json();
  }
  async function confirmOriginal(mutation, auth) {
    if (!mutation) return;
    let proof;
    try {
      const digest = await digestCanonicalCalendarMutation(mutation);
      const query = new URLSearchParams({ mutationId: mutation.mutationId, entityId: mutation.entityId, digest });
      proof = await api(`${mutationStatusPath}?${query}`, auth);
    } catch {
      // Offline or an older server: preserve the exact original, and let unrelated work proceed.
      return;
    }
    if (proof?.outcome !== 'COMMITTED') return;
    const result = proof.result;
    const nextRevision = mutation.baseRevision + 1;
    if (!Number.isSafeInteger(result?.revision)) return;
    if (result.status === 'APPLIED' && result.revision === nextRevision) {
      await store.acknowledge(mutation.mutationId, result.revision);
    } else if (result.status === 'MERGED' && mutation.operation === 'UPDATE' && result.revision > nextRevision && result.merge) {
      await store.acknowledge(mutation.mutationId, result.revision, result.merge);
    }
  }
  async function recoverSize(entityId, auth) {
    const original = await store.recoverOversized(entityId);
    if (original) await confirmOriginal(original, auth);
  }
  async function pushAttempt({ item, body, bytes }, auth) {
    let response;
    try { response = await api('/api/sync/push', auth, body); }
    catch (error) {
      if (error.status !== 413) throw error;
      const uncertain = await store.rejectPushSize(item, bytes, error.code);
      if (uncertain) await confirmOriginal(uncertain, auth);
      else await recoverSize(item.entityId, auth);
      return;
    }
    if (!Array.isArray(response.results) || response.results.length !== 1 || response.results[0].mutationId !== item.mutationId) {
      throw new TypeError('Invalid push acknowledgement');
    }
    const result = response.results[0].status === 'REPLAYED' ? response.results[0].result : response.results[0];
    if (['APPLIED', 'MERGED'].includes(result?.status)) {
      await store.acknowledge(item.mutationId, result.revision, result.status === 'MERGED' ? result.merge ?? null : undefined);
    } else if (['REJECTED', 'CONFLICT'].includes(result?.status)) {
      const uncertain = await store.reject(item.mutationId, result);
      if (uncertain) await confirmOriginal(uncertain, auth);
    }
    else throw new TypeError('Invalid mutation result');
  }
  async function runOnce(retryUncertain) {
    if (disposed || !isReady()) return;
    let current = await store.snapshot();
    if (!current.auth && !enabling && current.state.setupStatus === 'claiming') {
      await store.recoverInterruptedClaim();
      current = await store.snapshot();
    }
    if (!current.auth) {
      if (enabling) return;
      const claimUnknown = ['claiming', 'claim-unknown'].includes(current.state.setupStatus);
      publish({ status: current.state.setupStatus ? 'attention' : 'unset', active: false,
        loaded: true, setupBlocked: !!current.state.setupStatus, ...noRecovery,
        error: current.state.setupStatus ? claimUnknown
          ? 'Seadme ühendamise tulemust ei saanud kinnitada. Küsi esimesest seadmest uus link.'
          : 'Majapidamise loomise tulemust ei saanud kinnitada. Uut majapidamist automaatselt ei looda.' : null });
      return;
    }
    publish({ status: 'syncing', active: true, loaded: true, setupBlocked: false, hasIncomingLink: false,
      error: null, ...recoveryView(current) });
    try {
      await store.beginAttempt();
      for (const conflict of current.conflicts) {
        if (isUncertainCalendarConflict(conflict)) {
          await confirmOriginal(conflict.mutation, current.auth);
          if (retryUncertain && conflict.mutation) {
            const attempt = await store.attempt(conflict.mutation.mutationId, true);
            if (attempt) {
              try { await pushAttempt(attempt, current.auth); }
              catch (error) {
                if (!(error.network || error.status >= 500)) throw error;
              }
            }
          }
        } else if (isOversizedCalendarConflict(conflict)) await recoverSize(conflict.entityId, current.auth);
      }
      while (true) {
        const latest = await store.snapshot();
        const conflicts = new Map(latest.conflicts.map(record => [record.entityId, record]));
        const queued = latest.outbox.find(item => !calendarMutationBlocked(conflicts.get(item.entityId), item.mutationId));
        if (!queued) break;
        const attempt = await store.attempt(queued.mutationId);
        if (!attempt) continue;
        if (attempt.blocked) {
          if (attempt.uncertain) await confirmOriginal(attempt.blocked, current.auth);
          else await recoverSize(attempt.blocked.entityId, current.auth);
          continue;
        }
        await pushAttempt(attempt, current.auth);
      }
      const state = (await store.snapshot()).state;
      if (!state.bootstrapCompleted) {
        const response = await api('/api/sync/bootstrap', current.auth);
        await store.applyRemote(response.calendarEvents, response.cursor, true);
      } else {
        try {
          const response = await api(`/api/sync/pull?after=${state.serverCursor}`, current.auth);
          if (!Array.isArray(response.changes) || response.changes.some(change => change.entityType !== 'calendar_event')) throw new TypeError('Invalid calendar delta');
          await store.applyRemote(response.changes.map(change => change.record), response.cursor);
        } catch (error) {
          if (error.status !== 409 || error.code !== 'RESYNC_REQUIRED') throw error;
          const response = await api('/api/sync/bootstrap', current.auth);
          await store.applyRemote(response.calendarEvents, response.cursor, true);
        }
      }
      onCommitted();
      const final = await store.snapshot();
      const recovery = recoveryView(final);
      const unresolved = final.conflicts.length > 0;
      publish({ status: unresolved ? 'attention' : 'synced', ...recovery,
        error: recoveryMessage(recovery) ?? (unresolved ? 'Kalendri muudatus vajab tähelepanu. Kohalik muudatus on alles.' : null) });
    } catch (error) {
      const latest = await store.snapshot().catch(() => null);
      const recovery = latest ? recoveryView(latest) : {
        oversizedEventIds: view.oversizedEventIds, uncertainEventIds: view.uncertainEventIds, fieldConflictEventIds: view.fieldConflictEventIds,
      };
      const otherConflicts = latest?.conflicts.some(record => !isOversizedCalendarConflict(record) && !isUncertainCalendarConflict(record));
      const attention = otherConflicts || !(error.network || error.status >= 500);
      onCommitted();
      const upgradeRequired = isClientUpgradeRequired(error);
      publish({ status: attention ? 'attention' : 'waiting', ...recovery, error: upgradeRequired
        ? 'Rakendus vajab uuendamist. Kalendri muudatused on seadmes alles. Pärast uuendust proovi uuesti.'
        : attention ? recoveryMessage(recovery) ?? 'Sünkroonimine vajab tähelepanu. Kalender on seadmes alles.'
        : 'Sünkroonimine ootab võrguühendust. Kalender on seadmes alles.' });
    }
  }
  function run() {
    if (running) { rerun = true; return running; }
    running = (async () => {
      do {
        rerun = false;
        const retryUncertain = retryRequested;
        retryRequested = false;
        await runOnce(retryUncertain);
      } while (rerun && !disposed && isReady());
    })().catch(() => publish({ status: 'attention', error: 'Sünkroonimine vajab tähelepanu. Kalender on seadmes alles.' })).finally(() => { running = undefined; });
    return running;
  }
  function retryUncertain() {
    retryRequested = true;
    return run();
  }
  async function enable(input) {
    if (disposed || !isReady() || enabling || view.hasIncomingLink) return false;
    enabling = true;
    publish({ status: 'syncing', setupPending: true, error: null });
    let requested = false;
    let knownRejection = false;
    try {
      await store.setupStatus('creating');
      requested = true;
      const response = await fetchImpl('/api/auth/create-household', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: input.userName,
          householdName: input.householdName, deviceName: input.deviceName, householdAddress: input.householdAddress?.trim() || null }),
        credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (!response.ok) {
        knownRejection = response.status === 400 || response.status === 413;
        throw new Error('Create failed');
      }
      const result = await response.json();
      const auth = { key: 'device', deviceToken: result.deviceSession.token, householdId: result.household.id,
        userId: result.account.userId, sessionId: result.deviceSession.id };
      if (typeof result.recovery?.code !== 'string' || !result.recovery.code) throw new TypeError('Invalid recovery code');
      await store.install(auth);
      publish({ active: true, recoveryCode: result.recovery.code });
      onCommitted();
      await run();
      return true;
    } catch {
      if (requested) await store.setupStatus(knownRejection ? null : 'unknown').catch(() => {});
      publish({ status: 'attention', loaded: true, setupBlocked: !knownRejection, error: knownRejection
        ? 'Kontrolli nime ja majapidamise andmeid ning proovi uuesti.'
        : 'Majapidamise loomise tulemust ei saanud kinnitada. Uut majapidamist automaatselt ei looda.' });
      return false;
    } finally { enabling = false; publish({ setupPending: false }); }
  }
  async function createDeviceLink() {
    if (disposed || !isReady() || view.linkPending) return null;
    publish({ linkPending: true, error: null, deviceLinkUrl: null, deviceLinkExpiresAt: null });
    try {
      const current = await store.snapshot();
      if (!current.auth) throw new Error('Sync is not configured');
      const result = await api('/api/auth/device-link', current.auth, {});
      const link = deviceLinkUrl(result.linkToken);
      if (!Number.isFinite(Date.parse(result.expiresAt))) throw new TypeError('Invalid link expiry');
      publish({ deviceLinkUrl: link, deviceLinkExpiresAt: result.expiresAt });
      return link;
    } catch {
      publish({ error: 'Seadme linki ei saanud luua. Proovi uuesti.' });
      return null;
    } finally { publish({ linkPending: false }); }
  }
  async function claimDevice({ link, deviceName } = {}) {
    if (disposed || !isReady() || enabling) return false;
    const linkToken = readDeviceLink(link ?? incomingLink);
    const name = typeof deviceName === 'string' ? deviceName.trim() : '';
    if (!linkToken || !name || Array.from(name).length > 120) {
      publish({ error: 'Sisesta kehtiv seadme link või kood ja seadme nimi.' });
      return false;
    }
    enabling = true;
    publish({ status: 'syncing', setupPending: true, error: null });
    let requested = false;
    let knownRejection = false;
    let previousStatus;
    try {
      previousStatus = (await store.snapshot()).state.setupStatus;
      await store.setupStatus('claiming');
      requested = true;
      let result;
      try { result = await api('/api/auth/claim-device', null, { linkToken, deviceName: name }); }
      catch (error) { knownRejection = error.status === 400 || error.status === 413; throw error; }
      await store.installJoined({ key: 'device', deviceToken: result.deviceSession.token, householdId: result.household.id,
        userId: result.account.userId, sessionId: result.deviceSession.id });
      incomingLink = null;
      publish({ active: true, hasIncomingLink: false, setupBlocked: false });
      onCommitted();
      await run();
      return true;
    } catch {
      if (requested) await store.setupStatus(knownRejection ? previousStatus : 'claim-unknown').catch(() => {});
      publish({ status: 'attention', loaded: true, setupBlocked: !knownRejection || !!previousStatus,
        error: knownRejection ? 'Link on kasutatud, aegunud või vigane. Küsi esimesest seadmest uus link.'
          : 'Seadme ühendamise tulemust ei saanud kinnitada. Küsi esimesest seadmest uus link.' });
      return false;
    } finally { enabling = false; publish({ setupPending: false }); }
  }
  return { enable, run, retryUncertain, createDeviceLink, claimDevice, getSnapshot: () => view,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    dismissRecovery: () => publish({ recoveryCode: null }),
    dismissIncomingLink: () => { incomingLink = null; publish({ hasIncomingLink: false }); },
    refreshAvailability: () => publish({}),
    dispose: () => { disposed = true; listeners.clear(); },
  };
}
