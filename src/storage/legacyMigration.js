import { createEventRepository } from '../calendar/eventRepository.js';
import { createHouseholdRepository } from '../waste/householdRepository.js';
import { requestResult } from './indexedDb.js';
import {
  validateCalendarEventRecord,
  validateHouseholdProfileRecord,
  validateSharedPlaceRecord,
  validateWasteStateRecord,
} from './localReplica.js';

export const LEGACY_SHARED_KEYS = Object.freeze([
  'majamajandus_household_events_v1',
  'majamajandus_household_profile_v1',
  'sade_saved_places',
]);

const [CALENDAR_KEY, HOUSEHOLD_KEY] = LEGACY_SHARED_KEYS;
const SOURCE_NAMES = Object.freeze(['calendar', 'household', 'places']);

const UNREADABLE_SOURCES = Object.freeze({ status: 'unreadable-source', raw: null });

// Only getItem on the three approved keys is used. Any failure, or a value that is neither
// a string nor null, makes the whole snapshot unreadable; a partial snapshot is never returned.
export function readLegacySources(storage) {
  if (storage === null || storage === undefined) return { ...UNREADABLE_SOURCES };
  const values = [];
  try {
    for (const key of LEGACY_SHARED_KEYS) {
      const value = storage.getItem(key);
      if (value !== null && typeof value !== 'string') return { ...UNREADABLE_SOURCES };
      values.push(value);
    }
  } catch {
    return { ...UNREADABLE_SOURCES };
  }
  const [calendar, household, places] = values;
  return { status: 'readable', raw: { calendar, household, places } };
}

function parseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

// Serves one approved read of an in-memory raw string to a current repository. Every other
// operation (writes, enumeration, other keys, repeated reads) throws and is recorded, so a
// repository behavior change surfaces as an error instead of being masked as invalid data.
function loadThroughSnapshot(createRepository, key, raw) {
  const violations = [];
  let reads = 0;
  const reject = operation => {
    violations.push(operation);
    throw new Error(`Read-only legacy snapshot rejected ${operation}`);
  };
  const adapter = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property !== 'getItem') return reject(`access to ${String(property)}`);
      return requested => {
        if (requested !== key) return reject(`read of an unapproved key`);
        reads += 1;
        if (reads > 1) return reject('a repeated read');
        return raw;
      };
    },
    set: () => reject('a property write'),
    defineProperty: () => reject('a property definition'),
    deleteProperty: () => reject('a property deletion'),
    has: () => reject('a property probe'),
    ownKeys: () => reject('enumeration'),
  });
  const loaded = createRepository(adapter);
  if (violations.length) throw new Error(`Legacy repository used its snapshot unexpectedly: ${violations.join(', ')}`);
  if (reads !== 1) throw new Error('Legacy repository did not read its approved snapshot exactly once');
  return loaded;
}

const refuseIdGeneration = () => {
  throw new Error('Legacy validation must not generate IDs');
};

function validateCalendarSource(raw) {
  if (raw === null) return { valid: true, parsed: null, calendarEvents: [], wasteImports: undefined };
  const parsed = parseJson(raw);
  if (!parsed.ok) return { valid: false };
  const loaded = loadThroughSnapshot(storage => createEventRepository(storage, refuseIdGeneration).load(), CALENDAR_KEY, raw);
  if (loaded.writable !== true) return { valid: false };
  return { valid: true, parsed: parsed.value, calendarEvents: loaded.events, wasteImports: loaded.wasteImports };
}

function validateHouseholdSource(raw) {
  if (raw === null) return { valid: true, parsed: null, householdProfile: null };
  const parsed = parseJson(raw);
  if (!parsed.ok) return { valid: false };
  const loaded = loadThroughSnapshot(storage => createHouseholdRepository(storage).load(), HOUSEHOLD_KEY, raw);
  if (loaded.writable !== true) return { valid: false };
  return { valid: true, parsed: parsed.value, householdProfile: loaded.profile };
}

