import { requestResult } from './indexedDb.js';
import { validateCalendarEventRecord, validateDeviceAuthRecord, validateCalendarSyncState, validateOutboxRecord } from './localReplica.js';
import { validateRuntimeRecord, validateSharedPlaceOrders } from './runtimeRecords.js';

// Runtime mutation helper (runtime cutover C3). Every runtime domain write runs
// READ -> synchronous PLAN -> VALIDATE -> synchronous WRITE in one readwrite transaction that also
// re-reads and advances the authority record. Nothing inside the body awaits anything except
// IndexedDB requests issued on this transaction.

const AUTHORITY_KEY = 'storageAuthorityV1';
const AUTHORITY_FIELDS = Object.freeze([
  'commitCount', 'key', 'legacyDigestAtSwitch', 'legacyUntrusted', 'markerPreparationId', 'persistGranted', 'status', 'switchId', 'switchedAt',
]);
const AUTHORITY_STATUSES = Object.freeze(['active', 'reverting', 'reverted']);
const DIGEST = /^[0-9a-f]{64}$/;

const DOMAIN_STORES = Object.freeze({
  household: Object.freeze(['householdProfile']),
  places: Object.freeze(['sharedPlaces']),
  calendar: Object.freeze(['calendarEvents', 'wasteState', 'auth', 'outbox']),
  calendarSync: Object.freeze(['auth', 'householdProfile', 'calendarEvents', 'outbox', 'syncState', 'conflicts']),
});
const KEY_PATHS = Object.freeze({ householdProfile: 'key', wasteState: 'key', calendarEvents: 'id', sharedPlaces: 'id', auth: 'key', outbox: 'mutationId', syncState: 'key', conflicts: 'id', meta: 'key' });

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = value => typeof value === 'string' && value.length > 0;

function authorityError(state, reason, message) {
  const error = new Error(message);
  error.name = 'RuntimeAuthorityError';
  error.state = state;
  error.reason = reason;
  return error;
}

// Authority timestamps follow the same strict rule as Task 2 record timestamps.
function isAcceptedTimestamp(value) {
  try {
    validateCalendarEventRecord({ id: 'authority-timestamp-probe', payload: {}, revision: 0, updatedAt: value, deletedAt: null, syncStatus: 'local' });
    return true;
  } catch {
    return false;
  }
}

// Exact authority record contract: the nine fields and their types.
function isWellFormedAuthority(record) {
  if (!isPlainObject(record)) return false;
  const keys = Object.keys(record).sort();
  return keys.length === AUTHORITY_FIELDS.length && keys.every((key, index) => key === AUTHORITY_FIELDS[index])
    && record.key === AUTHORITY_KEY
    && AUTHORITY_STATUSES.includes(record.status)
    && isNonEmptyString(record.switchId)
    && typeof record.switchedAt === 'string' && isAcceptedTimestamp(record.switchedAt)
    && typeof record.legacyDigestAtSwitch === 'string' && DIGEST.test(record.legacyDigestAtSwitch)
    && isNonEmptyString(record.markerPreparationId)
    && Number.isSafeInteger(record.commitCount) && record.commitCount >= 0
    && typeof record.legacyUntrusted === 'boolean'
    && (record.persistGranted === null || typeof record.persistGranted === 'boolean');
}

function requireWritableAuthority(record, switchId) {
  if (record === undefined) throw authorityError('RELOAD_REQUIRED', 'authority-mismatch', 'The storage authority record is absent');
  if (!isWellFormedAuthority(record)) throw authorityError('STORAGE_UNAVAILABLE', 'authority-malformed', 'The storage authority record is malformed');
  if (record.status !== 'active' || record.switchId !== switchId) {
    throw authorityError('RELOAD_REQUIRED', 'authority-mismatch', 'The storage authority changed');
  }
  if (!Number.isSafeInteger(record.commitCount + 1)) throw new RangeError('The storage authority commitCount cannot advance');
}

const isThenable = value => (value !== null && (typeof value === 'object' || typeof value === 'function')) && typeof value.then === 'function';

