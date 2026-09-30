import { requestResult } from '../storage/indexedDb.js';
import { runReplicaMutation } from '../storage/runtimeWrites.js';
import { validateDeviceAuthRecord, validateCalendarSyncState, validateOutboxRecord } from '../storage/localReplica.js';
import { validateRuntimeRecord } from '../storage/runtimeRecords.js';
import { createHouseholdRepository } from '../waste/householdRepository.js';

const STORES = ['auth', 'householdProfile', 'calendarEvents', 'outbox', 'syncState', 'conflicts'];
const emptyState = () => ({ key: 'calendar', serverCursor: 0, bootstrapCompleted: false,
  lastSuccessfulSyncAt: null, lastAttemptAt: null, setupStatus: null });

async function read(stores) {
  const [auth, household, calendar, outbox, state, sequence, conflicts, archive] = await Promise.all([
    requestResult(stores.auth.get('device')), requestResult(stores.householdProfile.get('household')),
    requestResult(stores.calendarEvents.getAll()), requestResult(stores.outbox.index('bySequence').getAll()),
    requestResult(stores.syncState.get('calendar')), requestResult(stores.meta.get('outboxSequence')),
    requestResult(stores.conflicts.getAll()),
    requestResult(stores.meta.get('calendarBeforeDeviceLinkV1')),
  ]);
  if (auth !== undefined) validateDeviceAuthRecord(auth);
  const syncState = state ?? emptyState();
  validateCalendarSyncState(syncState);
  for (const record of calendar) validateRuntimeRecord('calendarEvents', record);
  const counter = sequence?.value ?? 0;
  if (!Number.isSafeInteger(counter) || counter < 0) throw new TypeError('Invalid outbox sequence');
  const calendarOutbox = outbox.filter(item => item.entityType === 'calendar_event');
  for (const item of calendarOutbox) validateOutboxRecord(item);
  return { auth, household, calendar, outbox: calendarOutbox, state: syncState, sequence: counter,
    conflicts: conflicts.filter(item => item.entityType === 'calendar_event'), archive };
}

