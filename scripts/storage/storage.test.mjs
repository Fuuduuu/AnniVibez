import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as legacyMigration from '../../src/storage/legacyMigration.js';
import { LEGACY_SHARED_KEYS, readLegacySources } from '../../src/storage/legacyMigration.js';
import { EVENT_STORAGE_KEY, createEventRepository } from '../../src/calendar/eventRepository.js';
import { HOUSEHOLD_KEY, createHouseholdRepository } from '../../src/waste/householdRepository.js';
import {
  createLocalReplica, validateCalendarEventRecord, validateHouseholdProfileRecord, validateSharedPlaceRecord, validateWasteStateRecord,
} from '../../src/storage/localReplica.js';
import { openMajandusDb } from '../../src/storage/indexedDb.js';
import { normalizePlace as runtimeNormalizePlace, normalizePlaces as runtimeNormalizePlaces } from '../../src/places/savedPlaces.js';

const [CALENDAR_KEY, HOUSEHOLD_PROFILE_KEY, PLACES_KEY] = LEGACY_SHARED_KEYS;

// Records every property touched on the storage object; only getItem is permitted.
function spyStorage(values = {}, { throwOn, returnFor } = {}) {
  const accessed = [];
  const requests = [];
  const target = {
    getItem(key) {
      requests.push(key);
      if (key === throwOn) throw new Error('storage blocked');
      if (returnFor && Object.hasOwn(returnFor, key)) return returnFor[key];
      return Object.hasOwn(values, key) ? values[key] : null;
    },
  };
  const storage = new Proxy(target, {
    get(object, property) {
      accessed.push(property);
      if (property !== 'getItem') throw new Error(`forbidden storage access: ${String(property)}`);
      return object[property];
    },
    set() { throw new Error('storage mutation is forbidden'); },
  });
  return { storage, accessed, requests };
}

function approvedOnlyStorage(values = {}) {
  const requests = [];
  return {
    requests,
    getItem(key) {
      if (!LEGACY_SHARED_KEYS.includes(key)) throw new Error(`unexpected key: ${key}`);
      requests.push(key);
      return Object.hasOwn(values, key) ? values[key] : null;
    },
    setItem() { throw new Error('writes are forbidden'); },
    key() { throw new Error('enumeration is forbidden'); },
    get length() { throw new Error('enumeration is forbidden'); },
  };
}

test('legacy source reader distinguishes unreadable storage and reads only approved keys in order', () => {
  assert.equal(readLegacySources(null).status, 'unreadable-source');
  assert.equal(readLegacySources(undefined).status, 'unreadable-source');
  const storage = approvedOnlyStorage();
  const sources = readLegacySources(storage);
  assert.equal(sources.status, 'readable');
  assert.deepEqual(storage.requests, LEGACY_SHARED_KEYS);
});

test('approved legacy keys are exactly the three repository-owned shared keys in canonical order', () => {
  assert.deepEqual([...LEGACY_SHARED_KEYS], ['majamajandus_household_events_v1', 'majamajandus_household_profile_v1', 'sade_saved_places']);
  assert.equal(CALENDAR_KEY, EVENT_STORAGE_KEY);
  assert.equal(HOUSEHOLD_PROFILE_KEY, HOUSEHOLD_KEY);
  assert.ok(Object.isFrozen(LEGACY_SHARED_KEYS));
});

test('legacy source reader returns exact unreadable shape for null and undefined storage', () => {
  assert.deepEqual(readLegacySources(null), { status: 'unreadable-source', raw: null });
  assert.deepEqual(readLegacySources(undefined), { status: 'unreadable-source', raw: null });
});

test('legacy source reader returns the exact readable raw snapshot using only getItem', () => {
  const { storage, accessed, requests } = spyStorage({ [CALENDAR_KEY]: '{"a":1}', [HOUSEHOLD_PROFILE_KEY]: '', [PLACES_KEY]: '[]' });
  assert.deepEqual(readLegacySources(storage), { status: 'readable', raw: { calendar: '{"a":1}', household: '', places: '[]' } });
  assert.deepEqual(requests, [...LEGACY_SHARED_KEYS]);
  assert.ok(accessed.every(property => property === 'getItem'));
});

test('legacy source reader treats all-absent sources as a readable clean install', () => {
  const { storage } = spyStorage();
  assert.deepEqual(readLegacySources(storage), { status: 'readable', raw: { calendar: null, household: null, places: null } });
});

test('legacy source reader treats an empty string as present data, never as absent', () => {
  const { storage } = spyStorage({ [PLACES_KEY]: '' });
  assert.equal(readLegacySources(storage).raw.places, '');
});

for (const key of LEGACY_SHARED_KEYS) {
  test(`legacy source reader exposes no partial snapshot when getItem throws for ${key}`, () => {
    const { storage, requests } = spyStorage({ [CALENDAR_KEY]: '{}', [HOUSEHOLD_PROFILE_KEY]: '{}', [PLACES_KEY]: '[]' }, { throwOn: key });
    assert.deepEqual(readLegacySources(storage), { status: 'unreadable-source', raw: null });
    assert.deepEqual(requests, LEGACY_SHARED_KEYS.slice(0, LEGACY_SHARED_KEYS.indexOf(key) + 1));
  });
}

test('legacy source reader treats storage without a callable getItem as unreadable', () => {
  assert.deepEqual(readLegacySources({}), { status: 'unreadable-source', raw: null });
});

test('legacy source reader treats a non-string, non-null value as unreadable rather than absent', () => {
  for (const value of [undefined, 0, {}, false]) {
    const { storage } = spyStorage({}, { returnFor: { [HOUSEHOLD_PROFILE_KEY]: value } });
    assert.deepEqual(readLegacySources(storage), { status: 'unreadable-source', raw: null });
  }
});

// ---- validation -------------------------------------------------------------------------

const legacyEvent = (id, extra = {}) => ({
  id, title: 'Prügivedu', category: 'waste', subtype: 'bio', date: '2026-09-20', time: null,
  recurrence: { frequency: 'none', interval: 1 }, reminder: { daysBefore: 0 }, source: 'manual',
  householdId: null, notes: '', seriesId: null, excludedDates: [], overrides: {}, ...extra,
});
const calendarRaw = envelope => JSON.stringify(envelope);
const readable = ({ calendar = null, household = null, places = null } = {}) =>
  readLegacySources(spyStorage({ [CALENDAR_KEY]: calendar, [HOUSEHOLD_PROFILE_KEY]: household, [PLACES_KEY]: places }).storage);
const validate = raw => legacyMigration.validateLegacySources(readable(raw));
// Independent parity oracle: the current repositories reading the same raw string.
const repositoryStorage = (key, raw) => ({ getItem: requested => (requested === key ? raw : null) });

const VALID_CALENDAR = calendarRaw({ version: 1, events: [legacyEvent('event-b', { title: '  Paber  ' }), legacyEvent('event-a')], wasteImports: [] });
const VALID_HOUSEHOLD = JSON.stringify({ version: 1, profile: { name: '  Kodu  ', address: ' Tamme 5 ' } });
const VALID_PLACES = JSON.stringify([{ name: 'Kodu', address: 'Tamme 5', lat: 59.35, lon: 26.36 }]);

test('validation maps unreadable sources to the exact unreadable status', () => {
  assert.deepEqual(legacyMigration.validateLegacySources({ status: 'unreadable-source', raw: null }), { status: 'unreadable-source' });
});

test('validation rejects arguments that are not a legacy source read result', () => {
  for (const input of [undefined, null, {}, { status: 'readable' }, { status: 'readable', raw: { calendar: 1, household: null, places: null } }]) {
    assert.throws(() => legacyMigration.validateLegacySources(input), TypeError);
  }
});

test('validation accepts an all-absent clean install with empty data and no singletons', () => {
  assert.deepEqual(validate(), {
    status: 'valid',
    raw: { calendar: null, household: null, places: null },
    parsed: { calendar: null, household: null, places: null },
    data: { calendarEvents: [], wasteImports: undefined, householdProfile: null, sharedPlaces: [] },
  });
});