// Mirrors the current pure normalizePlace in src/hooks/useSavedPlaces.js (not exported there).
// Parity is proven against that live source in scripts/storage/storage.test.mjs.
// Unlike the runtime loader, actual legacy items are never padded with default places.
const PLACE_FALLBACK_NAMES = Object.freeze(['Kodu', 'Kool', 'Trenn']);

function normalizeLegacyPlace(place, index) {
  const lat = Number.parseFloat(place?.lat);
  const lon = Number.parseFloat(place?.lon);
  return {
    name: typeof place?.name === 'string' && place.name.trim() ? place.name.trim() : PLACE_FALLBACK_NAMES[index] ?? 'Koht',
    address: typeof place?.address === 'string' ? place.address : '',
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

function validatePlacesSource(raw) {
  if (raw === null) return { valid: true, parsed: null, sharedPlaces: [] };
  const parsed = parseJson(raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) return { valid: false };
  return { valid: true, parsed: parsed.value, sharedPlaces: parsed.value.map(normalizeLegacyPlace) };
}

function requireRawSnapshot(sources, statuses, caller) {
  const raw = sources?.raw;
  const wellFormed = statuses.includes(sources?.status) && raw !== null && typeof raw === 'object'
    && SOURCE_NAMES.every(name => raw[name] === null || typeof raw[name] === 'string');
  if (!wellFormed) throw new TypeError(`${caller} requires a readable raw legacy source snapshot`);
  return raw;
}

const requireReadResult = sources => requireRawSnapshot(sources, ['readable'], 'validateLegacySources');

// Digest authority is the raw source strings only; parsed, normalized or prepared data never enters it.
export async function sourceDigest(sources, cryptoApi) {
  const raw = requireRawSnapshot(sources, ['readable', 'valid'], 'sourceDigest');
  if (typeof cryptoApi?.subtle?.digest !== 'function') throw new TypeError('sourceDigest requires a Web Crypto API');
  const bytes = new TextEncoder().encode(JSON.stringify([raw.calendar, raw.household, raw.places]));
  const hash = await cryptoApi.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const CALENDAR_EXTRAS_KEY = 'calendarLegacyEnvelopeExtras';
const HOUSEHOLD_EXTRAS_KEY = 'householdLegacyEnvelopeExtras';
const CALENDAR_ENVELOPE_FIELDS = Object.freeze(['version', 'events', 'wasteImports']);
const HOUSEHOLD_ENVELOPE_FIELDS = Object.freeze(['version', 'profile']);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = value => typeof value === 'string' && value.length > 0;

function envelopeExtras(key, envelope, envelopeFields) {
  const fields = Object.fromEntries(Object.entries(envelope)
    .filter(([name]) => !envelopeFields.includes(name))
    .map(([name, value]) => [name, structuredClone(value)]));
  return validateExtrasRecord({ key, value: { sourceVersion: envelope.version, fields } }, envelopeFields);
}

// Task 2 exports no meta-record validator, so extras are checked here against their exact locked shape.
function validateExtrasRecord(record, envelopeFields) {
  const shapeIsExact = isPlainObject(record) && Object.keys(record).length === 2
    && [CALENDAR_EXTRAS_KEY, HOUSEHOLD_EXTRAS_KEY].includes(record.key)
    && isPlainObject(record.value) && Object.keys(record.value).length === 2
    && Number.isInteger(record.value.sourceVersion) && isPlainObject(record.value.fields)
    && envelopeFields.every(name => !Object.hasOwn(record.value.fields, name));
  if (!shapeIsExact) throw new TypeError('Legacy envelope extras record has an invalid shape');
  return record;
}

// Saved IDs are all-or-nothing: the exact count of unique non-empty strings, or rejection.
function resolveSharedPlaceIds({ savedIds, newId, count }) {
  if (savedIds !== undefined) {
    const saved = savedIds?.sharedPlaces;
    if (!Array.isArray(saved) || saved.length !== count || !saved.every(isNonEmptyString) || new Set(saved).size !== saved.length) {
      throw new TypeError('savedIds.sharedPlaces must be unique non-empty strings matching the legacy place count');
    }
    return () => [...saved];
  }
  if (count > 0 && typeof newId !== 'function') throw new TypeError('newId must be a function when shared places need IDs');
  return () => {
    const generated = Array.from({ length: count }, () => newId());
    if (!generated.every(isNonEmptyString) || new Set(generated).size !== generated.length) {
      throw new TypeError('newId must return unique non-empty strings');
    }
    return generated;
  };
}

export function prepareLegacyMigration({ validated, newId, now, preparationId, savedIds } = {}) {
  if (validated?.status !== 'valid') throw new TypeError('prepareLegacyMigration requires a valid legacy validation result');
  const raw = requireRawSnapshot(validated, ['valid'], 'prepareLegacyMigration');
  const { parsed, data } = validated;
  if (!isPlainObject(parsed) || !isPlainObject(data) || !Array.isArray(data.calendarEvents) || !Array.isArray(data.sharedPlaces)) {
    throw new TypeError('prepareLegacyMigration requires a complete legacy validation result');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!isNonEmptyString(preparationId)) throw new TypeError('preparationId must be a non-empty string');
  const takeSharedPlaceIds = resolveSharedPlaceIds({ savedIds, newId, count: data.sharedPlaces.length });

  const updatedAt = now();
  const local = () => ({ revision: 0, updatedAt, deletedAt: null, syncStatus: 'local' });
  const sharedPlaceIds = takeSharedPlaceIds();

  const householdProfile = raw.household === null ? null : validateHouseholdProfileRecord({
    key: 'household',
    payload: { ...structuredClone(data.householdProfile), serverHouseholdId: null },
    ...local(),
  });
  const calendarEvents = data.calendarEvents.map(event => validateCalendarEventRecord({
    id: event.id,
    payload: structuredClone(event),
    ...local(),
  }));
  const sharedPlaces = data.sharedPlaces.map((place, order) => validateSharedPlaceRecord({
    id: sharedPlaceIds[order],
    order,
    payload: structuredClone(place),
    ...local(),
  }));
  const wasteState = raw.calendar !== null && data.wasteImports !== undefined ? validateWasteStateRecord({
    key: 'waste',
    payload: { wasteImports: structuredClone(data.wasteImports) },
    ...local(),
  }) : null;
  const meta = [];
  if (raw.calendar !== null) meta.push(envelopeExtras(CALENDAR_EXTRAS_KEY, parsed.calendar, CALENDAR_ENVELOPE_FIELDS));
  if (raw.household !== null) meta.push(envelopeExtras(HOUSEHOLD_EXTRAS_KEY, parsed.household, HOUSEHOLD_ENVELOPE_FIELDS));

  return {
    preparationId,
    generatedIds: { sharedPlaces: [...sharedPlaceIds] },
    replica: { householdProfile, calendarEvents, sharedPlaces, wasteState, meta, outbox: [] },
  };
}

// Orders finite numbers, then strings (by code unit), then anything else as equal. Only used to
// canonicalize collection order; equality itself is decided by strictEqual below.
function compareSortKeys(left, right) {
  const rank = value => (Number.isFinite(value) ? 0 : typeof value === 'string' ? 1 : 2);
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  if (rank(left) === 2 || left === right) return 0;
  return left < right ? -1 : 1;
}

const COLLECTION_ORDER = Object.freeze({
  calendarEvents: (left, right) => compareSortKeys(left?.id, right?.id),
  sharedPlaces: (left, right) => compareSortKeys(left?.order, right?.order) || compareSortKeys(left?.id, right?.id),
  meta: (left, right) => compareSortKeys(left?.key, right?.key),
  outbox: (left, right) => compareSortKeys(left?.sequence, right?.sequence),
});

const isRecordObject = value => Object.prototype.toString.call(value) === '[object Object]';

function strictEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (Object.hasOwn(left, index) !== Object.hasOwn(right, index) || !strictEqual(left[index], right[index])) return false;
    }
    return true;
  }
  if (!isRecordObject(left) || !isRecordObject(right)) return false;
  const leftKeys = Object.keys(left);
  return leftKeys.length === Object.keys(right).length
    && leftKeys.every(key => Object.hasOwn(right, key) && strictEqual(left[key], right[key]));
}

