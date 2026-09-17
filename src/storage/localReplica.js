import { closeDb, openMajandusDb, requestResult, runTransaction } from './indexedDb.js';

const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function invalid(message) {
  throw new TypeError(message);
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} must be an object`);
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) invalid(`${name} must be a non-empty string`);
}

function requireInteger(value, name, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) invalid(`${name} must be an integer >= ${minimum}`);
}

function requireTimestamp(value, name, nullable = false) {
  if (nullable && value === null) return;
  const parts = typeof value === 'string' ? ISO_TIMESTAMP.exec(value) : null;
  if (!parts) invalid(`${name} must be a valid ISO timestamp`);
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts.slice(1).map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59 || (offsetHour !== 0 && offsetHour > 23) || (offsetMinute !== 0 && offsetMinute > 59)) invalid(`${name} must be a valid ISO timestamp`);
}

function validateReplicaEnvelope(record) {
  requireObject(record, 'record');
  requireObject(record.payload, 'record.payload');
  requireInteger(record.revision, 'record.revision');
  requireTimestamp(record.updatedAt, 'record.updatedAt');
  requireTimestamp(record.deletedAt, 'record.deletedAt', true);
  if (record.syncStatus === 'local') {
    if (record.revision !== 0) invalid('local records must have revision 0');
  } else if (record.syncStatus === 'synced') {
    requireInteger(record.revision, 'record.revision', 1);
  } else if (record.syncStatus !== 'pending' && record.syncStatus !== 'conflict') {
    invalid('record.syncStatus is invalid');
  }
  return record;
}

export function validateHouseholdProfileRecord(record) {
  validateReplicaEnvelope(record);
  if (record.key !== 'household') invalid('household profile key must be household');
  return record;
}

export function validateCalendarEventRecord(record) {
  validateReplicaEnvelope(record);
  requireNonEmptyString(record.id, 'record.id');
  return record;
}

export function validateSharedPlaceRecord(record) {
  validateReplicaEnvelope(record);
  requireNonEmptyString(record.id, 'record.id');
  requireInteger(record.order, 'record.order', Number.MIN_SAFE_INTEGER);
  return record;
}

export function validateWasteStateRecord(record) {
  validateReplicaEnvelope(record);
  if (record.key !== 'waste') invalid('waste state key must be waste');
  return record;
}

export function validateOutboxRecord(record) {
  requireObject(record, 'record');
  requireNonEmptyString(record.mutationId, 'record.mutationId');
  requireNonEmptyString(record.entityType, 'record.entityType');
  requireNonEmptyString(record.entityId, 'record.entityId');
  if (!['CREATE', 'UPDATE', 'DELETE'].includes(record.operation)) invalid('record.operation is invalid');
  requireInteger(record.baseRevision, 'record.baseRevision');
  if (record.operation === 'CREATE' && record.baseRevision !== 0) invalid('CREATE baseRevision must be 0');
  if (record.operation !== 'CREATE') requireInteger(record.baseRevision, 'record.baseRevision', 1);
  requireObject(record.patch, 'record.patch');
  requireTimestamp(record.createdAt, 'record.createdAt');
  requireInteger(record.attemptCount, 'record.attemptCount');
  requireTimestamp(record.lastAttemptAt, 'record.lastAttemptAt', true);
  if ('sequence' in record) requireInteger(record.sequence, 'record.sequence', 1);
  return record;
}

function validateMetaRecord(record) {
  requireObject(record, 'record');
  requireNonEmptyString(record.key, 'record.key');
  return record;
}

export function createLocalReplica({ indexedDb = globalThis.indexedDB, clock = () => new Date().toISOString() } = {}) {
  let activeDb;
  let opening;
  // Each explicit close() starts a new generation; handles and events of older generations are stale.
  let generation = 0;
  let lost = false;
  let listeners = [];
  const pendingOpens = new Set();

  const notify = event => {
    let failure;
    let failed = false;
    for (const entry of listeners) {
      try {
        entry.listener(event);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
    if (failed) queueMicrotask(() => { throw failure; });
  };

  const connectionLost = (owner, event) => {
    if (owner !== generation || lost) return;
    activeDb = undefined;
    lost = true;
    notify(event);
  };

  const subscribe = listener => {
    const entry = { listener };
    listeners = [...listeners, entry];
    return () => {
      listeners = listeners.filter(candidate => candidate !== entry);
    };
  };

  const lostError = () => new DOMException('The local replica lost its database connection', 'ReplicaConnectionLostError');

  const open = async () => {
    if (lost) throw lostError();
    if (activeDb) return activeDb;
    if (!opening) {
      const owner = generation;
      const pending = openMajandusDb(indexedDb, {
        onVersionChange: ({ oldVersion, newVersion }) => connectionLost(owner, { type: 'versionchange', oldVersion, newVersion }),
        onClose: () => connectionLost(owner, { type: 'close' }),
      }).then(db => {
        if (owner !== generation) {
          closeDb(db);
          throw new DOMException('The local replica was closed while opening', 'ReplicaClosedError');
        }
        if (lost) {
          closeDb(db);
          throw lostError();
        }
        activeDb = db;
        return db;
      }).finally(() => {
        pendingOpens.delete(pending);
        if (opening === pending) opening = undefined;
      });
      pendingOpens.add(pending);
      opening = pending;
    }
    return opening;
  };

  // Resolves only after no handle of an older generation can remain open. Every close waits for every
  // open still in flight when it was called; opens started afterwards belong to a newer generation.
  const close = async () => {
    generation += 1;
    const db = activeDb;
    activeDb = undefined;
    closeDb(db);
    opening = undefined;
    const older = [...pendingOpens];
    await Promise.all(older.map(pending => pending.catch(() => undefined)));
  };

  const transact = async (storeNames, mode, body) => runTransaction(await open(), storeNames, mode, body);
  const get = (storeName, key) => transact(storeName, 'readonly', ({ stores }) => requestResult(stores[storeName].get(key)));
  const put = async (storeName, record, validate) => {
    validate(record);
    await transact(storeName, 'readwrite', ({ stores }) => requestResult(stores[storeName].put(record)));
    return record;
  };

  return {
    open,
    close,
    subscribe,
    transact,
    getHouseholdProfile: () => get('householdProfile', 'household'),
    putHouseholdProfile: record => put('householdProfile', record, validateHouseholdProfileRecord),
    getWasteState: () => get('wasteState', 'waste'),
    putWasteState: record => put('wasteState', record, validateWasteStateRecord),
    getCalendarEvent: id => get('calendarEvents', id),
    putCalendarEvent: record => put('calendarEvents', record, validateCalendarEventRecord),
    listCalendarEvents: async () => {
      const records = await transact('calendarEvents', 'readonly', ({ stores }) => requestResult(stores.calendarEvents.getAll()));
      // Locale-independent, matching the same comparator C4's revert/export already uses.
      return records.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    },
    listSharedPlaces: async () => {
      const records = await transact('sharedPlaces', 'readonly', ({ stores }) => requestResult(stores.sharedPlaces.getAll()));
      return records.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    },
    putSharedPlace: record => put('sharedPlaces', record, validateSharedPlaceRecord),
    getMeta: key => get('meta', key),
    putMeta: record => put('meta', record, validateMetaRecord),
    enqueueOutbox: async input => {
      validateOutboxRecord(input);
      return transact(['meta', 'outbox'], 'readwrite', async ({ stores }) => {
        const counter = await requestResult(stores.meta.get('outboxSequence'));
        const previous = counter === undefined ? 0 : counter.value;
        requireInteger(previous, 'outboxSequence value');
        const sequence = previous + 1;
        const record = { ...input, sequence };
        stores.meta.put({ key: 'outboxSequence', value: sequence });
        await requestResult(stores.outbox.add(record));
        return record;
      });
    },
    listOutboxBySequence: () => transact('outbox', 'readonly', ({ stores }) => requestResult(stores.outbox.index('bySequence').getAll())),
  };
}