test('valid calendar source matches current repository output and retains event IDs', () => {
  const result = validate({ calendar: VALID_CALENDAR });
  const repository = createEventRepository(repositoryStorage(EVENT_STORAGE_KEY, VALID_CALENDAR)).load();
  assert.equal(result.status, 'valid');
  assert.deepEqual(result.data.calendarEvents, repository.events);
  assert.deepEqual(result.data.calendarEvents.map(event => event.id), ['event-b', 'event-a']);
  assert.equal(result.data.calendarEvents[0].title, 'Paber');
  assert.deepEqual(result.data.wasteImports, []);
  assert.deepEqual(result.parsed.calendar, JSON.parse(VALID_CALENDAR));
  assert.equal(result.raw.calendar, VALID_CALENDAR);
});

test('calendar source without wasteImports leaves wasteImports undefined', () => {
  const result = validate({ calendar: calendarRaw({ version: 1, events: [] }) });
  assert.equal(result.status, 'valid');
  assert.ok(Object.hasOwn(result.data, 'wasteImports'));
  assert.equal(result.data.wasteImports, undefined);
});

test('malformed or repository-invalid calendar sources are invalid, never absent', () => {
  const invalid = [
    '', '{oops', 'null', '[]', '{}', calendarRaw({ version: 2, events: [] }), calendarRaw({ version: 1, events: {} }),
    calendarRaw({ version: 1, events: [legacyEvent('x', { category: 'unknown' })] }),
    calendarRaw({ version: 1, events: [legacyEvent('dup'), legacyEvent('dup')] }),
    calendarRaw({ version: 1, events: [], wasteImports: 'nope' }),
  ];
  for (const calendar of invalid) {
    assert.equal(createEventRepository(repositoryStorage(EVENT_STORAGE_KEY, calendar)).load().writable, false, `oracle agrees ${calendar}`);
    assert.deepEqual(validate({ calendar, household: VALID_HOUSEHOLD, places: VALID_PLACES }), { status: 'invalid-source', source: 'calendar' }, calendar);
  }
});

test('valid household source preserves current repository normalization including trimming', () => {
  const result = validate({ household: VALID_HOUSEHOLD });
  const repository = createHouseholdRepository(repositoryStorage(HOUSEHOLD_KEY, VALID_HOUSEHOLD)).load();
  assert.deepEqual(result.data.householdProfile, repository.profile);
  assert.deepEqual(result.data.householdProfile, { name: 'Kodu', address: 'Tamme 5' });
  assert.deepEqual(result.parsed.household, JSON.parse(VALID_HOUSEHOLD));
  assert.equal(validate({ household: JSON.stringify({ version: 1, profile: { name: 'x'.repeat(100), address: '' } }) }).status, 'valid');
});

test('household invalid parity covers version 2, null profile, overlong name and malformed JSON', () => {
  const invalid = [
    JSON.stringify({ version: 2, profile: { name: 'Kodu', address: '' } }),
    JSON.stringify({ version: 1, profile: null }),
    JSON.stringify({ version: 1, profile: { name: 'x'.repeat(101), address: '' } }),
    '{oops', '', 'null',
  ];
  for (const household of invalid) {
    assert.equal(createHouseholdRepository(repositoryStorage(HOUSEHOLD_KEY, household)).load().writable, false, `oracle agrees ${household}`);
    assert.deepEqual(validate({ calendar: VALID_CALENDAR, household, places: VALID_PLACES }), { status: 'invalid-source', source: 'household' }, household);
  }
});

test('malformed or non-array places sources are invalid, never absent', () => {
  for (const places of ['', '[oops', '{}', 'null', '"text"', '3']) {
    assert.deepEqual(validate({ calendar: VALID_CALENDAR, household: VALID_HOUSEHOLD, places }), { status: 'invalid-source', source: 'places' }, places);
  }
  const result = validate({ places: VALID_PLACES });
  assert.equal(result.status, 'valid');
  assert.equal(result.data.sharedPlaces.length, 1);
  assert.deepEqual(result.parsed.places, JSON.parse(VALID_PLACES));
});

test('validation reports the first invalid source in canonical key order', () => {
  assert.deepEqual(validate({ calendar: '{oops', household: '{oops', places: '{oops' }), { status: 'invalid-source', source: 'calendar' });
  assert.deepEqual(validate({ calendar: VALID_CALENDAR, household: '{oops', places: '{oops' }), { status: 'invalid-source', source: 'household' });
});

// ---- saved-place parity -----------------------------------------------------------------

// Differential oracle: the neutral runtime normalizer in src/places/savedPlaces.js (C2), the same code
// both saved-place hooks run. Legacy migration keeps its own mirror and never pads missing items.

const PLACE_GOLDEN = [
  [null, { name: 'Kodu', address: '', lat: null, lon: null }],
  [42, { name: 'Kool', address: '', lat: null, lon: null }],
  ['Tamme 5', { name: 'Trenn', address: '', lat: null, lon: null }],
  [{ name: '   ', address: 5, lat: 'abc', lon: {} }, { name: 'Koht', address: '', lat: null, lon: null }],
  [{ name: '  Pood  ', address: '  Keskväljak 1 ', lat: '59.5', lon: '26.4abc' }, { name: 'Pood', address: '  Keskväljak 1 ', lat: 59.5, lon: 26.4 }],
  [{ name: 'Trenn' }, { name: 'Trenn', address: '', lat: null, lon: null }],
  [{ name: 7, lat: 0, lon: '-12.25' }, { name: 'Koht', address: '', lat: 0, lon: -12.25 }],
  [{ name: 'Kool', lat: true, lon: null }, { name: 'Kool', address: '', lat: null, lon: null }],
  [[], { name: 'Koht', address: '', lat: null, lon: null }],
  [{ id: 'legacy-id', name: 'Park', address: 'Park 1', lat: 59.3, lon: 26.3, extra: true }, { name: 'Park', address: 'Park 1', lat: 59.3, lon: 26.3 }],
];

test('saved-place normalization matches the golden table and the live runtime normalizePlace', () => {
  const places = PLACE_GOLDEN.map(([item]) => item);
  const result = validate({ places: JSON.stringify(places) });
  assert.equal(result.status, 'valid');
  assert.deepEqual(result.data.sharedPlaces, PLACE_GOLDEN.map(([, expected]) => expected));
  const parsedItems = JSON.parse(JSON.stringify(places));
  assert.deepEqual(result.data.sharedPlaces, parsedItems.map((item, index) => runtimeNormalizePlace(item, index)));
});

test('legacy place normalization equals the neutral runtime normalizer for every actual legacy item', () => {
  const items = [
    { name: 'Kodu', address: 'Tamme 1, Rakvere', lat: 59.34, lon: 26.35 }, null, { name: '   ', address: 'A' },
    { name: '  Pood  ', address: '  Keskväljak 1 ' }, { name: 42 }, { name: 'Park', address: 12 },
    { name: 'A', lat: 0, lon: -12.25 }, { name: 'A', lat: '59.5', lon: ' 26.4abc' }, { name: 'A', lat: '1e3', lon: '-0.5' },
    { name: 'A', lat: 'abc', lon: {} }, { name: 'A', lat: true, lon: null }, { name: 'A', lat: 'Infinity', lon: 'NaN' },
    {}, 'Tamme 5', [], { id: 'legacy-id', name: 'Park', address: 'Park 1', lat: 59.3, lon: 26.3, extra: true, order: 4 },
  ];
  for (const count of [0, 1, 3, 5, items.length]) {
    const slice = items.slice(0, count);
    const result = validate({ places: JSON.stringify(slice) });
    assert.equal(result.status, 'valid');
    assert.deepEqual(result.data.sharedPlaces, JSON.parse(JSON.stringify(slice)).map((item, index) => runtimeNormalizePlace(item, index)), `${count} items`);
    assert.equal(result.data.sharedPlaces.length, count, 'legacy migration never pads');
    if (count < 3) assert.equal(runtimeNormalizePlaces(JSON.parse(JSON.stringify(slice))).length, 3, 'the runtime loader still pads');
  }
});