function canonicalReplica(replica) {
  const canonical = { ...replica };
  for (const [name, compare] of Object.entries(COLLECTION_ORDER)) {
    if (Array.isArray(canonical[name])) canonical[name] = [...canonical[name]].sort(compare);
  }
  return canonical;
}

// Pure structural comparison: no I/O, no mutation, no value normalization. Only the order of
// the four replica collections is canonicalized; singletons and nested values compare exactly.
export function verifyReplica({ expected, actual } = {}) {
  if (!isRecordObject(expected) || !isRecordObject(actual)) throw new TypeError('verifyReplica requires expected and actual replica objects');
  return strictEqual(canonicalReplica(expected), canonicalReplica(actual));
}

export function validateLegacySources(sources) {
  if (sources?.status === 'unreadable-source') return { status: 'unreadable-source' };
  const raw = requireReadResult(sources);
  // Checked in canonical key order so the first invalid source is reported.
  const calendar = validateCalendarSource(raw.calendar);
  if (!calendar.valid) return { status: 'invalid-source', source: 'calendar' };
  const household = validateHouseholdSource(raw.household);
  if (!household.valid) return { status: 'invalid-source', source: 'household' };
  const places = validatePlacesSource(raw.places);
  if (!places.valid) return { status: 'invalid-source', source: 'places' };
  return {
    status: 'valid',
    raw: { calendar: raw.calendar, household: raw.household, places: raw.places },
    parsed: { calendar: calendar.parsed, household: household.parsed, places: places.parsed },
    data: {
      calendarEvents: calendar.calendarEvents,
      wasteImports: calendar.wasteImports,
      householdProfile: household.householdProfile,
      sharedPlaces: places.sharedPlaces,
    },
  };
}

