import { requestResult } from '../storage/indexedDb.js';
import { runReplicaMutation } from '../storage/runtimeWrites.js';
import { validateDeviceAuthRecord, validateCalendarSyncState, validateOutboxRecord } from '../storage/localReplica.js';
import { validateRuntimeRecord } from '../storage/runtimeRecords.js';
import { createHouseholdRepository } from '../waste/householdRepository.js';
import { EDIT_FIELDS } from '../calendar/eventModel.js';
import { CATEGORY_IDENTITY_FIELDS } from '../calendar/categoryModel.js';
import { reconcileMergeAcknowledgement } from './mergeAcknowledgement.js';
import { CALENDAR_MUTATION_UNKNOWN, CALENDAR_PUSH_TOO_LARGE, MAX_CALENDAR_PUSH_BYTES, calendarMutationBlocked, calendarPushRequest,
  isDefiniteSizeRejection, isOversizedCalendarConflict, isUncertainCalendarConflict } from './calendarOutbox.js';

const STORES = ['auth', 'householdProfile', 'calendarEvents', 'outbox', 'syncState', 'conflicts'];
const RULE_FIELDS = ['date', 'recurrence', 'seriesId', 'excludedDates', 'overrides'];
const MERGE_FIELDS = [...new Set([...EDIT_FIELDS, ...RULE_FIELDS, 'importMeta'])];
function calendarMergeGroup(field) {
  if (RULE_FIELDS.includes(field)) return 'rule';
  if (CATEGORY_IDENTITY_FIELDS.includes(field)) return 'identity';
  return field;
}
const emptyState = () => ({ key: 'calendar', serverCursor: 0, bootstrapCompleted: false,
  lastSuccessfulSyncAt: null, lastAttemptAt: null, setupStatus: null });
const noChange = () => ({ puts: [], deletes: [], result: null });
const isRecoveryConflict = record => isOversizedCalendarConflict(record) || isUncertainCalendarConflict(record);
const sizeResult = (requestBytes, submission) => submission === 'unknown'
  ? { status: 'RETRYABLE', code: CALENDAR_MUTATION_UNKNOWN, requestBytes }
  : { status: 'REJECTED', code: CALENDAR_PUSH_TOO_LARGE, requestBytes, submission };

function combinePatches(pending) {
  const patch = {};
  for (const item of pending) Object.assign(patch, item.patch);
  return patch;
}

const editsSchedule = patch => Object.hasOwn(patch, 'date') || Object.hasOwn(patch, 'recurrence');
const hasExceptions = patch => patch.excludedDates?.length > 0 || Object.keys(patch.overrides ?? {}).length > 0;

function correctedMutation(local, pending) {
  const head = pending[0];
  if (local.deletedAt !== null) return { operation: 'DELETE', patch: {}, remaining: [] };
  if (head.operation === 'CREATE') return { operation: 'CREATE', patch: local.payload, remaining: [] };
  const patch = { ...head.patch };
  const movableGroups = new Set(Object.keys(patch).map(calendarMergeGroup));
  if (editsSchedule(patch)) movableGroups.delete('rule');
  const remaining = [];
  for (const item of pending.slice(1)) {
    // Rule edits cannot move across a schedule reset. Independent repairs to
    // original fields (e.g. shorter series notes) can precede untouched dependencies.
    if (editsSchedule(item.patch)) movableGroups.delete('rule');
    const rest = {};
    let folded = false;
    for (const [key, value] of Object.entries(item.patch)) {
      if (movableGroups.has(calendarMergeGroup(key))) { patch[key] = value; folded = true; }
      else rest[key] = value;
    }
    if (!folded) remaining.push(item);
    else if (Object.keys(rest).length) remaining.push({ ...item, patch: rest });
  }
  return { operation: 'UPDATE', patch, remaining };
}

function recoverThroughScheduleReset(pending) {
  // The server resets exceptions on a schedule change. Keep edits made after that
  // explicit reset separate so they can be applied in their original order.
  const consumed = pending.findLastIndex(item => editsSchedule(item.patch)) + 1;
  if (consumed < 2) return null;
  const resetPatch = combinePatches(pending.slice(0, consumed));
  return hasExceptions(resetPatch) ? null : { operation: 'UPDATE', patch: resetPatch, remaining: pending.slice(consumed) };
}