test('saved places are never padded with runtime defaults', () => {
  assert.deepEqual(validate({ places: '[]' }).data.sharedPlaces, []);
  assert.deepEqual(validate({ places: JSON.stringify([{ name: 'Ainult' }]) }).data.sharedPlaces, [{ name: 'Ainult', address: '', lat: null, lon: null }]);
  assert.equal(validate({ places: JSON.stringify([null, null]) }).data.sharedPlaces.length, 2);
});

// ---- source digest ----------------------------------------------------------------------

const sha256Hex = text => createHash('sha256').update(text, 'utf8').digest('hex');
const digestInput = raw => JSON.stringify([raw.calendar, raw.household, raw.places]);

test('source digest is lowercase SHA-256 hex over exactly the raw source tuple', async () => {
  const raw = { calendar: VALID_CALENDAR, household: VALID_HOUSEHOLD, places: JSON.stringify([{ name: 'Tänav ÕÄÖÜ' }]) };
  const digest = await legacyMigration.sourceDigest(readable(raw), globalThis.crypto);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, sha256Hex(digestInput(raw)));
  assert.equal(await legacyMigration.sourceDigest(readable(), globalThis.crypto), sha256Hex('[null,null,null]'));
});

test('source digest hashes only the raw JSON tuple bytes through the injected crypto API', async () => {
  const calls = [];
  const cryptoApi = { subtle: { digest: async (algorithm, bytes) => {
    calls.push({ algorithm, text: new TextDecoder().decode(bytes) });
    return globalThis.crypto.subtle.digest(algorithm, bytes);
  } } };
  const raw = { calendar: VALID_CALENDAR, household: null, places: '' };
  await legacyMigration.sourceDigest(readable(raw), cryptoApi);
  assert.deepEqual(calls, [{ algorithm: 'SHA-256', text: digestInput(raw) }]);
});

test('source digest is deterministic, raw-sensitive and distinguishes normalization-equivalent raw data', async () => {
  const digest = raw => legacyMigration.sourceDigest(readable(raw), globalThis.crypto);
  const base = { household: VALID_HOUSEHOLD, places: VALID_PLACES };
  assert.equal(await digest(base), await digest({ ...base }));
  assert.notEqual(await digest(base), await digest({ ...base, places: '[]' }));
  const tight = JSON.stringify({ version: 1, profile: { name: 'Kodu', address: 'Tamme 5' } });
  const padded = JSON.stringify({ version: 1, profile: { name: '  Kodu ', address: 'Tamme 5  ' } });
  assert.deepEqual(validate({ household: tight }).data, validate({ household: padded }).data);
  assert.notEqual(await digest({ household: tight }), await digest({ household: padded }));
  assert.notEqual(await digest({ places: '[{"name":"A"}]' }), await digest({ places: '[ {"name":"A"} ]' }));
});

test('source digest accepts read or validated results and rejects inputs without a raw snapshot', async () => {
  const sources = readable({ places: VALID_PLACES });
  const validated = legacyMigration.validateLegacySources(sources);
  assert.equal(await legacyMigration.sourceDigest(validated, globalThis.crypto), await legacyMigration.sourceDigest(sources, globalThis.crypto));
  for (const input of [{ status: 'unreadable-source', raw: null }, { status: 'unreadable-source' }, { status: 'invalid-source', source: 'places' }, null]) {
    await assert.rejects(legacyMigration.sourceDigest(input, globalThis.crypto), TypeError);
  }
  await assert.rejects(legacyMigration.sourceDigest(sources, undefined), TypeError);
});

// ---- preparation ------------------------------------------------------------------------

const STAMP = '2026-09-15T12:00:00.000Z';
function counter(values) {
  const fn = () => {
    fn.calls += 1;
    if (fn.calls > values.length) throw new Error('unexpected extra call');
    return values[fn.calls - 1];
  };
  fn.calls = 0;
  return fn;
}
const throwingNewId = () => { throw new Error('newId must not be called'); };
const localEnvelope = { revision: 0, updatedAt: STAMP, deletedAt: null, syncStatus: 'local' };
const TWO_PLACES = JSON.stringify([{ name: ' Kodu ', address: 'Tamme 5', lat: '59.35', lon: 26.36 }, null]);
const prepare = (raw, options = {}) => legacyMigration.prepareLegacyMigration({
  validated: validate(raw), newId: counter(['place-1', 'place-2']), now: counter([STAMP]), preparationId: 'prep-1', ...options,
});

test('preparation requires a valid validation result and well-formed injected arguments', () => {
  const validated = validate({ places: TWO_PLACES });
  const base = { validated, newId: counter(['a', 'b']), now: () => STAMP, preparationId: 'prep-1' };
  for (const bad of [undefined, { status: 'unreadable-source' }, { status: 'invalid-source', source: 'places' }, { status: 'valid' }]) {
    assert.throws(() => legacyMigration.prepareLegacyMigration({ ...base, validated: bad }), TypeError);
  }
  assert.throws(() => legacyMigration.prepareLegacyMigration({ ...base, now: STAMP }), TypeError);
  assert.throws(() => legacyMigration.prepareLegacyMigration({ ...base, preparationId: '' }), TypeError);
  assert.throws(() => legacyMigration.prepareLegacyMigration({ ...base, preparationId: 7 }), TypeError);
  assert.throws(() => legacyMigration.prepareLegacyMigration({ ...base, newId: undefined }), TypeError);
  assert.throws(() => legacyMigration.prepareLegacyMigration(), TypeError);
});

test('preparation returns the exact locked shape for all three present sources', () => {
  const validated = validate({ calendar: VALID_CALENDAR, household: VALID_HOUSEHOLD, places: TWO_PLACES });
  const prepared = legacyMigration.prepareLegacyMigration({ validated, newId: counter(['place-1', 'place-2']), now: counter([STAMP]), preparationId: 'prep-1' });
  assert.deepEqual(prepared, {
    preparationId: 'prep-1',
    generatedIds: { sharedPlaces: ['place-1', 'place-2'] },
    replica: {
      householdProfile: { key: 'household', payload: { name: 'Kodu', address: 'Tamme 5', serverHouseholdId: null }, ...localEnvelope },
      calendarEvents: validated.data.calendarEvents.map(event => ({ id: event.id, payload: event, ...localEnvelope })),
      sharedPlaces: [
        { id: 'place-1', order: 0, payload: { name: 'Kodu', address: 'Tamme 5', lat: 59.35, lon: 26.36 }, ...localEnvelope },
        { id: 'place-2', order: 1, payload: { name: 'Kool', address: '', lat: null, lon: null }, ...localEnvelope },
      ],
      wasteState: { key: 'waste', payload: { wasteImports: [] }, ...localEnvelope },
      meta: [
        { key: 'calendarLegacyEnvelopeExtras', value: { sourceVersion: 1, fields: {} } },
        { key: 'householdLegacyEnvelopeExtras', value: { sourceVersion: 1, fields: {} } },
      ],
      outbox: [],
    },
  });
  assert.deepEqual(prepared.replica.calendarEvents.map(record => record.id), ['event-b', 'event-a']);
});

test('preparation calls now exactly once and stamps every record with that value', () => {
  const now = counter([STAMP]);
  const prepared = prepare({ calendar: VALID_CALENDAR, household: VALID_HOUSEHOLD, places: TWO_PLACES }, { now });
  assert.equal(now.calls, 1);
  const { householdProfile, calendarEvents, sharedPlaces, wasteState } = prepared.replica;
  assert.ok([householdProfile, ...calendarEvents, ...sharedPlaces, wasteState].every(record => record.updatedAt === STAMP));
  const cleanInstallNow = counter([STAMP]);
  const empty = prepare({}, { now: cleanInstallNow, newId: throwingNewId });
  assert.equal(cleanInstallNow.calls, 1);
  assert.deepEqual(empty.replica, { householdProfile: null, calendarEvents: [], sharedPlaces: [], wasteState: null, meta: [], outbox: [] });
  assert.deepEqual(empty.generatedIds, { sharedPlaces: [] });
});