// Validates the private plan shape { puts: [{ store, record }], deletes: [{ store, key }], result }.
function validatePlan(planned, writableStores, domain) {
  if (!isPlainObject(planned) || !Array.isArray(planned.puts) || !Array.isArray(planned.deletes)) {
    throw new TypeError('plan must return { puts: [], deletes: [] }');
  }
  const touched = new Set();
  const touch = (store, key) => {
    const id = JSON.stringify([store, key]);
    if (touched.has(id)) throw new TypeError(`plan touches ${store}/${key} more than once`);
    touched.add(id);
  };
  for (const put of planned.puts) {
    if (!isPlainObject(put) || !writableStores.has(put.store)) throw new TypeError('plan puts must target a store of this mutation');
    if (put.store === 'auth') validateDeviceAuthRecord(put.record);
    else if (put.store === 'syncState') validateCalendarSyncState(put.record);
    else if (put.store === 'outbox') {
      validateOutboxRecord(put.record);
      if (put.record.entityType !== 'calendar_event' || !Number.isSafeInteger(put.record.sequence)) throw new TypeError('Only sequenced calendar outbox writes are allowed');
    } else if (put.store === 'meta') {
      if (domain === 'calendarSync' && put.record?.key === 'calendarBeforeDeviceLinkV1') {
        const archive = put.record;
        if (Object.keys(archive).length !== 5 || !isAcceptedTimestamp(archive.savedAt)
            || !Array.isArray(archive.calendarEvents) || !Array.isArray(archive.outbox) || !Array.isArray(archive.conflicts)) {
          throw new TypeError('Invalid pre-link calendar archive');
        }
        archive.calendarEvents.forEach(record => validateRuntimeRecord('calendarEvents', record));
        archive.outbox.forEach(record => {
          validateOutboxRecord(record);
          if (record.entityType !== 'calendar_event') throw new TypeError('Only calendar may be archived');
        });
        if (archive.conflicts.some(record => !isPlainObject(record) || record.entityType !== 'calendar_event'
            || !isNonEmptyString(record.id) || !isNonEmptyString(record.entityId))) throw new TypeError('Invalid archived conflict');
      } else if (put.record?.key !== 'outboxSequence' || !Number.isSafeInteger(put.record.value) || put.record.value < 0
          || Object.keys(put.record).length !== 2) throw new TypeError('Unsupported runtime metadata write');
    } else if (put.store === 'conflicts') {
      if (!isPlainObject(put.record) || !isNonEmptyString(put.record.id) || put.record.entityType !== 'calendar_event'
          || !isNonEmptyString(put.record.entityId)) throw new TypeError('Invalid calendar conflict');
    } else validateRuntimeRecord(put.store, put.record);
    touch(put.store, put.record[KEY_PATHS[put.store]]);
  }
  for (const removal of planned.deletes) {
    if (!isPlainObject(removal) || !writableStores.has(removal.store) || !isNonEmptyString(removal.key)) {
      throw new TypeError('plan deletes must target a key in a store of this mutation');
    }
    touch(removal.store, removal.key);
  }
  return planned;
}

function resultingPlaces(currentPlaces, planned) {
  const byId = new Map(currentPlaces.map(record => [record.id, record]));
  for (const removal of planned.deletes) if (removal.store === 'sharedPlaces') byId.delete(removal.key);
  for (const put of planned.puts) if (put.store === 'sharedPlaces') byId.set(put.record.id, put.record);
  return [...byId.values()];
}

export async function runReplicaMutation({ replica, authority, domain, stores, read, plan } = {}) {
  if (!Object.hasOwn(DOMAIN_STORES, domain)) throw new TypeError(`${String(domain)} is not a runtime domain`);
  if (!isNonEmptyString(authority?.switchId)) throw new TypeError('authority.switchId must be a non-empty string');
  if (typeof read !== 'function' || typeof plan !== 'function') throw new TypeError('read and plan must be functions');
  if (!Array.isArray(stores)) throw new TypeError('stores must be an array');
  const domainStores = [...new Set(stores.filter(name => name !== 'meta'))];
  if (domainStores.length === 0 || domainStores.some(name => !DOMAIN_STORES[domain].includes(name))) {
    throw new TypeError(`stores must be stores of the ${domain} domain`);
  }
  const writableStores = new Set(domainStores);
  if (writableStores.has('outbox')) writableStores.add('meta');
  const storeNames = ['meta', ...domainStores];

  let body;
  const mutate = async transactionStores => {
    // READ: authority first, so a mismatched or malformed authority stops before any domain work.
    const current = await requestResult(transactionStores.meta.get(AUTHORITY_KEY));
    requireWritableAuthority(current, authority.switchId);
    const currentPlaces = writableStores.has('sharedPlaces') ? await requestResult(transactionStores.sharedPlaces.getAll()) : null;
    const snapshot = await read(transactionStores);

    // PLAN: synchronous and pure.
    const planned = plan(snapshot);
    if (isThenable(planned)) throw new TypeError('plan must be synchronous and must not return a thenable');
    // A thenable result would be adopted after the writes commit, so reject it before any write request.
    if (isPlainObject(planned) && isThenable(planned.result)) throw new TypeError('plan result must be synchronous and must not be a thenable');

    // VALIDATE: every record and the resulting place order, before any write request.
    validatePlan(planned, writableStores, domain);
    if (currentPlaces) validateSharedPlaceOrders(resultingPlaces(currentPlaces, planned));

    // WRITE: one synchronous block, no await between requests.
    for (const put of planned.puts) transactionStores[put.store].put(put.record);
    for (const removal of planned.deletes) transactionStores[removal.store].delete(removal.key);
    transactionStores.meta.put({ ...current, commitCount: current.commitCount + 1 });
    return planned.result;
  };

  await replica.transact(storeNames, 'readwrite', ({ stores: transactionStores }) => {
    body = mutate(transactionStores);
    return body;
  });
  // A transaction that auto-committed while the body was still pending resolves early; the body's own
  // outcome (for example TransactionInactiveError from the write block) decides the mutation result.
  return body;
}