// ---- Task 4: migration state machine ------------------------------------------------------

const MARKER_KEY = 'legacyMigrationV1';
const LOCK_NAME = 'majandus:legacy-migration';
const ENTITY_STORES = Object.freeze(['householdProfile', 'calendarEvents', 'sharedPlaces', 'wasteState']);
const MIGRATION_STORES = Object.freeze(['meta', ...ENTITY_STORES]);
const EXTRAS_KEYS = Object.freeze([CALENDAR_EXTRAS_KEY, HOUSEHOLD_EXTRAS_KEY]);
const SINGLETON_STORES = Object.freeze({ household: 'householdProfile', waste: 'wasteState' });
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

// A guard decided the run cannot continue; it carries the public status.
class MigrationStop extends Error {
  constructor(status) {
    super(status);
    this.name = 'MigrationStop';
    this.migrationStatus = status;
  }
}

// An IndexedDB boundary failure; never a contract violation of our own code.
class MigrationStorageFailure extends Error {
  constructor(cause) {
    super('Local replica operation failed');
    this.name = 'MigrationStorageFailure';
    this.cause = cause;
  }
}

const stop = status => { throw new MigrationStop(status); };
const outcome = status => ({ status, legacyMutated: false });

// Every replica interaction passes through here so only real storage failures become write-failed.
async function replicaWork(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MigrationStop) throw error;
    throw new MigrationStorageFailure(error);
  }
}

const isUniqueStringList = value => Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;