function recoveryMergeConflict(pending) {
  const head = pending[0];
  const evidence = head.mergeEvidence;
  if (evidence === undefined) return null;
  const unknown = { mutation: head, code: 'MERGE_UNCERTAIN' };
  if (!Array.isArray(evidence?.fieldWindows) || !Number.isSafeInteger(evidence.throughSequence)
      || evidence.throughSequence < head.sequence || evidence.fieldWindows.some(window =>
        !Array.isArray(window) || window.length !== 2 || !MERGE_FIELDS.includes(window[0]) ||
        !Number.isSafeInteger(window[1]) || window[1] < head.sequence || window[1] > evidence.throughSequence)) return unknown;
  let remoteRecord;
  try { remoteRecord = validateRuntimeRecord('calendarEvents', { ...evidence.record, syncStatus: 'synced' }); }
  catch { return unknown; }
  if (remoteRecord.id !== head.entityId || remoteRecord.deletedAt !== null || remoteRecord.revision < 1
      || remoteRecord.revision > head.baseRevision) return unknown;
  for (const item of pending) {
    if (item.sequence > evidence.throughSequence) break;
    const remoteGroups = evidence.fieldWindows.filter(([, until]) => item.sequence <= until)
      .map(([field]) => calendarMergeGroup(field));
    if (item.operation === 'DELETE') return { mutation: item, code: 'STALE_DELETE', remoteRecord };
    if (item.operation !== 'UPDATE') return unknown;
    if (Object.keys(item.patch).some(field => remoteGroups.includes(calendarMergeGroup(field)))) {
      return { mutation: item, code: 'FIELD_OVERLAP', remoteRecord };
    }
  }
  return null;
}

