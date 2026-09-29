import { createCalendarSyncStore } from './calendarSyncStore.js';

// Device credentials are private to this closure and IndexedDB auth, never part of the UI snapshot.
export function createCalendarSync({ replica, authority, fetchImpl, newId, clock, isReady = () => true, onCommitted = () => {} }) {
  const store = createCalendarSyncStore({ replica, authority, newId, clock, isReady: () => !disposed && isReady() });
  const listeners = new Set();
  let view = { status: 'unset', active: false, ready: isReady(), loaded: false,
    setupBlocked: false, setupPending: false, error: null, recoveryCode: null };
  let running;
  let enabling = false;
  let disposed = false;
  let rerun = false;
  const publish = patch => {
    if (disposed) return;
    view = { ...view, ...patch, ready: isReady() };
    listeners.forEach(listener => listener());
  };
  async function api(path, auth, body) {
    if (!isReady() || disposed) throw new Error('Storage is not READY');
    let response;
    try { response = await fetchImpl(path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(auth ? { Authorization: `Bearer ${auth.deviceToken}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: 'omit', cache: 'no-store', redirect: 'error' });
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
  async function runOnce() {
    if (disposed || !isReady()) return;
    const current = await store.snapshot();
    if (!current.auth) {
      publish({ status: current.state.setupStatus ? 'attention' : 'unset', active: false,
        loaded: true, setupBlocked: !!current.state.setupStatus,
        error: current.state.setupStatus ? 'Majapidamise loomise tulemust ei saanud kinnitada. Uut majapidamist automaatselt ei looda.' : null });
      return;
    }
    publish({ status: 'syncing', active: true, loaded: true, setupBlocked: false, error: null });
    try {
      await store.beginAttempt();
      while (true) {
        const latest = await store.snapshot();
        const blocked = new Set(latest.conflicts.map(record => record.entityId));
        const queued = latest.outbox.find(item => !blocked.has(item.entityId));
        if (!queued) break;
        const item = await store.attempt(queued.mutationId);
        if (!item) continue;
        // One mutation per request preserves dependent revision ordering and stays below the cap of eight.
        const response = await api('/api/sync/push', current.auth, { mutations: [{ mutationId: item.mutationId,
          entityType: item.entityType, entityId: item.entityId, operation: item.operation,
          baseRevision: item.baseRevision, patch: item.patch }] });
        if (!Array.isArray(response.results) || response.results.length !== 1 || response.results[0].mutationId !== item.mutationId) throw new TypeError('Invalid push acknowledgement');
        const result = response.results[0].status === 'REPLAYED' ? response.results[0].result : response.results[0];
        if (['APPLIED', 'MERGED'].includes(result?.status)) await store.acknowledge(item.mutationId, result.revision);
        else if (['REJECTED', 'CONFLICT'].includes(result?.status)) await store.reject(item.mutationId, result);
        else throw new TypeError('Invalid mutation result');
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
      const unresolved = (await store.snapshot()).conflicts.length > 0;
      publish({ status: unresolved ? 'attention' : 'synced', error: unresolved
        ? 'Kalendri muudatus vajab tähelepanu. Kohalik muudatus on alles.' : null });
    } catch (error) {
      const unresolved = await store.snapshot().then(current => current.conflicts.length > 0).catch(() => false);
      const attention = unresolved || !(error.network || error.status >= 500);
      onCommitted();
      publish({ status: attention ? 'attention' : 'waiting', error: attention
        ? 'Sünkroonimine vajab tähelepanu. Kalender on seadmes alles.'
        : 'Sünkroonimine ootab võrguühendust. Kalender on seadmes alles.' });
    }
  }
  function run() {
    if (running) { rerun = true; return running; }
    running = (async () => {
      do { rerun = false; await runOnce(); } while (rerun && !disposed && isReady());
    })().catch(() => publish({ status: 'attention', error: 'Sünkroonimine vajab tähelepanu. Kalender on seadmes alles.' })).finally(() => { running = undefined; });
    return running;
  }
  async function enable(input) {
    if (disposed || !isReady() || enabling) return false;
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
  return { enable, run, getSnapshot: () => view,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    dismissRecovery: () => publish({ recoveryCode: null }),
    refreshAvailability: () => publish({}),
    dispose: () => { disposed = true; listeners.clear(); },
  };
}