// Marker timestamps are accepted exactly where Task 2 record timestamps are.
function isAcceptedTimestamp(value) {
  try {
    validateCalendarEventRecord({ id: 'marker-timestamp-probe', payload: {}, revision: 0, updatedAt: value, deletedAt: null, syncStatus: 'local' });
    return true;
  } catch {
    return false;
  }
}

const MARKER_FIELDS = Object.freeze([
  'generatedIds', 'key', 'migratedCalendarIds', 'migratedMetaKeys', 'migratedSingletonKeys',
  'preparationId', 'preparedAt', 'sourceDigest', 'status',
]);

function isMigrationMarker(record) {
  if (!isRecordObject(record)) return false;
  const keys = Object.keys(record).sort();
  if (keys.length !== MARKER_FIELDS.length || keys.some((key, index) => key !== MARKER_FIELDS[index])) return false;
  if (record.key !== MARKER_KEY) return false;
  if (record.status !== 'prepared' && record.status !== 'complete') return false;
  if (!isNonEmptyString(record.preparationId)) return false;
  if (typeof record.sourceDigest !== 'string' || !DIGEST_PATTERN.test(record.sourceDigest)) return false;
  if (!isAcceptedTimestamp(record.preparedAt)) return false;
  if (!isRecordObject(record.generatedIds) || Object.keys(record.generatedIds).length !== 1) return false;
  if (!isUniqueStringList(record.generatedIds.sharedPlaces)) return false;
  if (!isUniqueStringList(record.migratedCalendarIds)) return false;
  if (!isUniqueStringList(record.migratedMetaKeys) || !record.migratedMetaKeys.every(key => EXTRAS_KEYS.includes(key))) return false;
  if (!isUniqueStringList(record.migratedSingletonKeys) || !record.migratedSingletonKeys.every(key => Object.hasOwn(SINGLETON_STORES, key))) return false;
  return true;
}

function markerFor(prepared, sourceDigest, preparedAt) {
  const { householdProfile, calendarEvents, sharedPlaces, wasteState, meta } = prepared.replica;
  const marker = {
    key: MARKER_KEY,
    status: 'prepared',
    preparationId: prepared.preparationId,
    sourceDigest,
    preparedAt,
    generatedIds: { sharedPlaces: [...prepared.generatedIds.sharedPlaces] },
    migratedCalendarIds: calendarEvents.map(record => record.id),
    migratedMetaKeys: meta.map(record => record.key),
    migratedSingletonKeys: [...(householdProfile ? ['household'] : []), ...(wasteState ? ['waste'] : [])],
  };
  // Validates preparedAt itself, including a clean install that writes no domain records.
  if (!isMigrationMarker(marker)) throw new TypeError('Migration marker is invalid; check the injected now() timestamp');
  return marker;
}

const sameOwnership = (left, right) => left.preparationId === right.preparationId
  && left.sourceDigest === right.sourceDigest
  && strictEqual(left.generatedIds.sharedPlaces, right.generatedIds.sharedPlaces)
  && strictEqual(left.migratedCalendarIds, right.migratedCalendarIds)
  && strictEqual(left.migratedMetaKeys, right.migratedMetaKeys)
  && strictEqual(left.migratedSingletonKeys, right.migratedSingletonKeys);

const expectedReplica = prepared => {
  const { outbox, ...expected } = prepared.replica;
  return expected;
};

async function assertTargetSpaceFree(stores) {
  for (const name of ENTITY_STORES) {
    if (await requestResult(stores[name].count()) > 0) stop('replica-not-empty');
  }
  for (const key of EXTRAS_KEYS) {
    if (await requestResult(stores.meta.get(key)) !== undefined) stop('replica-not-empty');
  }
}

function writePrepared(stores, prepared, marker) {
  const { householdProfile, calendarEvents, sharedPlaces, wasteState, meta } = prepared.replica;
  if (householdProfile) stores.householdProfile.put(householdProfile);
  if (wasteState) stores.wasteState.put(wasteState);
  for (const record of calendarEvents) stores.calendarEvents.put(record);
  for (const record of sharedPlaces) stores.sharedPlaces.put(record);
  for (const record of meta) stores.meta.put(record);
  stores.meta.put(marker);
}