function rejectionPlan(current, item, result, stamp, remoteRecord) {
  const local = current.calendar.find(record => record.id === item.entityId);
  if (!local) throw new Error('Rejected calendar record is absent');
  const previous = current.conflicts.find(record => record.entityId === item.entityId);
  if ([CALENDAR_PUSH_TOO_LARGE, CALENDAR_MUTATION_UNKNOWN].includes(result.code)
      && previous?.result && !isRecoveryConflict(previous)) return noChange();
  const { retryMutationId, ...conflict } = previous ?? {};
  const remembered = remoteRecord ?? item.recoveryRemoteRecord;
  const latest = remembered && !(conflict.remoteRecord?.revision > remembered.revision) ? { remoteRecord: remembered } : {};
  return { puts: [
    { store: 'calendarEvents', record: { ...local, syncStatus: 'conflict' } },
    { store: 'conflicts', record: { ...conflict, ...latest, id: `calendar:${item.entityId}`,
      entityType: 'calendar_event', entityId: item.entityId, localRecord: local,
      mutation: item, result, updatedAt: stamp } },
  ], deletes: [], result: null };
}

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
  function attempt(mutationId, retryUncertain = false) {
    return mutate(current => {
      if (!current.auth) throw new Error('Sync is not enabled');
      const record = current.outbox.find(item => item.mutationId === mutationId);
      if (!record || current.outbox.some(item => item.entityId === record.entityId && item.sequence < record.sequence)) return noChange();
      const conflict = current.conflicts.find(item => item.entityId === record.entityId);
      if (retryUncertain) {
        const local = current.calendar.find(item => item.id === record.entityId);
        if (!conflict || !isUncertainCalendarConflict(conflict) || conflict.mutation?.mutationId !== mutationId
            || local?.deletedAt !== null) return noChange();
      } else if (calendarMutationBlocked(conflict, mutationId)) return noChange();
      const request = calendarPushRequest(record);
      if (request.bytes > MAX_CALENDAR_PUSH_BYTES) {
        if (retryUncertain) return noChange();
        const submission = record.attemptCount === 0 ? 'unsent' : 'unknown';
        return { ...rejectionPlan(current, record, sizeResult(request.bytes, submission), clock()),
          result: { blocked: record, uncertain: submission === 'unknown' } };
      }
      const next = { ...record, attemptCount: record.attemptCount + 1, lastAttemptAt: clock() };
      return { puts: [{ store: 'outbox', record: next },
        { store: 'syncState', record: { ...current.state, lastAttemptAt: next.lastAttemptAt } }],
      deletes: [], result: { item: next, ...request } };
    });
  }
  const beginAttempt = () => mutate(current => ({ puts: [{ store: 'syncState', record: {
    ...current.state, lastAttemptAt: clock(),
  } }], deletes: [], result: null }));
  function acknowledge(mutationId, revision, merge) {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Invalid acknowledged revision');
    return mutate(current => {
      const item = current.outbox.find(record => record.mutationId === mutationId);
      if (!item) return { puts: [], deletes: [], result: null };
      const local = current.calendar.find(event => event.id === item.entityId);
      if (!local) throw new Error('Acknowledged calendar record is absent');
      const previous = current.conflicts.find(record => record.entityId === item.entityId);
      const recoveryResolved = previous && isRecoveryConflict(previous)
        && (previous.retryMutationId ?? previous.mutation?.mutationId) === mutationId;
      const remembered = recoveryResolved ? previous.remoteRecord : item.recoveryRemoteRecord;
      const effectiveLocal = recoveryResolved ? { ...local, syncStatus: 'pending' } : local;
      const newerRemote = effectiveLocal.syncStatus !== 'conflict' && remembered?.revision > revision;
      const dependents = current.outbox.filter(other => other.entityId === item.entityId && other.sequence > item.sequence);
      const plan = reconcileMergeAcknowledgement({
        merge, mutation: item, revision, dependents, local: effectiveLocal, fields: MERGE_FIELDS, group: calendarMergeGroup,
        readRecord: record => validateRuntimeRecord('calendarEvents', { ...record, syncStatus: 'synced' }),
        validatePayload: payload => validateRuntimeRecord('calendarEvents', { ...local, payload }),
      });
      const record = newerRemote && !dependents.length ? remembered : { ...local, payload: plan.payload, revision: plan.revision,
        syncStatus: (plan.blocked || effectiveLocal.syncStatus === 'conflict') ? 'conflict' : dependents.length ? 'pending' : 'synced' };
      const puts = [{ store: 'calendarEvents', record }];
      const deletes = [{ store: 'outbox', key: mutationId }];
      if (plan.blocked) {
        const remoteRecord = newerRemote && !(plan.blocked.remoteRecord?.revision > remembered.revision)
          ? remembered : plan.blocked.remoteRecord;
        const conflict = { id: `calendar:${item.entityId}`, entityType: 'calendar_event', entityId: item.entityId,
          ...plan.blocked, remoteRecord, localRecord: record, updatedAt: clock() };
        puts.push({ store: 'conflicts', record: conflict });
      } else if (recoveryResolved) {
        deletes.push({ store: 'conflicts', key: previous.id });
      }
      // Send the dependent on the acknowledged base. Keep the already pulled
      // newer image for conflict display while the server checks for field overlap.
      const next = newerRemote && !plan.blocked && dependents.length
        ? { ...(plan.nextMutation ?? dependents[0]), recoveryRemoteRecord: remembered }
        : plan.nextMutation;
      if (next) puts.push({ store: 'outbox', record: next });
      if (plan.refreshSnapshot) {
        puts.push({ store: 'syncState', record: { ...current.state, bootstrapCompleted: false } });
      }
      return { puts, deletes, result: null };
    });
  }
  function reject(mutationId, result) {
    return mutate(current => {
      const item = current.outbox.find(record => record.mutationId === mutationId);
      if (!item) return noChange();
      const conflict = current.conflicts.find(record => record.entityId === item.entityId);
      // An earlier identical request may commit between the server's journal
      // check and this retry's conflict check. Keep the original until proved.
      if (conflict && isUncertainCalendarConflict(conflict) && conflict.mutation?.mutationId === mutationId) {
        return { ...noChange(), result: item };
      }
      return rejectionPlan(current, item, result, clock());
    });
  }
  function rejectPushSize(attempted, bytes, errorCode) {
    return mutate(current => {
      const item = current.outbox.find(record => record.mutationId === attempted.mutationId);
      if (!item) return noChange();
      // A first origin rejection proves noncommit only while no other tab has
      // reserved another submission. A later 413 says nothing about prior attempts.
      const rejected = errorCode === CALENDAR_PUSH_TOO_LARGE && attempted.attemptCount === 1 && item.attemptCount === 1;
      const plan = rejectionPlan(current, item, sizeResult(bytes, rejected ? 'rejected' : 'unknown'), clock());
      return { ...plan, result: !rejected && plan.puts.length ? item : null };
    });
  }
  function recoverOversized(entityId) {
    return mutate(current => {
      if (!current.auth) return noChange();
      const conflict = current.conflicts.find(record => record.entityId === entityId);
      if (!conflict || !isOversizedCalendarConflict(conflict)) return noChange();
      const failedBytes = conflict.result.requestBytes;
      if (!Number.isSafeInteger(failedBytes) || failedBytes < 1) return noChange();
      const pending = current.outbox.filter(item => item.entityId === entityId);
      const [head, ...edits] = pending;
      const original = conflict.mutation;
      let result = conflict.result;
      if (!isDefiniteSizeRejection(result)) {
        if (!original || original.attemptCount !== 0 || calendarPushRequest(original).bytes <= MAX_CALENDAR_PUSH_BYTES) {
          if (!original) return noChange();
          return { ...rejectionPlan(current, original, sizeResult(failedBytes, 'unknown'), clock()), result: original };
        }
        result = sizeResult(failedBytes, 'unsent');
      }
      if (conflict.retryMutationId) return result === conflict.result ? noChange()
        : { puts: [{ store: 'conflicts', record: { ...conflict, result } }], deletes: [], result: null };
      if (head?.mutationId !== original?.mutationId || !edits.length
          || edits.some(item => item.attemptCount !== 0 || item.mergeEvidence !== undefined)) return noChange();
      const local = current.calendar.find(record => record.id === entityId);
      if (!local) return noChange();
      if (head.operation === 'CREATE' && local.deletedAt !== null) {
        if (conflict.remoteRecord) return noChange();
        const cancelled = pending.map(item => ({ store: 'outbox', key: item.mutationId }));
        return { puts: [], deletes: [...cancelled, { store: 'calendarEvents', key: entityId },
          { store: 'conflicts', key: conflict.id }], result: null };
      }
      const stamp = clock();
      // Keep the original base so a concurrent remote edit still goes through the server's conflict checks.
      const next = { mutationId: newId(), entityType: head.entityType, entityId, baseRevision: head.baseRevision,
        createdAt: stamp, attemptCount: 0, lastAttemptAt: null, sequence: current.sequence + 1 };
      let recovery = correctedMutation(local, pending);
      const replacementFor = candidate => ({ ...next, operation: candidate.operation, patch: candidate.patch });
      const fits = candidate => {
        const { operation, patch } = candidate;
        if (operation === 'UPDATE' && editsSchedule(patch) && hasExceptions(patch)) return false;
        const { bytes } = calendarPushRequest(replacementFor(candidate));
        return bytes <= MAX_CALENDAR_PUSH_BYTES && bytes < failedBytes;
      };
      if (!fits(recovery)) {
        if (recovery.operation !== 'UPDATE') return noChange();
        recovery = recoverThroughScheduleReset(pending);
        if (!recovery || !fits(recovery)) return noChange();
      }
      const mergeConflict = recoveryMergeConflict(pending);
      if (mergeConflict) return rejectionPlan(current, mergeConflict.mutation,
        { status: 'CONFLICT', code: mergeConflict.code }, stamp, mergeConflict.remoteRecord);
      const replacement = replacementFor(recovery);
      const originalPatches = new Map(edits.map(item => [item.mutationId, item.patch]));
      const remaining = recovery.remaining.map((item, index) => ({ store: 'outbox',
        record: { ...item, mutationId: item.patch === originalPatches.get(item.mutationId) ? item.mutationId : newId(),
          sequence: replacement.sequence + index + 1 } }));
      const sequence = replacement.sequence + remaining.length;
      const retained = new Set(remaining.map(({ record }) => record.mutationId));
      return { puts: [
        { store: 'outbox', record: replacement },
        ...remaining,
        { store: 'meta', record: { key: 'outboxSequence', value: sequence } },
        { store: 'conflicts', record: { ...conflict, result, retryMutationId: replacement.mutationId, localRecord: local, updatedAt: stamp } },
      ], deletes: pending.filter(item => !retained.has(item.mutationId)).map(item => ({ store: 'outbox', key: item.mutationId })), result: null };
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
      if (!bootstrap && (!current.state.bootstrapCompleted || cursor < current.state.serverCursor)) {
        return { puts: [], deletes: [], result: null };
      }
      const puts = [];
      for (const remote of incoming) {
        const local = current.calendar.find(record => record.id === remote.id);
        if (local && ['local', 'pending', 'conflict'].includes(local.syncStatus)) {
          const queued = current.outbox.find(item => item.entityId === local.id);
          if (local.syncStatus === 'pending' && queued?.recoveryRemoteRecord?.revision >= remote.revision) continue;
          // An echo of our acknowledged revision is harmless; a newer server revision is evidence of a conflict.
          if (remote.revision > local.revision || local.syncStatus === 'conflict') {
            const previous = current.conflicts.find(record => record.entityId === local.id);
            const remoteRecord = previous?.remoteRecord?.revision > remote.revision ? previous.remoteRecord : remote;
            puts.push({ store: 'calendarEvents', record: { ...local, syncStatus: 'conflict' } },
              { store: 'conflicts', record: { ...previous, id: `calendar:${local.id}`,
                entityType: 'calendar_event', entityId: local.id, localRecord: local,
                remoteRecord, updatedAt: clock() } });
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
  return { snapshot, setupStatus, recoverInterruptedClaim, install, installJoined, beginAttempt, attempt, acknowledge,
    reject, rejectPushSize, recoverOversized, applyRemote };
}
