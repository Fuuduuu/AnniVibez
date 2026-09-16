import { validateEvent } from '../calendar/eventModel.js';
import { validateImportHistory } from '../waste/reconcile.js';
import { createHouseholdRepository, HOUSEHOLD_KEY } from '../waste/householdRepository.js';
import { normalizePlace } from '../places/savedPlaces.js';
import {
  validateCalendarEventRecord, validateHouseholdProfileRecord, validateSharedPlaceRecord, validateWasteStateRecord,
} from './localReplica.js';

// Runtime validation boundary (runtime cutover C3). Every check reuses accepted domain code and
// rejects anything that code would change: no value is ever repaired into validity.

function invalid(message) {
  throw new TypeError(message);
}

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

function requireRuntimeEnvelope(record) {
  if (record.syncStatus !== 'local') invalid('runtime records must have syncStatus local');
  if (record.revision !== 0) invalid('runtime records must have revision 0');
  if (record.deletedAt !== null) invalid('runtime records must have deletedAt null');
}

function validateCalendarPayload(record) {
  if (!isPlainObject(record.payload)) invalid('calendar payload must be an object');
  let normalized;
  try {
    normalized = validateEvent(record.payload);
  } catch (error) {
    invalid(`calendar payload is invalid: ${error.message}`);
  }
  if (!sameValue(normalized, record.payload)) invalid('calendar payload is not accepted event output');
  if (record.payload.id !== record.id) invalid('calendar payload id must equal record id');
}

function validateWastePayload(record) {
  const { payload } = record;
  if (!isPlainObject(payload) || Object.keys(payload).length !== 1 || payload.wasteImports === undefined) {
    invalid('waste payload must contain exactly wasteImports');
  }
  try {
    validateImportHistory(payload.wasteImports);
  } catch (error) {
    invalid(`waste import history is invalid: ${error.message}`);
  }
}

// The accepted household repository is the only source of household rules: the payload profile is
// loaded and saved through it on an in-memory adapter and must come back unchanged.
function validateHouseholdPayload(record) {
  const { payload } = record;
  if (!isPlainObject(payload) || !Object.hasOwn(payload, 'serverHouseholdId') || payload.serverHouseholdId !== null) {
    invalid('household payload must have serverHouseholdId null');
  }
  const { serverHouseholdId, ...profile } = payload;
  const values = new Map([[HOUSEHOLD_KEY, JSON.stringify({ version: 1, profile })]]);
  const memoryStorage = {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
  };
  let saved;
  try {
    saved = createHouseholdRepository(memoryStorage).save({});
  } catch (error) {
    invalid(`household payload is invalid: ${error.message}`);
  }
  if (!sameValue(saved.profile, profile)) invalid('household payload is not accepted household output');
}

function validatePlacePayload(record) {
  if (!sameValue(normalizePlace(record.payload, record.order), record.payload)) {
    invalid('place payload is not accepted normalized place output');
  }
}

const RUNTIME_STORES = Object.freeze({
  householdProfile: [validateHouseholdProfileRecord, validateHouseholdPayload],
  calendarEvents: [validateCalendarEventRecord, validateCalendarPayload],
  sharedPlaces: [validateSharedPlaceRecord, validatePlacePayload],
  wasteState: [validateWasteStateRecord, validateWastePayload],
});

export function validateRuntimeRecord(store, record) {
  if (!Object.hasOwn(RUNTIME_STORES, store)) invalid(`${String(store)} is not a runtime domain store`);
  const [validateEnvelope, validatePayload] = RUNTIME_STORES[store];
  validateEnvelope(record);
  requireRuntimeEnvelope(record);
  validatePayload(record);
  return record;
}

// A complete sharedPlaces collection must use each order 0..n-1 exactly once.
export function validateSharedPlaceOrders(records) {
  if (!Array.isArray(records)) invalid('shared place records must be an array');
  const ids = new Set();
  const orders = new Set();
  for (const record of records) {
    if (!Number.isInteger(record?.order) || record.order < 0 || record.order >= records.length) {
      invalid('shared place orders must be the contiguous integers 0..n-1');
    }
    if (ids.has(record.id)) invalid('shared place ids must be unique');
    if (orders.has(record.order)) invalid('shared place orders must be unique');
    ids.add(record.id);
    orders.add(record.order);
  }
  return records;
}