test('calendar preparation generates no IDs and shared places generate exactly one ID each', () => {
  const calendarOnly = prepare({ calendar: VALID_CALENDAR }, { newId: throwingNewId });
  assert.deepEqual(calendarOnly.replica.calendarEvents.map(record => record.id), ['event-b', 'event-a']);
  const newId = counter(['p-1', 'p-2', 'p-3']);
  const prepared = prepare({ places: JSON.stringify([{}, {}, {}]) }, { newId });
  assert.equal(newId.calls, 3);
  assert.deepEqual(prepared.generatedIds.sharedPlaces, ['p-1', 'p-2', 'p-3']);
  assert.deepEqual(prepared.replica.sharedPlaces.map(record => [record.id, record.order]), [['p-1', 0], ['p-2', 1], ['p-3', 2]]);
});

test('saved shared-place IDs are reused exactly and never partially regenerated', () => {
  const prepared = prepare({ places: TWO_PLACES }, { newId: throwingNewId, savedIds: { sharedPlaces: ['saved-1', 'saved-2'] } });
  assert.deepEqual(prepared.generatedIds.sharedPlaces, ['saved-1', 'saved-2']);
  assert.deepEqual(prepared.replica.sharedPlaces.map(record => record.id), ['saved-1', 'saved-2']);
  const invalidSavedIds = [
    null, {}, { sharedPlaces: 'saved-1' }, { sharedPlaces: ['saved-1'] }, { sharedPlaces: ['saved-1', 'saved-2', 'saved-3'] },
    { sharedPlaces: ['saved-1', ''] }, { sharedPlaces: ['saved-1', 2] }, { sharedPlaces: ['same', 'same'] },
  ];
  for (const savedIds of invalidSavedIds) {
    const newId = counter(['fresh-1', 'fresh-2']);
    const now = counter([STAMP]);
    assert.throws(() => prepare({ places: TWO_PLACES }, { newId, now, savedIds }), TypeError, JSON.stringify(savedIds));
    assert.equal(newId.calls, 0, 'no replacement IDs are generated for rejected saved IDs');
  }
});

test('generated shared-place IDs must be unique non-empty strings', () => {
  assert.throws(() => prepare({ places: TWO_PLACES }, { newId: counter(['dup', 'dup']) }), TypeError);
  assert.throws(() => prepare({ places: TWO_PLACES }, { newId: counter(['ok', '']) }), TypeError);
});

test('household preparation keeps serverHouseholdId null and exists only for a present source', () => {
  const legacyWithServerId = JSON.stringify({ version: 1, profile: { name: 'Kodu', address: '', serverHouseholdId: 'invented-uuid' } });
  assert.equal(prepare({ household: legacyWithServerId }).replica.householdProfile.payload.serverHouseholdId, null);
  assert.equal(prepare({ calendar: VALID_CALENDAR, places: TWO_PLACES }).replica.householdProfile, null);
});

test('waste record exists only for a present calendar source that defines wasteImports', () => {
  assert.equal(prepare({ household: VALID_HOUSEHOLD }).replica.wasteState, null);
  assert.equal(prepare({ calendar: calendarRaw({ version: 1, events: [] }) }).replica.wasteState, null);
  assert.deepEqual(prepare({ calendar: VALID_CALENDAR }).replica.wasteState, { key: 'waste', payload: { wasteImports: [] }, ...localEnvelope });
});

test('envelope extras come from raw parsed envelopes and are omitted for absent sources', () => {
  const calendar = calendarRaw({ version: 1, events: [legacyEvent('e-1')], wasteImports: [], theme: 'dark', nested: { list: [1, '2'] }, writable: false, error: 'raw' });
  const household = JSON.stringify({ version: 1, profile: { name: ' Kodu ', address: '' }, note: '  raw note  ' });
  const prepared = prepare({ calendar, household });
  assert.deepEqual(prepared.replica.meta, [
    { key: 'calendarLegacyEnvelopeExtras', value: { sourceVersion: 1, fields: { theme: 'dark', nested: { list: [1, '2'] }, writable: false, error: 'raw' } } },
    { key: 'householdLegacyEnvelopeExtras', value: { sourceVersion: 1, fields: { note: '  raw note  ' } } },
  ]);
  assert.deepEqual(prepare({ household }).replica.meta.map(record => record.key), ['householdLegacyEnvelopeExtras']);
  assert.deepEqual(prepare({ calendar }).replica.meta.map(record => record.key), ['calendarLegacyEnvelopeExtras']);
});

test('every prepared domain record passes its Task 2 validator and the outbox stays empty', () => {
  const { replica } = prepare({ calendar: VALID_CALENDAR, household: VALID_HOUSEHOLD, places: TWO_PLACES });
  validateHouseholdProfileRecord(replica.householdProfile);
  validateWasteStateRecord(replica.wasteState);
  replica.calendarEvents.forEach(validateCalendarEventRecord);
  replica.sharedPlaces.forEach(validateSharedPlaceRecord);
  assert.deepEqual(replica.outbox, []);
  assert.throws(() => prepare({ places: TWO_PLACES }, { now: () => 'not-a-timestamp' }), TypeError);
});

test('preparation does not alias or mutate validated data', () => {
  const validated = validate({ calendar: VALID_CALENDAR, household: VALID_HOUSEHOLD, places: TWO_PLACES });
  const before = structuredClone(validated);
  const options = () => ({ validated, newId: counter(['place-1', 'place-2']), now: () => STAMP, preparationId: 'prep-1' });
  const first = legacyMigration.prepareLegacyMigration(options());
  first.replica.calendarEvents[0].payload.title = 'changed';
  first.replica.sharedPlaces[0].payload.name = 'changed';
  first.replica.householdProfile.payload.name = 'changed';
  first.replica.wasteState.payload.wasteImports.push('changed');
  assert.deepEqual(validated, before);
  assert.deepEqual(legacyMigration.prepareLegacyMigration(options()), legacyMigration.prepareLegacyMigration(options()));
});

// ---- replica verification ---------------------------------------------------------------

const fullReplica = () => prepare({ calendar: VALID_CALENDAR, household: VALID_HOUSEHOLD, places: TWO_PLACES }).replica;
const verify = (expected, actual) => legacyMigration.verifyReplica({ expected, actual });
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
const deepFreeze = value => {
  if (value !== null && typeof value === 'object') Object.values(Object.freeze(value)).forEach(deepFreeze);
  return value;
};
const outboxItem = (mutationId, sequence) => ({ mutationId, entityType: 'calendarEvent', entityId: 'e', operation: 'CREATE', baseRevision: 0, patch: {}, createdAt: STAMP, attemptCount: 0, lastAttemptAt: null, sequence });

test('replica verification accepts identical replicas and ignores object property order', () => {
  const expected = fullReplica();
  assert.equal(verify(expected, structuredClone(expected)), true);
  assert.equal(verify(expected, reverseKeys(expected)), true);
});

test('replica verification canonicalizes only collection ordering', () => {
  const expected = { ...fullReplica(), outbox: [outboxItem('m-1', 1), outboxItem('m-2', 2)] };
  const actual = structuredClone(expected);
  actual.calendarEvents.reverse();
  actual.sharedPlaces.reverse();
  actual.meta.reverse();
  actual.outbox.reverse();
  assert.equal(verify(expected, actual), true);
  const nested = structuredClone(expected);
  nested.calendarEvents[0].payload.excludedDates = ['2026-10-01', '2026-10-08'];
  const reorderedNested = structuredClone(nested);
  reorderedNested.calendarEvents[0].payload.excludedDates.reverse();
  assert.equal(verify(nested, reorderedNested), false, 'arrays inside records are compared exactly');
});