const readMarker = replica => replicaWork(async () => {
  const record = await replica.transact(MIGRATION_STORES, 'readonly', ({ stores }) => requestResult(stores.meta.get(MARKER_KEY)));
  return record ?? null;
});

// Transaction A: the whole prepared state and its marker commit together, or nothing does.
const transactionA = (replica, prepared, marker) => replicaWork(() => replica.transact(MIGRATION_STORES, 'readwrite', async ({ stores }) => {
  if (await requestResult(stores.meta.get(MARKER_KEY)) !== undefined) stop('concurrent-migration');
  await assertTargetSpaceFree(stores);
  writePrepared(stores, prepared, marker);
}));

// C+A: guarded deletion of marker-owned records and the rebuild share one transaction, so an
// aborted rebuild leaves the old preparation and unrelated records intact.
const cleanupAndRebuild = (replica, observed, prepared, marker) => replicaWork(() => replica.transact(MIGRATION_STORES, 'readwrite', async ({ stores }) => {
  const current = await requestResult(stores.meta.get(MARKER_KEY));
  if (!isMigrationMarker(current) || current.status !== 'prepared'
    || current.preparationId !== observed.preparationId || current.sourceDigest !== observed.sourceDigest) stop('concurrent-migration');
  const deletions = [
    ...current.migratedCalendarIds.map(id => stores.calendarEvents.delete(id)),
    ...current.generatedIds.sharedPlaces.map(id => stores.sharedPlaces.delete(id)),
    ...current.migratedMetaKeys.map(key => stores.meta.delete(key)),
    ...current.migratedSingletonKeys.map(key => stores[SINGLETON_STORES[key]].delete(key)),
    stores.meta.delete(MARKER_KEY),
  ];
  for (const request of deletions) await requestResult(request);
  await assertTargetSpaceFree(stores);
  writePrepared(stores, prepared, marker);
}));

// Transaction B: only a marker that still matches this execution becomes complete.
const transactionB = (replica, marker) => replicaWork(() => replica.transact(['meta'], 'readwrite', async ({ stores }) => {
  const current = await requestResult(stores.meta.get(MARKER_KEY));
  if (!isMigrationMarker(current) || current.status !== 'prepared' || !sameOwnership(current, marker)) stop('concurrent-migration');
  stores.meta.put({ ...current, status: 'complete' });
}));

// Verification reads only marker-owned keys; unrelated records never fail it.
const readOwnedReplica = (replica, marker) => replicaWork(() => replica.transact(MIGRATION_STORES, 'readonly', async ({ stores }) => {
  const singleton = async key => (marker.migratedSingletonKeys.includes(key)
    ? (await requestResult(stores[SINGLETON_STORES[key]].get(key))) ?? null
    : null);
  const householdProfile = await singleton('household');
  const wasteState = await singleton('waste');
  const calendarEvents = [];
  for (const id of marker.migratedCalendarIds) calendarEvents.push((await requestResult(stores.calendarEvents.get(id))) ?? null);
  const sharedPlaces = [];
  for (const id of marker.generatedIds.sharedPlaces) sharedPlaces.push((await requestResult(stores.sharedPlaces.get(id))) ?? null);
  const meta = [];
  for (const key of marker.migratedMetaKeys) meta.push((await requestResult(stores.meta.get(key))) ?? null);
  return { householdProfile, calendarEvents, sharedPlaces, wasteState, meta };
}));

async function verifyOwnedReplica(replica, marker, prepared) {
  const actual = await readOwnedReplica(replica, marker);
  if (!verifyReplica({ expected: expectedReplica(prepared), actual })) stop('verification-failed');
}