export function createCalendarSyncStore({ replica, authority, clock, newId, isReady = () => true }) {
  const mutate = plan => {
    if (!isReady()) throw new Error('Storage is not READY');
    return runReplicaMutation({ replica, authority, domain: 'calendarSync', stores: STORES, read, plan });
  };
  const snapshot = () => replica.transact(['meta', ...STORES], 'readonly', ({ stores }) => read(stores));
  function setupStatus(status) {
    return mutate(current => {
      if (current.auth && ['unknown', 'claim-unknown'].includes(status)) return { puts: [], deletes: [], result: null };
      if (status === 'creating' && (current.auth || current.state.setupStatus)) throw new Error('Setup already started');
      if (status === 'claiming') {
        if (current.auth || ['creating', 'claiming'].includes(current.state.setupStatus)) throw new Error('Setup already started');
        if (current.archive && current.calendar.length) throw new Error('An earlier local calendar archive must be preserved');
      }
      return { puts: [{ store: 'syncState', record: { ...current.state, setupStatus: status } }], deletes: [], result: null };
    });
  }
  const recoverInterruptedClaim = () => mutate(current => {
    if (current.auth || current.state.setupStatus !== 'claiming') return { puts: [], deletes: [], result: null };
    return { puts: [{ store: 'syncState', record: { ...current.state, setupStatus: 'claim-unknown' } }], deletes: [], result: null };
  });
  function install(auth) {
    validateDeviceAuthRecord(auth);
    return mutate(current => {
      if (current.auth) throw new Error('Sync is already enabled');
      const stamp = clock();
      let sequence = current.sequence;
      const puts = [{ store: 'auth', record: auth }];
      for (const record of current.calendar) {
        if (record.syncStatus !== 'local' || record.revision !== 0 || record.deletedAt !== null) throw new Error('Initial OWNER calendar must be local');
        const queued = { mutationId: newId(), entityType: 'calendar_event', entityId: record.id,
          operation: 'CREATE', baseRevision: 0, patch: record.payload, createdAt: stamp,
          attemptCount: 0, lastAttemptAt: null, sequence: ++sequence };
        puts.push({ store: 'outbox', record: queued }, { store: 'calendarEvents', record: { ...record, syncStatus: 'pending' } });
      }
      const profile = current.household?.payload ?? { ...createHouseholdRepository({getItem: () => null}).load().profile, serverHouseholdId: null };
      puts.push({ store: 'householdProfile', record: { key: 'household', payload: { ...profile, serverHouseholdId: auth.householdId },
        revision: 0, updatedAt: stamp, deletedAt: null, syncStatus: 'local' } });
      puts.push({ store: 'meta', record: { key: 'outboxSequence', value: sequence } },
        { store: 'syncState', record: { ...emptyState(), lastAttemptAt: stamp } });
      return { puts, deletes: [], result: null };
    });
  }
  function installJoined(auth) {
    validateDeviceAuthRecord(auth);
    return mutate(current => {
      if (current.auth || current.state.setupStatus !== 'claiming') throw new Error('Device claim no longer owns setup');
      const stamp = clock();
      const puts = [{ store: 'auth', record: auth }];
      // Joining is not OWNER setup. Retain unrelated local work privately; never enqueue it for this household.
      if (current.calendar.length || current.outbox.length || current.conflicts.length) {
        if (current.archive) throw new Error('An earlier local calendar archive must be preserved');
        puts.push({ store: 'meta', record: { key: 'calendarBeforeDeviceLinkV1', savedAt: stamp,
          calendarEvents: current.calendar, outbox: current.outbox, conflicts: current.conflicts } });
      }
      const profile = current.household?.payload ?? { ...createHouseholdRepository({getItem: () => null}).load().profile, serverHouseholdId: null };
      puts.push({ store: 'householdProfile', record: { key: 'household', payload: { ...profile, serverHouseholdId: auth.householdId },
        revision: 0, updatedAt: stamp, deletedAt: null, syncStatus: 'local' } },
      { store: 'syncState', record: { ...emptyState(), lastAttemptAt: stamp } });
      const deletes = [
        ...current.calendar.map(record => ({ store: 'calendarEvents', key: record.id })),
        ...current.outbox.map(record => ({ store: 'outbox', key: record.mutationId })),
        ...current.conflicts.map(record => ({ store: 'conflicts', key: record.id })),
      ];
      return { puts, deletes, result: null };
    });
  }
  function attempt(mutationId) {
    return mutate(current => {
      if (!current.auth) throw new Error('Sync is not enabled');
      const record = current.outbox.find(item => item.mutationId === mutationId);
      if (!record || current.conflicts.some(item => item.entityId === record.entityId)) return { puts: [], deletes: [], result: null };
      const next = { ...record, attemptCount: record.attemptCount + 1, lastAttemptAt: clock() };
      return { puts: [{ store: 'outbox', record: next },
        { store: 'syncState', record: { ...current.state, lastAttemptAt: next.lastAttemptAt } }], deletes: [], result: next };
    });
  }
  const beginAttempt = () => mutate(current => ({ puts: [{ store: 'syncState', record: {
    ...current.state, lastAttemptAt: clock(),
  } }], deletes: [], result: null }));
  function acknowledge(mutationId, revision) {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Invalid acknowledged revision');
    return mutate(current => {
      const item = current.outbox.find(record => record.mutationId === mutationId);
      if (!item) return { puts: [], deletes: [], result: null };
      const record = current.calendar.find(event => event.id === item.entityId);
      if (!record) throw new Error('Acknowledged calendar record is absent');
      const remaining = current.outbox.filter(other => other.entityId === item.entityId && other.mutationId !== mutationId);
      const next = { ...record, revision: Math.max(record.revision, revision),
        syncStatus: record.syncStatus === 'conflict' ? 'conflict' : remaining.length ? 'pending' : 'synced' };
      const puts = [{ store: 'calendarEvents', record: next }];
      // A dependent mutation gets its actual base before its first attempt, never on a retry.
      const dependent = remaining[0];
      if (dependent && dependent.attemptCount === 0 && dependent.operation !== 'CREATE') {
        puts.push({ store: 'outbox', record: { ...dependent, baseRevision: revision } });
      }
      return { puts, deletes: [{ store: 'outbox', key: mutationId }], result: null };
    });
  }
  function reject(mutationId, result) {
    return mutate(current => {
      const item = current.outbox.find(record => record.mutationId === mutationId);
      if (!item) return { puts: [], deletes: [], result: null };
      const local = current.calendar.find(record => record.id === item.entityId);
      if (!local) throw new Error('Rejected calendar record is absent');
      const previous = current.conflicts.find(record => record.entityId === item.entityId);
      return { puts: [
        { store: 'calendarEvents', record: { ...local, syncStatus: 'conflict' } },
        { store: 'conflicts', record: { ...previous, id: `calendar:${item.entityId}`,
          entityType: 'calendar_event', entityId: item.entityId, localRecord: local,
          mutation: item, result, updatedAt: clock() } },
      ], deletes: [], result: null };
    });
  }
  function applyRemote(records, cursor, bootstrap = false) {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Array.isArray(records)) throw new TypeError('Invalid calendar snapshot');
    const incoming = records.map(record => ({ ...record, syncStatus: 'synced' }));
    const ids = new Set();
    for (const record of incoming) {
      validateRuntimeRecord('calendarEvents', record);
      if (!Number.isSafeInteger(record.revision) || record.revision < 1 || ids.has(record.id)) throw new TypeError('Invalid remote calendar record');
      ids.add(record.id);
    }
    return mutate(current => {
      if (!current.auth) throw new Error('Sync is not enabled');
      if (!bootstrap && cursor < current.state.serverCursor) return { puts: [], deletes: [], result: null };
      const puts = [];
      for (const remote of incoming) {
        const local = current.calendar.find(record => record.id === remote.id);
        if (local && ['local', 'pending', 'conflict'].includes(local.syncStatus)) {
          // An echo of our acknowledged revision is harmless; a newer server revision is evidence of a conflict.
          if (remote.revision > local.revision || local.syncStatus === 'conflict') {
            const previous = current.conflicts.find(record => record.entityId === local.id);
            puts.push({ store: 'calendarEvents', record: { ...local, syncStatus: 'conflict' } },
              { store: 'conflicts', record: { ...previous, id: `calendar:${local.id}`,
                entityType: 'calendar_event', entityId: local.id, localRecord: local,
                remoteRecord: remote, updatedAt: clock() } });
          }
          continue;
        }
        if (local && local.revision > remote.revision) continue;
        puts.push({ store: 'calendarEvents', record: remote });
      }
      puts.push({ store: 'syncState', record: { ...current.state, serverCursor: cursor,
        bootstrapCompleted: true, lastSuccessfulSyncAt: clock() } });
      return { puts, deletes: [], result: null };
    });
  }
  return { snapshot, setupStatus, recoverInterruptedClaim, install, installJoined, beginAttempt, attempt, acknowledge, reject, applyRemote };
}