test('replica verification rejects missing, extra and changed data without throwing', () => {
  const expected = fullReplica();
  const mismatch = mutate => {
    const actual = structuredClone(expected);
    mutate(actual);
    return verify(expected, actual);
  };
  assert.equal(mismatch(actual => actual.calendarEvents.pop()), false, 'missing calendar event');
  assert.equal(mismatch(actual => actual.sharedPlaces.push({ ...actual.sharedPlaces[0], id: 'extra', order: 9 })), false, 'extra place');
  assert.equal(mismatch(actual => actual.meta.pop()), false, 'missing meta');
  assert.equal(mismatch(actual => { delete actual.wasteState; }), false, 'missing collection key');
  assert.equal(mismatch(actual => { actual.extra = []; }), false, 'extra top-level key');
  assert.equal(mismatch(actual => { actual.householdProfile = null; }), false, 'missing singleton');
  assert.equal(mismatch(actual => { actual.sharedPlaces[0].payload.name = 'Muu'; }), false, 'payload change');
  assert.equal(mismatch(actual => { actual.sharedPlaces[0].payload.extra = true; }), false, 'extra payload field');
  assert.equal(mismatch(actual => { actual.calendarEvents[0].revision = 1; }), false, 'revision change');
  assert.equal(mismatch(actual => { actual.calendarEvents[0].id = 'event-z'; }), false, 'id change');
  assert.equal(mismatch(actual => { actual.sharedPlaces[0].order = 1; actual.sharedPlaces[1].order = 0; }), false, 'order change');
  assert.equal(mismatch(actual => { actual.wasteState.payload.wasteImports = {}; }), false, 'array versus object');
  assert.equal(mismatch(actual => { actual.meta[0].value.sourceVersion = '1'; }), false, 'value type change');
  assert.equal(mismatch(actual => { actual.householdProfile.payload.address = undefined; }), false, 'undefined differs from a value');
  assert.equal(verify({ list: [1, , 3] }, { list: [1, undefined, 3] }), false, 'array holes differ from undefined');
  assert.equal(verify({ a: undefined }, {}), false, 'undefined property differs from a missing property');
});

test('replica verification is pure and rejects non-object arguments', () => {
  // Both sides are deep-frozen with reversed collections, so any in-place sort or mutation throws.
  const reversed = structuredClone(fullReplica());
  for (const name of ['calendarEvents', 'sharedPlaces', 'meta']) reversed[name].reverse();
  const expected = deepFreeze(fullReplica());
  const actual = deepFreeze(reverseKeys(reversed));
  const snapshot = structuredClone(actual);
  assert.equal(verify(expected, actual), true);
  assert.equal(verify(actual, expected), true);
  assert.deepEqual(actual, snapshot);
  for (const [left, right] of [[null, {}], [{}, undefined], [[], []], ['x', {}]]) {
    assert.throws(() => verify(left, right), TypeError);
  }
  assert.throws(() => legacyMigration.verifyReplica(), TypeError);
});

// ---- module boundary --------------------------------------------------------------------

test('legacy migration module exports exactly the six Task 3 interfaces plus the Task 4 executor', () => {
  assert.deepEqual(Object.keys(legacyMigration).sort(), [
    'LEGACY_SHARED_KEYS', 'prepareLegacyMigration', 'readLegacySources', 'runLegacyMigration', 'sourceDigest', 'validateLegacySources', 'verifyReplica',
  ]);
});

