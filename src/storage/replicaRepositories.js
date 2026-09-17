import { requestResult } from './indexedDb.js';
import { runReplicaMutation } from './runtimeWrites.js';
import { validateRuntimeRecord, validateSharedPlaceOrders } from './runtimeRecords.js';
import { createHouseholdRepository, HOUSEHOLD_KEY } from '../waste/householdRepository.js';
import { normalizePlace, normalizePlaces } from '../places/savedPlaces.js';
import { createEventRepository, EVENT_STORAGE_KEY } from '../calendar/eventRepository.js';

// Runtime cutover C5: dormant IndexedDB domain repositories (household, places, calendar + waste).
// Every mutation runs through the accepted C3 runReplicaMutation; this module never calls
// replica.transact/runTransaction directly. Domain semantics are never reimplemented: each repository
// runs the existing accepted domain code (createHouseholdRepository, src/places/savedPlaces.js,
// createEventRepository) synchronously inside the PLAN phase, against a small in-memory adapter.
// Nothing outside src/storage/ imports this module yet; no runtime behavior change.

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Structural equality for stored (structured-clone) values; object key order is not significant.
function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameValue(item, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

// ---- household -------------------------------------------------------------------------------

// Seeds the accepted household repository's own legacy-shaped storage from the current IndexedDB
// record, so its own load()/save() error handling (invalid JSON, wrong version) is reused rather than
// reimplemented. An invalid stored record is fed as unparsable JSON, which reproduces the exact
// accepted "cannot read, refuse to overwrite" behavior from createHouseholdRepository itself.
function householdAdapterFrom(record) {
  const values = new Map();
  if (record !== null) {
    let seed = 'not-json';
    try {
      validateRuntimeRecord('householdProfile', record);
      const { serverHouseholdId, ...profile } = record.payload;
      seed = JSON.stringify({ version: 1, profile });
    } catch {
      seed = 'not-json';
    }
    values.set(HOUSEHOLD_KEY, seed);
  }
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function createHouseholdReplicaRepository({ replica, authority, clock }) {
  async function load() {
    const record = (await replica.getHouseholdProfile()) ?? null;
    return createHouseholdRepository(householdAdapterFrom(record)).load();
  }
  function save(patch) {
    return runReplicaMutation({
      replica, authority, domain: 'household', stores: ['householdProfile'],
      read: async stores => (await requestResult(stores.householdProfile.get('household'))) ?? null,
      plan: currentRecord => {
        const saved = createHouseholdRepository(householdAdapterFrom(currentRecord)).save(patch);
        const record = {
          key: 'household',
          payload: { ...saved.profile, serverHouseholdId: null },
          revision: 0,
          updatedAt: clock(),
          deletedAt: null,
          syncStatus: 'local',
        };
        return { puts: [{ store: 'householdProfile', record }], deletes: [], result: { profile: saved.profile, writable: true, error: null } };
      },
    });
  }
  return { load, save };
}

// ---- places ----------------------------------------------------------------------------------

// The padded semantic view a caller sees (mirrors the legacy hook's load()), paired with the real
// backing id for each position that has one (null for a virtual/padded slot with no record yet).
function paddedEntries(ordered) {
  const payloads = normalizePlaces(ordered.map(record => record.payload));
  return payloads.map((payload, index) => ({ id: index < ordered.length ? ordered[index].id : null, payload }));
}

// Runs the exact legacy hook transformation (array update/add/remove, then normalizePlaces at persist
// time) over { id, payload } entries so identity always follows the record, never its position: a
// remove() that shifts later entries left keeps each surviving record's own id, only its order moves.
// A slot with no id (still padded, or freshly added) becomes a put with a brand-new id. A record
// dropped from the final set is deleted. An entry whose order and payload both stay exactly the same
// is left untouched (no rewritten updatedAt) -- this is the only way padded defaults become real rows.
function planPlacesMutation(records, transform, { newId, clock }) {
  for (const record of records) validateRuntimeRecord('sharedPlaces', record);
  validateSharedPlaceOrders(records);
  const ordered = [...records].sort((left, right) => left.order - right.order);
  const currentEntries = paddedEntries(ordered);
  const nextEntries = transform(currentEntries);
  const persistedPayloads = normalizePlaces(nextEntries.map(entry => entry.payload));
  const existingById = new Map(ordered.map(record => [record.id, record]));
  const keptIds = new Set();
  const puts = [];
  for (let index = 0; index < persistedPayloads.length; index += 1) {
    const payload = persistedPayloads[index];
    const id = index < nextEntries.length ? nextEntries[index].id : null;
    if (id === null) {
      puts.push({ store: 'sharedPlaces', record: { id: newId(), order: index, payload, revision: 0, updatedAt: clock(), deletedAt: null, syncStatus: 'local' } });
      continue;
    }
    keptIds.add(id);
    const existing = existingById.get(id);
    if (existing && existing.order === index && sameValue(existing.payload, payload)) continue;
    puts.push({ store: 'sharedPlaces', record: { id, order: index, payload, revision: 0, updatedAt: clock(), deletedAt: null, syncStatus: 'local' } });
  }
  const deletes = ordered.filter(record => !keptIds.has(record.id)).map(record => ({ store: 'sharedPlaces', key: record.id }));
  return { puts, deletes, result: { places: persistedPayloads, writable: true, error: null } };
}

function createPlacesReplicaRepository({ replica, authority, newId, clock }) {
  async function load() {
    const ordered = await replica.listSharedPlaces();
    try {
      for (const record of ordered) validateRuntimeRecord('sharedPlaces', record);
      validateSharedPlaceOrders(ordered);
    } catch {
      return { places: normalizePlaces([]), writable: false, error: 'Salvestatud kohti ei saanud lugeda. Salvestust ei kirjutata üle.' };
    }
    return { places: normalizePlaces(ordered.map(record => record.payload)), writable: true, error: null };
  }
  const mutate = transform => runReplicaMutation({
    replica, authority, domain: 'places', stores: ['sharedPlaces'],
    read: stores => requestResult(stores.sharedPlaces.getAll()),
    plan: records => planPlacesMutation(records, transform, { newId, clock }),
  });
  return {
    load,
    update: (idx, patch) => mutate(entries => entries.map((entry, index) => (index === idx ? { id: entry.id, payload: { ...entry.payload, ...patch } } : entry))),
    add: place => mutate(entries => [...entries, { id: null, payload: normalizePlace(place, entries.length) }]),
    remove: idx => mutate(entries => entries.filter((_, index) => index !== idx)),
  };
}

// ---- calendar + waste --------------------------------------------------------------------------

const canonicalEventOrder = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

function buildCalendarEnvelope({ extras, wasteState, calendarEvents }) {
  for (const record of calendarEvents) validateRuntimeRecord('calendarEvents', record);
  if (wasteState) validateRuntimeRecord('wasteState', wasteState);
  const envelope = {
    version: extras ? extras.sourceVersion : 1,
    ...(extras ? extras.fields : {}),
    events: [...calendarEvents].sort(canonicalEventOrder).map(record => record.payload),
  };
  if (wasteState) envelope.wasteImports = wasteState.payload.wasteImports;
  return envelope;
}

function calendarAdapterFor(envelope) {
  const values = new Map([[EVENT_STORAGE_KEY, JSON.stringify(envelope)]]);
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

// Envelope fields other than events/wasteImports must never change from a runtime mutation (Section 5
// item 6); this is a defensive re-check of what the accepted event repository already preserves by
// spreading the unchanged envelope before applying an operation's own metadata.
function assertExtrasUnchanged(before, after, extras) {
  const expectedVersion = extras ? extras.sourceVersion : 1;
  if (after.version !== expectedVersion) throw new Error('calendar envelope version must not change from a runtime mutation');
  for (const key of extras ? Object.keys(extras.fields) : []) {
    if (!sameValue(before[key], after[key])) throw new Error('calendar envelope extras must not change from a runtime mutation');
  }
}

function diffCalendarOutcome(snapshot, outcome) {
  if (!outcome.writable) throw new Error(outcome.error);
  assertExtrasUnchanged(
    { version: snapshot.extras ? snapshot.extras.sourceVersion : 1, ...(snapshot.extras ? snapshot.extras.fields : {}) },
    outcome,
    snapshot.extras,
  );
  const puts = [];
  const deletes = [];
  const beforeById = new Map(snapshot.calendarEvents.map(record => [record.id, record]));
  const afterIds = new Set(outcome.events.map(event => event.id));
  for (const event of outcome.events) {
    const existing = beforeById.get(event.id);
    if (existing && sameValue(existing.payload, event)) continue;
    puts.push({ store: 'calendarEvents', record: { id: event.id, payload: event, revision: 0, updatedAt: undefined, deletedAt: null, syncStatus: 'local' } });
  }
  for (const [id] of beforeById) if (!afterIds.has(id)) deletes.push({ store: 'calendarEvents', key: id });

  const hasWasteImports = Object.hasOwn(outcome, 'wasteImports') && outcome.wasteImports !== undefined;
  if (hasWasteImports) {
    const unchanged = snapshot.wasteState && sameValue(snapshot.wasteState.payload.wasteImports, outcome.wasteImports);
    if (!unchanged) puts.push({ store: 'wasteState', record: { key: 'waste', payload: { wasteImports: outcome.wasteImports }, revision: 0, updatedAt: undefined, deletedAt: null, syncStatus: 'local' } });
  } else if (snapshot.wasteState) {
    deletes.push({ store: 'wasteState', key: 'waste' });
  }
  return { puts, deletes, result: outcome };
}

function stampUpdatedAt(plan, clock) {
  const stamp = clock();
  for (const put of plan.puts) if (put.record.updatedAt === undefined) put.record.updatedAt = stamp;
  return plan;
}

function planCalendarOperation(snapshot, operate, clock) {
  const envelope = buildCalendarEnvelope(snapshot);
  const outcome = operate(createEventRepository(calendarAdapterFor(envelope), snapshot.newId));
  return stampUpdatedAt(diffCalendarOutcome(snapshot, outcome), clock);
}

function createCalendarReplicaRepository({ replica, authority, newId, clock }) {
  // Used only inside a mutation's own read(stores) phase (runReplicaMutation's transaction stores);
  // this is not a replica.transact call.
  async function readSnapshot(stores) {
    return {
      extras: (await requestResult(stores.meta.get('calendarLegacyEnvelopeExtras')))?.value ?? null,
      wasteState: (await requestResult(stores.wasteState.get('waste'))) ?? null,
      calendarEvents: await requestResult(stores.calendarEvents.getAll()),
    };
  }
  // Read-only load, through the accepted public replica accessors only (no direct replica.transact).
  async function loadSnapshot() {
    return {
      extras: (await replica.getMeta('calendarLegacyEnvelopeExtras'))?.value ?? null,
      wasteState: (await replica.getWasteState()) ?? null,
      calendarEvents: await replica.listCalendarEvents(),
    };
  }
  async function load() {
    const snapshot = await loadSnapshot();
    try {
      return createEventRepository(calendarAdapterFor(buildCalendarEnvelope(snapshot)), newId).load();
    } catch (error) {
      return { events: [], writable: false, error: error.message };
    }
  }
  const mutate = operate => runReplicaMutation({
    replica, authority, domain: 'calendar', stores: ['calendarEvents', 'wasteState'],
    read: async stores => ({ ...(await readSnapshot(stores)), newId }),
    plan: snapshot => planCalendarOperation(snapshot, operate, clock),
  });
  return {
    load,
    create: input => mutate(repo => repo.create(input)),
    update: (id, patch, options) => mutate(repo => repo.update(id, patch, options)),
    remove: (id, options) => mutate(repo => repo.remove(id, options)),
    importWaste: (result, now) => mutate(repo => repo.importWaste(result, now)),
  };
}

// ---- public factory ----------------------------------------------------------------------------

export function createReplicaRepositories({ replica, authority, newId, clock = () => new Date().toISOString() } = {}) {
  return {
    household: createHouseholdReplicaRepository({ replica, authority, clock }),
    places: createPlacesReplicaRepository({ replica, authority, newId, clock }),
    calendar: createCalendarReplicaRepository({ replica, authority, newId, clock }),
  };
}