function prepareCurrentSource(validated, { newId, newPreparationId, now }) {
  const preparedAt = now();
  const prepared = prepareLegacyMigration({
    validated, newId, now: () => preparedAt, preparationId: newPreparationId(),
  });
  return { prepared, preparedAt };
}

async function migrateFreshSource({ replica, sources, digest, newId, newPreparationId, now }) {
  const validated = validateLegacySources(sources);
  if (validated.status !== 'valid') return outcome('invalid-source');
  const { prepared, preparedAt } = prepareCurrentSource(validated, { newId, newPreparationId, now });
  const marker = markerFor(prepared, digest, preparedAt);
  await transactionA(replica, prepared, marker);
  await verifyOwnedReplica(replica, marker, prepared);
  await transactionB(replica, marker);
  return outcome('completed');
}

async function recoverPreparedMigration({ replica, sources, marker }) {
  const validated = validateLegacySources(sources);
  if (validated.status !== 'valid') return outcome('invalid-source');
  let prepared;
  try {
    prepared = prepareLegacyMigration({
      validated,
      now: () => marker.preparedAt,
      preparationId: marker.preparationId,
      savedIds: { sharedPlaces: marker.generatedIds.sharedPlaces },
    });
  } catch (error) {
    // Saved identities cannot be reused for this same-digest source: treat the marker as unusable.
    if (error instanceof TypeError) return outcome('replica-not-empty');
    throw error;
  }
  const actual = await readOwnedReplica(replica, marker);
  if (verifyReplica({ expected: expectedReplica(prepared), actual })) {
    await transactionB(replica, marker);
    return outcome('prepared-recovered');
  }
  const rebuilt = markerFor(prepared, marker.sourceDigest, marker.preparedAt);
  await cleanupAndRebuild(replica, marker, prepared, rebuilt);
  await verifyOwnedReplica(replica, rebuilt, prepared);
  await transactionB(replica, rebuilt);
  return outcome('prepared-recovered');
}

async function repreparePreparedMigration({ replica, sources, digest, marker, newId, newPreparationId, now }) {
  const validated = validateLegacySources(sources);
  if (validated.status !== 'valid') return outcome('invalid-source');
  const { prepared, preparedAt } = prepareCurrentSource(validated, { newId, newPreparationId, now });
  const next = markerFor(prepared, digest, preparedAt);
  await cleanupAndRebuild(replica, marker, prepared, next);
  await verifyOwnedReplica(replica, next, prepared);
  await transactionB(replica, next);
  return outcome('reprepared');
}

async function executeMigration({ replica, storage, cryptoApi, newId, newPreparationId, now }) {
  const sources = readLegacySources(storage);
  if (sources.status !== 'readable') return outcome('unreadable-source');
  const digest = await sourceDigest(sources, cryptoApi);
  const marker = await readMarker(replica);
  if (marker === null) return migrateFreshSource({ replica, sources, digest, newId, newPreparationId, now });
  if (!isMigrationMarker(marker)) return outcome('replica-not-empty');
  if (marker.status === 'complete') {
    return outcome(marker.sourceDigest === digest ? 'already-complete' : 'source-changed-after-complete');
  }
  return marker.sourceDigest === digest
    ? recoverPreparedMigration({ replica, sources, marker })
    : repreparePreparedMigration({ replica, sources, digest, marker, newId, newPreparationId, now });
}

// Legacy storage is only ever read. Correctness comes from the marker re-checks inside
// transactions A, B and C+A; an injected lock is supplemental serialization only.
export async function runLegacyMigration({ replica, storage, cryptoApi, newId, newPreparationId, now, locks } = {}) {
  const run = async () => {
    try {
      return await executeMigration({ replica, storage, cryptoApi, newId, newPreparationId, now });
    } catch (error) {
      if (error instanceof MigrationStop) return outcome(error.migrationStatus);
      if (error instanceof MigrationStorageFailure) return outcome('write-failed');
      throw error;
    }
  };
  return locks ? locks.request(LOCK_NAME, run) : run();
}