test('legacy migration production source names no private keys and no storage, network or Task 4 APIs', () => {
  const source = readFileSync(new URL('../../src/storage/legacyMigration.js', import.meta.url), 'utf8');
  const privateKeys = ['sade_diary_pin', 'sade_diary_entries', 'majamajandus_reminder_preferences_v1', 'majamajandus_reminder_delivery_v1', 'annivibe_saved_ideas', 'sade_saved_tips', 'sade_profile'];
  for (const key of privateKeys) assert.ok(!source.includes(key), `private key ${key}`);
  const keyLiterals = [...source.matchAll(/['"`]((?:majamajandus|sade|annivibe)_[A-Za-z0-9_]+)['"`]/g)].map(match => match[1]);
  assert.deepEqual([...new Set(keyLiterals)].sort(), [...LEGACY_SHARED_KEYS].sort());
  // Task 4 may use replica.transact and requestResult; legacy mutation, global storage handles,
  // store-wide clears, network and runtime coupling stay forbidden.
  const forbidden = ["setItem", "removeItem", "localStorage", "indexedDB", "createLocalReplica", ".clear(", "navigator.locks", "fetch(", "openMajandusDb"];
  for (const token of forbidden) assert.ok(!source.includes(token), token);
});

// Test-only private/device-local keys with sentinel values; production code never names them.
const PRIVATE_SENTINEL_VALUES = Object.freeze({
  sade_diary_pin: 'PRIVATE-SENTINEL-diary-pin-4821',
  sade_diary_entries: JSON.stringify([{ text: 'PRIVATE-SENTINEL-diary-entry-9153' }]),
  majamajandus_reminder_preferences_v1: JSON.stringify({ label: 'PRIVATE-SENTINEL-reminder-preferences-3307' }),
  majamajandus_reminder_delivery_v1: JSON.stringify(['PRIVATE-SENTINEL-reminder-delivery-6612']),
  annivibe_saved_ideas: JSON.stringify(['PRIVATE-SENTINEL-saved-idea-2048']),
  sade_saved_tips: JSON.stringify(['PRIVATE-SENTINEL-saved-tip-7719']),
  sade_profile: JSON.stringify({ name: 'PRIVATE-SENTINEL-profile-name-5580' }),
});

test('private device-local sentinels never reach source reads, digest input or prepared records', async () => {
  const household = JSON.stringify({ version: 1, profile: { name: 'Kodu', address: 'Tamme 5' }, note: 'shared household note' });
  const shared = { [CALENDAR_KEY]: VALID_CALENDAR, [HOUSEHOLD_PROFILE_KEY]: household, [PLACES_KEY]: VALID_PLACES };
  const withPrivate = spyStorage({ ...shared, ...PRIVATE_SENTINEL_VALUES });
  const sources = readLegacySources(withPrivate.storage);
  assert.equal(sources.status, 'readable');
  assert.deepEqual(withPrivate.requests, LEGACY_SHARED_KEYS);
  assert.ok(withPrivate.accessed.every(property => property === 'getItem'));

  const digestInputs = [];
  const cryptoApi = { subtle: { digest: async (algorithm, bytes) => {
    digestInputs.push(new TextDecoder().decode(bytes));
    return globalThis.crypto.subtle.digest(algorithm, bytes);
  } } };
  const digest = await legacyMigration.sourceDigest(sources, cryptoApi);
  const sharedOnly = readLegacySources(spyStorage(shared).storage);
  assert.equal(digest, await legacyMigration.sourceDigest(sharedOnly, globalThis.crypto), 'private keys do not affect the digest');

  const validated = legacyMigration.validateLegacySources(sources);
  assert.equal(validated.status, 'valid');
  const prepared = legacyMigration.prepareLegacyMigration({
    validated, newId: (() => { let next = 0; return () => `place-${++next}`; })(), now: () => '2026-09-16T10:00:00.000Z', preparationId: 'prep-1',
  });
  const targets = { digestInput: digestInputs.join('\n'), prepared, validated };
  assert.equal(digestInputs.length, 1);
  const sentinels = Object.values(PRIVATE_SENTINEL_VALUES).map(value => value.match(/PRIVATE-SENTINEL-[a-z-]+-\d{4}/)[0]);
  assert.equal(sentinels.length, 7);
  for (const [name, target] of Object.entries(targets)) {
    const text = typeof target === 'string' ? target : JSON.stringify(target);
    for (const sentinel of sentinels) assert.ok(!text.includes(sentinel), `${name} must not contain ${sentinel}`);
    for (const key of Object.keys(PRIVATE_SENTINEL_VALUES)) assert.ok(!text.includes(key), `${name} must not name ${key}`);
  }
});

test('validation generates no IDs and does not mutate its input', t => {
  const randomUUID = t.mock.method(globalThis.crypto, 'randomUUID', () => { throw new Error('validation must not mint IDs'); });
  const sources = readable({ calendar: VALID_CALENDAR, household: VALID_HOUSEHOLD, places: VALID_PLACES });
  const before = structuredClone(sources);
  const result = legacyMigration.validateLegacySources(sources);
  assert.equal(result.status, 'valid');
  assert.equal(randomUUID.mock.callCount(), 0);
  assert.deepEqual(sources, before);
  assert.ok(result.data.sharedPlaces.every(place => !Object.hasOwn(place, 'id')));
});

// ---- migration executor: pre-replica paths ------------------------------------------------

const neverReplica = new Proxy({}, { get(_target, property) { throw new Error(`replica must not be used: ${String(property)}`); } });
const migrationArguments = (overrides = {}) => ({
  replica: neverReplica,
  storage: null,
  cryptoApi: globalThis.crypto,
  newId: () => { throw new Error('newId must not be called'); },
  newPreparationId: () => { throw new Error('newPreparationId must not be called'); },
  now: () => { throw new Error('now must not be called'); },
  ...overrides,
});

test('migration returns unreadable-source without touching the replica for null and undefined storage', async () => {
  for (const storage of [null, undefined]) {
    const result = await legacyMigration.runLegacyMigration(migrationArguments({ storage }));
    assert.deepEqual(result, { status: 'unreadable-source', legacyMutated: false });
    assert.deepEqual(Object.keys(result).sort(), ['legacyMutated', 'status']);
  }
});

test('migration returns unreadable-source when an approved read throws, using only getItem', async () => {
  const { storage, accessed, requests } = spyStorage({}, { throwOn: HOUSEHOLD_PROFILE_KEY });
  const result = await legacyMigration.runLegacyMigration(migrationArguments({ storage }));
  assert.deepEqual(result, { status: 'unreadable-source', legacyMutated: false });
  assert.deepEqual(requests, LEGACY_SHARED_KEYS.slice(0, 2));
  assert.ok(accessed.every(property => property === 'getItem'));
});

test('migration runs inside a supplied lock and works without one', async () => {
  const calls = [];
  const locks = { request: (name, callback) => { calls.push(name); return callback(); } };
  const locked = await legacyMigration.runLegacyMigration(migrationArguments({ locks }));
  assert.deepEqual(locked, { status: 'unreadable-source', legacyMutated: false });
  assert.deepEqual(calls, ['majandus:legacy-migration']);
  const unlocked = await legacyMigration.runLegacyMigration(migrationArguments());
  assert.deepEqual(unlocked, { status: 'unreadable-source', legacyMutated: false });
});

// ---- C1: replica close/open race and connection-event contract ----------------------------

// Controllable IndexedDB stub: every open() returns a request the test settles by hand.
function stubIndexedDb() {
  const requests = [];
  return { requests, open(name, version) { const request = { name, version }; requests.push(request); return request; } };
}

function stubDb(label = 'db') {
  return {
    label,
    closed: false,
    closeCalls: 0,
    close() { this.closed = true; this.closeCalls += 1; },
    transaction() { throw new Error(`${label}: transaction must not be reached`); },
  };
}

const succeedOpen = (request, db) => { request.result = db; request.onsuccess(); };
const isNamed = name => error => error instanceof DOMException && error.name === name;
const settleTicks = async (count = 10) => { for (let index = 0; index < count; index += 1) await Promise.resolve(); };

async function openedReplica() {
  const indexedDb = stubIndexedDb();
  const replica = createLocalReplica({ indexedDb });
  const opening = replica.open();
  const db = stubDb('first');
  succeedOpen(indexedDb.requests[0], db);
  assert.equal(await opening, db);
  return { indexedDb, replica, db };
}

// Captures queueMicrotask callbacks scheduled during `body` instead of running them.
function captureMicrotasks(body) {
  const original = globalThis.queueMicrotask;
  const scheduled = [];
  globalThis.queueMicrotask = callback => { scheduled.push(callback); };
  try { body(); } finally { globalThis.queueMicrotask = original; }
  return scheduled;
}

test('C1 openMajandusDb without options keeps the Task 1 close-on-versionchange behavior', () => {
  const indexedDb = stubIndexedDb();
  const opening = openMajandusDb(indexedDb);
  const db = stubDb();
  succeedOpen(indexedDb.requests[0], db);
  assert.equal(typeof db.onversionchange, 'function');
  db.onversionchange({ oldVersion: 1, newVersion: 2 });
  assert.equal(db.closed, true);
  const bare = stubDb('bare');
  const second = openMajandusDb(indexedDb);
  succeedOpen(indexedDb.requests[1], bare);
  assert.doesNotThrow(() => bare.onversionchange());
  assert.equal(bare.closed, true);
  assert.doesNotThrow(() => bare.onclose?.());
  return Promise.all([opening, second]);
});

test('C1 openMajandusDb closes the handle before onVersionChange and forwards exact payloads', async () => {
  const indexedDb = stubIndexedDb();
  const calls = [];
  let db;
  const opening = openMajandusDb(indexedDb, {
    onVersionChange: payload => calls.push({ kind: 'versionchange', payload, closed: db.closed }),
    onClose: (...args) => calls.push({ kind: 'close', args }),
  });
  db = stubDb();
  succeedOpen(indexedDb.requests[0], db);
  assert.equal(await opening, db);
  db.onversionchange({ oldVersion: 1, newVersion: 2, extra: 'ignored' });
  db.onclose();
  assert.deepEqual(calls, [
    { kind: 'versionchange', payload: { oldVersion: 1, newVersion: 2 }, closed: true },
    { kind: 'close', args: [] },
  ]);
  assert.equal(db.closeCalls, 1);
});

test('C1 openMajandusDb with options keeps blocked rejection and closes a late success', async () => {
  const indexedDb = stubIndexedDb();
  const events = [];
  const opening = openMajandusDb(indexedDb, { onVersionChange: () => events.push('versionchange'), onClose: () => events.push('close') });
  const request = indexedDb.requests[0];
  request.onblocked();
  await assert.rejects(opening, isNamed('IndexedDbBlockedError'));
  const late = stubDb('late');
  succeedOpen(request, late);
  assert.equal(late.closed, true);
  assert.deepEqual(events, []);
});

test('C1 close during an in-flight open closes the late handle, rejects stale callers and allows reopen', async () => {
  const indexedDb = stubIndexedDb();
  const replica = createLocalReplica({ indexedDb });
  const staleOpen = replica.open();
  const staleTransact = replica.transact('meta', 'readonly', () => assert.fail('stale body must not run'));
  await settleTicks();
  assert.equal(indexedDb.requests.length, 1, 'concurrent callers share one in-flight open');
  let closeResolved = false;
  const closing = replica.close().then(() => { closeResolved = true; });
  await settleTicks();
  assert.equal(closeResolved, false, 'close waits for the in-flight open');
  const late = stubDb('late');
  succeedOpen(indexedDb.requests[0], late);
  await assert.rejects(staleOpen, isNamed('ReplicaClosedError'));
  await assert.rejects(staleTransact, isNamed('ReplicaClosedError'));
  await closing;
  assert.equal(late.closed, true, 'the late handle of the old generation is closed');
  assert.equal(closeResolved, true);

  const reopening = replica.open();
  assert.equal(indexedDb.requests.length, 2, 'explicit reopen starts a new open');
  const fresh = stubDb('fresh');
  succeedOpen(indexedDb.requests[1], fresh);
  assert.equal(await reopening, fresh);
  assert.equal(fresh.closed, false);
  assert.equal(await replica.open(), fresh, 'the new generation handle is reused');
  assert.equal(indexedDb.requests.length, 2);
});

test('C1 repeated close calls during one pending open all wait until the late handle is closed', async () => {
  const indexedDb = stubIndexedDb();
  const replica = createLocalReplica({ indexedDb });
  const staleOpen = replica.open();
  let closeAResolved = false;
  let closeBResolved = false;
  const closeA = replica.close().then(() => { closeAResolved = true; });
  const closeB = replica.close().then(() => { closeBResolved = true; });
  await settleTicks();
  assert.equal(closeAResolved, false, 'close A waits for the pending open');
  assert.equal(closeBResolved, false, 'close B waits for the same pending open');
  const late = stubDb('late');
  succeedOpen(indexedDb.requests[0], late);
  await assert.rejects(staleOpen, isNamed('ReplicaClosedError'));
  await Promise.all([closeA, closeB]);
  assert.equal(late.closed, true);
  assert.equal(closeAResolved && closeBResolved, true);

  const reopening = replica.open();
  assert.equal(indexedDb.requests.length, 2);
  const fresh = stubDb('fresh');
  succeedOpen(indexedDb.requests[1], fresh);
  assert.equal(await reopening, fresh);
  assert.equal(fresh.closed, false);
});

test('C1 a fresh reopen overlapping an older close survives while the stale handle is closed', async () => {
  for (const order of ['fresh-first', 'stale-first']) {
    const indexedDb = stubIndexedDb();
    const replica = createLocalReplica({ indexedDb });
    const staleOpen = replica.open();
    const staleTransact = replica.transact('meta', 'readonly', () => assert.fail('stale body must not run'));
    await settleTicks();
    let closeResolved = false;
    const closing = replica.close().then(() => { closeResolved = true; });
    const freshOpen = replica.open();
    await settleTicks();
    assert.equal(indexedDb.requests.length, 2, `${order}: the fresh generation starts its own open`);
    const late = stubDb('late');
    const fresh = stubDb('fresh');
    if (order === 'fresh-first') {
      succeedOpen(indexedDb.requests[1], fresh);
      assert.equal(await freshOpen, fresh);
      await settleTicks();
      assert.equal(closeResolved, false, `${order}: close still waits for the stale open`);
      succeedOpen(indexedDb.requests[0], late);
    } else {
      succeedOpen(indexedDb.requests[0], late);
      succeedOpen(indexedDb.requests[1], fresh);
      assert.equal(await freshOpen, fresh);
    }
    await assert.rejects(staleOpen, isNamed('ReplicaClosedError'));
    await assert.rejects(staleTransact, isNamed('ReplicaClosedError'));
    await closing;
    assert.equal(late.closed, true, `${order}: stale late handle closed`);
    assert.equal(fresh.closed, false, `${order}: the older close never closes the fresh handle`);
    assert.equal(await replica.open(), fresh, `${order}: the fresh handle stays active`);
    assert.equal(indexedDb.requests.length, 2);
  }
});

test('C1 close resolves even when the in-flight open fails, and a failed open is retryable', async () => {
  const indexedDb = stubIndexedDb();
  const replica = createLocalReplica({ indexedDb });
  const opening = replica.open();
  const closing = replica.close();
  const request = indexedDb.requests[0];
  request.error = new DOMException('boom', 'UnknownError');
  request.onerror();
  await assert.rejects(opening, isNamed('UnknownError'));
  await closing;
  const retry = replica.open();
  const db = stubDb();
  succeedOpen(indexedDb.requests[1], db);
  assert.equal(await retry, db);
});

test('C1 versionchange closes the handle first, delivers the exact event and makes the replica terminally lost', async () => {
  const { indexedDb, replica, db } = await openedReplica();
  const received = [];
  replica.subscribe(event => received.push({ event, closed: db.closed }));
  db.onversionchange({ oldVersion: 1, newVersion: 2 });
  assert.deepEqual(received, [{ event: { type: 'versionchange', oldVersion: 1, newVersion: 2 }, closed: true }]);
  assert.deepEqual(Object.keys(received[0].event), ['type', 'oldVersion', 'newVersion']);
  await assert.rejects(replica.open(), isNamed('ReplicaConnectionLostError'));
  await assert.rejects(replica.transact('meta', 'readonly', () => assert.fail('body must not run')), isNamed('ReplicaConnectionLostError'));
  await assert.rejects(replica.getMeta('any'), isNamed('ReplicaConnectionLostError'));
  assert.equal(indexedDb.requests.length, 1, 'no further indexedDb.open call after loss');
  await replica.close();
  await assert.rejects(replica.open(), isNamed('ReplicaConnectionLostError'), 'close does not recover a lost replica');
  assert.equal(indexedDb.requests.length, 1);
  assert.equal(db.closeCalls, 1);
});

test('C1 browser-initiated close delivers exactly { type: close } and the same lost behavior', async () => {
  const { indexedDb, replica, db } = await openedReplica();
  const received = [];
  replica.subscribe(event => received.push(event));
  db.onclose();
  assert.deepEqual(received, [{ type: 'close' }]);
  assert.deepEqual(Object.keys(received[0]), ['type']);
  await assert.rejects(replica.transact('meta', 'readonly', () => assert.fail('body must not run')), isNamed('ReplicaConnectionLostError'));
  await assert.rejects(replica.open(), isNamed('ReplicaConnectionLostError'));
  assert.equal(indexedDb.requests.length, 1);
  await replica.close();
});

test('C1 listeners run synchronously in subscription order; a throwing listener does not block later ones', async () => {
  const { replica, db } = await openedReplica();
  const order = [];
  const first = new Error('first listener failure');
  const second = new Error('second listener failure');
  replica.subscribe(() => { order.push('a'); throw first; });
  replica.subscribe(() => { order.push('b'); throw second; });
  replica.subscribe(() => { order.push('c'); });
  const scheduled = captureMicrotasks(() => {
    db.onversionchange({ oldVersion: 1, newVersion: 2 });
    assert.deepEqual(order, ['a', 'b', 'c'], 'delivery is synchronous and complete before returning');
  });
  assert.equal(scheduled.length, 1, 'exactly one microtask rethrows');
  assert.throws(() => scheduled[0](), error => error === first);
});

test('C1 unsubscribe is idempotent and prevents delivery without affecting other listeners', async () => {
  const { replica, db } = await openedReplica();
  const calls = [];
  const unsubscribeA = replica.subscribe(() => calls.push('a'));
  const unsubscribeB = replica.subscribe(() => calls.push('b'));
  assert.equal(typeof unsubscribeA, 'function');
  unsubscribeA();
  assert.doesNotThrow(() => unsubscribeA());
  db.onclose();
  assert.deepEqual(calls, ['b']);
  unsubscribeB();
  unsubscribeB();
});

test('C1 connection events from a stale generation are ignored', async () => {
  const { indexedDb, replica, db } = await openedReplica();
  const received = [];
  replica.subscribe(event => received.push(event));
  await replica.close();
  assert.equal(db.closed, true);
  db.onversionchange({ oldVersion: 1, newVersion: 2 });
  db.onclose();
  assert.deepEqual(received, []);
  const reopening = replica.open();
  assert.equal(indexedDb.requests.length, 2, 'the replica is not lost');
  const fresh = stubDb('fresh');
  succeedOpen(indexedDb.requests[1], fresh);
  assert.equal(await reopening, fresh);

  // A late handle from a race is stale too.
  const race = createLocalReplica({ indexedDb });
  const raceEvents = [];
  race.subscribe(event => raceEvents.push(event));
  const pending = race.open();
  const closing = race.close();
  const late = stubDb('late');
  succeedOpen(indexedDb.requests[2], late);
  await assert.rejects(pending, isNamed('ReplicaClosedError'));
  await closing;
  late.onversionchange?.({ oldVersion: 1, newVersion: 2 });
  late.onclose?.();
  assert.deepEqual(raceEvents, []);
});

// ---- Task 6: dormant guard -----------------------------------------------------------------

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const toRepositoryPath = absolute => relative(repositoryRoot, absolute).split('\\').join('/');
const STORAGE_DIRECTORY = 'src/storage';
const CODE_FILE = /\.(?:[cm]?jsx?|tsx?)$/;
const NON_CODE_FILE = /\.css$/;

// Deterministic, sorted walk of every file under src/ outside src/storage/.
function runtimeSourceFiles() {
  const files = [];
  const walk = directory => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = toRepositoryPath(absolute);
      if (path === STORAGE_DIRECTORY) continue;
      if (entry.isDirectory()) walk(absolute);
      else files.push(path);
    }
  };
  walk(join(repositoryRoot, 'src'));
  return files;
}

const insideStorage = path => path === STORAGE_DIRECTORY || path.startsWith(`${STORAGE_DIRECTORY}/`);

// Resolves a module specifier written in repository file `file` to a repository path, or null for packages.
function resolveSpecifier(file, specifier) {
  if (specifier.startsWith('.')) return toRepositoryPath(resolve(repositoryRoot, dirname(file), specifier));
  if (specifier.startsWith('/')) return toRepositoryPath(resolve(repositoryRoot, `.${specifier}`));
  return /(?:^|\/)src\/storage(?:\/|$)/.test(specifier) ? STORAGE_DIRECTORY : null;
}

// Returns every way `source` (at repository path `file`) could load the storage foundation: static
// default/named/namespace imports, side-effect imports, re-exports, require() and dynamic import().
// A dynamic import or require whose target is not a plain string is flagged when its static prefix
// could reach src/storage, or when it has no static prefix at all.
function storageImportFindings(source, file) {
  const findings = [];
  const staticForm = /\b(?:import|export)\s+(?:[^'"`;]*?\bfrom\s*)?(['"])([^'"]+)\1/g;
  for (const match of source.matchAll(staticForm)) {
    const target = resolveSpecifier(file, match[2]);
    if (target !== null && insideStorage(target)) findings.push(match[0]);
  }
  const callForm = /\b(?:import|require)\s*\(\s*(?:(['"])([^'"]*)\1|`([^`$]*)(\$\{)?[^`]*`|([^)\s]))/g;
  for (const match of source.matchAll(callForm)) {
    if (match[2] !== undefined) {
      const target = resolveSpecifier(file, match[2]);
      if (target !== null && insideStorage(target)) findings.push(match[0]);
    } else if (match[3] !== undefined && match[4] === undefined) {
      const target = resolveSpecifier(file, match[3]);
      if (target !== null && insideStorage(target)) findings.push(match[0]);
    } else if (match[3] !== undefined) {
      const prefix = match[3];
      if (!prefix.startsWith('.') && !prefix.startsWith('/')) findings.push(match[0]);
      else {
        const target = resolveSpecifier(file, prefix);
        if (insideStorage(target) || `${STORAGE_DIRECTORY}/`.startsWith(prefix.endsWith('/') ? `${target}/` : target)) findings.push(match[0]);
      }
    } else {
      findings.push(match[0]);
    }
  }
  return findings;
}

test('storage import guard detects every equivalent static, side-effect, re-export and dynamic form', () => {
  const component = 'src/components/Example.jsx';
  const violating = [
    [component, "import { openMajandusDb } from '../storage/indexedDb.js';"],
    [component, 'import legacy from "../storage/legacyMigration.js";'],
    [component, "import * as schema from '../storage/schema.js';"],
    [component, "import '../storage/schema.js';"],
    [component, "import {\n  runLegacyMigration,\n} from\n  '../storage/legacyMigration.js';"],
    [component, "export { createLocalReplica } from '../storage/localReplica.js';"],
    [component, "export * from '../storage/schema.js';"],
    [component, "const replica = await import('../storage/localReplica.js');"],
    [component, 'const module = await import(`../storage/${name}.js`);'],
    [component, 'const module = await import(`../${folder}/schema.js`);'],
    [component, 'const module = await import(specifier);'],
    [component, "const schema = require('../storage/schema.js');"],
    ['src/App.jsx', "import storage from './storage';"],
    ['src/App.jsx', "import('./storage/index');"],
    ['src/hooks/useExample.js', "import schema from '/src/storage/schema.js';"],
  ];
  for (const [file, source] of violating) assert.ok(storageImportFindings(source, file).length > 0, `${file}: ${source}`);
  const safe = [
    "import React, { useState } from 'react';",
    "import { useSavedPlaces } from '../hooks/useSavedPlaces.js';",
    "import helper from './storageless.js';",
    "import tools from '../storage-tools/index.js';",
    "const icon = await import('./icons/home.js');",
    'const icon = await import(`./icons/${name}.js`);',
    "localStorage.setItem('sade_saved_places', JSON.stringify(storage));",
    'const meta = import.meta.env;',
  ];
  for (const source of safe) assert.deepEqual(storageImportFindings(source, 'src/components/Example.jsx'), [], source);
});

test('no runtime source outside src/storage imports the storage foundation', () => {
  const files = runtimeSourceFiles();
  assert.ok(files.includes('src/main.jsx') && files.includes('src/App.jsx'), 'the walk reaches the application entry points');
  assert.ok(files.every(path => !path.startsWith(`${STORAGE_DIRECTORY}/`)));
  const unknown = files.filter(path => !CODE_FILE.test(path) && !NON_CODE_FILE.test(path));
  assert.deepEqual(unknown, [], 'every src file is either scanned code or known non-code');
  const scanned = files.filter(path => CODE_FILE.test(path));
  assert.ok(scanned.length >= 40, `scanned ${scanned.length} runtime source files`);
  const violations = scanned.flatMap(path => storageImportFindings(readFileSync(join(repositoryRoot, path), 'utf8'), path)
    .map(finding => `${path}: ${finding}`));
  assert.deepEqual(violations, []);
});

// Same entry/build shape as scripts/shell/app-shell.test.mjs, with its optional test fixtures off.
function buildAppShellBundle(extraContents = '') {
  return build({
    absWorkingDir: repositoryRoot, bundle: true, write: false, outfile: 'shell.js', metafile: true,
    jsx: 'automatic', loader: { '.png': 'dataurl' },
    define: { 'import.meta.env': '{}' },
    stdin: { resolveDir: repositoryRoot, contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import App from './src/App.jsx';
      ${extraContents}
      const wasteLookup=undefined;
      const notificationService=undefined;
      createRoot(document.getElementById('root')).render(<React.StrictMode><App wasteLookup={wasteLookup} notificationService={notificationService} /></React.StrictMode>);
    `, loader: 'jsx' },
  });
}

const bundleInputs = bundle => Object.keys(bundle.metafile.inputs).map(path => path.split('\\').join('/'));
const bundleStorageInputs = bundle => bundleInputs(bundle)
  .filter(path => path === STORAGE_DIRECTORY || path.startsWith(`${STORAGE_DIRECTORY}/`)).sort();
const bundleJavaScript = bundle => bundle.outputFiles.find(file => file.path.endsWith('.js')).text;

test('the application bundle contains no storage foundation module, directly or transitively', { timeout: 120000 }, async () => {
  // schema.js and indexedDb.js are reached only transitively from these two modules.
  const control = await buildAppShellBundle(`
    import * as migrationControl from './src/storage/legacyMigration.js';
    import * as replicaControl from './src/storage/localReplica.js';
    window.storageControl = { migrationControl, replicaControl };
  `);
  assert.deepEqual(bundleStorageInputs(control), ['src/storage/indexedDb.js', 'src/storage/legacyMigration.js', 'src/storage/localReplica.js', 'src/storage/schema.js'],
    'control: the metafile check sees direct and transitive storage modules');
  assert.ok(bundleJavaScript(control).includes('majandus_local_v1') && bundleJavaScript(control).includes('legacyMigrationV1'),
    'control: storage tokens are detectable in bundle output');

  const app = await buildAppShellBundle();
  const inputs = bundleInputs(app);
  assert.ok(inputs.includes('src/App.jsx') && inputs.filter(path => path.startsWith('src/')).length >= 40, 'the real application graph was bundled');
  assert.deepEqual(bundleStorageInputs(app), []);
  const js = bundleJavaScript(app);
  assert.ok(!js.includes('majandus_local_v1'), 'no IndexedDB database name in the app bundle');
  assert.ok(!js.includes('legacyMigrationV1'), 'no migration marker in the app bundle');
});

test('storage foundation modules stay dormant: no network, global storage, UI or unexpected imports', () => {
  const modules = readdirSync(join(repositoryRoot, STORAGE_DIRECTORY)).sort();
  assert.deepEqual(modules, ['indexedDb.js', 'legacyMigration.js', 'localReplica.js', 'schema.js']);
  const allowedImports = ['../calendar/eventRepository.js', '../waste/householdRepository.js', './indexedDb.js', './localReplica.js', './schema.js'];
  const forbidden = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'navigator', 'localStorage', 'sessionStorage', 'window.', 'document.', 'serviceWorker', 'react'];
  for (const name of modules) {
    const source = readFileSync(join(repositoryRoot, STORAGE_DIRECTORY, name), 'utf8');
    for (const token of forbidden) assert.ok(!source.includes(token), `${name} must not use ${token}`);
    const specifiers = [...source.matchAll(/\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\3|\b(?:import|require)\s*\(/g)]
      .map(match => match[2] ?? match[4] ?? 'dynamic import');
    for (const specifier of specifiers) assert.ok(allowedImports.includes(specifier), `${name} imports ${specifier}`);
  }
});
