import {
  commitCalendarCreate,
  commitCalendarDelete,
  commitCalendarUpdate,
  findAppliedMutation,
  findCalendarEntity,
  findCalendarEntityId,
  findChangedFieldsSince,
} from "./syncRepository.js";

const EVENT_FIELDS = [
  "id", "title", "category", "subtype", "date", "time", "recurrence",
  "reminder", "source", "householdId", "notes", "seriesId",
  "excludedDates", "overrides", "importMeta",
];
const EDIT_FIELDS = ["title", "category", "subtype", "date", "time", "reminder", "notes"];
const RULE_FIELDS = new Set(["date", "recurrence", "seriesId", "excludedDates", "overrides"]);
const IDENTITY_FIELDS = new Set(["category", "subtype"]);
const CATEGORIES = new Set(["waste", "maintenance", "payment", "general"]);
const WASTE_SUBTYPES = new Set(["mixed", "bio", "paper", "packaging", "other"]);
const FREQUENCY_MAXIMUM = { none: 1, weekly: 52, monthly: 12, yearly: 1 };
const MUTATION_FIELDS = ["mutationId", "entityType", "entityId", "operation", "baseRevision", "patch"];
const UPDATE_FIELDS = EVENT_FIELDS.filter(key => !["id", "householdId", "source"].includes(key));
const DIGEST_PREFIX = "majandus:v1:sync-mutation:";

function requireCondition(condition) {
  if (!condition) throw new TypeError("Invalid calendar mutation");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requireKeys(value, allowed) {
  requireCondition(isRecord(value));
  requireCondition(Object.keys(value).every(key => allowed.includes(key)));
}

function requireText(value, maximum, trim = false) {
  requireCondition(typeof value === "string" && value.length > 0 && value.length <= maximum);
  if (trim) requireCondition(value === value.trim() && value.trim().length > 0);
  return value;
}

function calendarDate(value) {
  requireCondition(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const [year, month, day] = value.split("-").map(Number);
  requireCondition(year >= 1000 && year <= 9999);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  requireCondition(parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day);
  return value;
}

function timeValue(value) {
  requireCondition(value === null || (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)));
  return value;
}

function titleValue(value) {
  requireText(value, 200, true);
  return value;
}

function notesValue(value) {
  requireCondition(typeof value === "string" && value.length <= 5000);
  return value;
}

function categoryValue(value) {
  requireCondition(CATEGORIES.has(value));
  return value;
}

function subtypeValue(value) {
  requireCondition(value === null || WASTE_SUBTYPES.has(value));
  return value;
}

function recurrenceValue(value) {
  requireKeys(value, ["frequency", "interval"]);
  requireCondition(Object.hasOwn(FREQUENCY_MAXIMUM, value.frequency));
  const interval = Object.hasOwn(value, "interval") ? value.interval : 1;
  requireCondition(Number.isInteger(interval) && interval >= 1 && interval <= FREQUENCY_MAXIMUM[value.frequency]);
  return { frequency: value.frequency, interval };
}

function reminderValue(value) {
  requireKeys(value, ["daysBefore"]);
  requireCondition([0, 1, 3, 7].includes(value.daysBefore));
  return { daysBefore: value.daysBefore };
}

function seriesIdValue(value) {
  requireCondition(value === null || (typeof value === "string" && value.length > 0));
  return value;
}

function excludedDatesValue(value) {
  requireCondition(Array.isArray(value));
  const dates = value.map(calendarDate);
  requireCondition(new Set(dates).size === dates.length);
  requireCondition(dates.every((date, index) => index === 0 || dates[index - 1] < date));
  return dates;
}

function importMetaValue(value) {
  const keys = ["provider", "providerName", "addressKey", "address", "externalId", "importedAt"];
  requireKeys(value, keys);
  requireCondition(keys.every(key => Object.hasOwn(value, key)));
  const provider = requireText(value.provider, 100, true);
  const providerName = requireText(value.providerName, 100, true);
  const address = requireText(value.address, 500, true);
  const externalId = requireText(value.externalId, 1500, true);
  const addressKey = address.trim().replace(/\s+/g, " ").toLocaleLowerCase("et-EE");
  requireCondition(value.addressKey === addressKey);
  requireCondition(typeof value.importedAt === "string");
  const importedAt = new Date(value.importedAt);
  requireCondition(Number.isFinite(importedAt.valueOf()) && importedAt.toISOString() === value.importedAt);
  return { provider, providerName, addressKey, address, externalId, importedAt: value.importedAt };
}

function editValue(key, value) {
  switch (key) {
    case "title": return titleValue(value);
    case "category": return categoryValue(value);
    case "subtype": return subtypeValue(value);
    case "date": return calendarDate(value);
    case "time": return timeValue(value);
    case "reminder": return reminderValue(value);
    case "notes": return notesValue(value);
    default: throw new TypeError("Invalid calendar mutation");
  }
}

function overridePatchValue(value) {
  requireKeys(value, EDIT_FIELDS);
  const patch = {};
  for (const key of EDIT_FIELDS) if (Object.hasOwn(value, key)) patch[key] = editValue(key, value[key]);
  return patch;
}

function overridesValue(value) {
  requireCondition(isRecord(value));
  const result = {};
  for (const [date, patch] of Object.entries(value)) result[calendarDate(date)] = overridePatchValue(patch);
  return result;
}

function validateBase(value, entityId) {
  requireKeys(value, EVENT_FIELDS);
  const id = requireText(value.id, 200);
  requireCondition(id === entityId);
  const title = titleValue(value.title);
  const category = categoryValue(value.category);
  const subtype = Object.hasOwn(value, "subtype") ? subtypeValue(value.subtype) : null;
  requireCondition(category === "waste" ? WASTE_SUBTYPES.has(subtype) : subtype === null);
  const date = calendarDate(value.date);
  const time = Object.hasOwn(value, "time") ? timeValue(value.time) : null;
  const recurrence = Object.hasOwn(value, "recurrence")
    ? recurrenceValue(value.recurrence) : { frequency: "none", interval: 1 };
  const reminder = Object.hasOwn(value, "reminder")
    ? reminderValue(value.reminder) : { daysBefore: 0 };
  requireCondition(value.source === "manual" || value.source === "imported");
  requireCondition(!Object.hasOwn(value, "householdId") || value.householdId === null);
  const notes = Object.hasOwn(value, "notes") ? notesValue(value.notes) : "";
  const seriesId = Object.hasOwn(value, "seriesId") ? seriesIdValue(value.seriesId) : null;
  requireCondition(recurrence.frequency === "none" ? seriesId === null : seriesId !== null);
  const result = {
    id, title, category, subtype, date, time, recurrence, reminder,
    source: value.source, householdId: null, notes, seriesId,
  };
  if (value.source === "manual") requireCondition(!Object.hasOwn(value, "importMeta"));
  else {
    requireCondition(category === "waste" && Object.hasOwn(value, "importMeta"));
    result.importMeta = importMetaValue(value.importMeta);
  }
  return result;
}

export function validateCalendarEventPayload(value, entityId) {
  const base = validateBase(value, entityId);
  const excludedDates = Object.hasOwn(value, "excludedDates") ? excludedDatesValue(value.excludedDates) : [];
  const rawOverrides = Object.hasOwn(value, "overrides") ? overridesValue(value.overrides) : {};
  requireCondition(base.recurrence.frequency !== "none" ||
    (excludedDates.length === 0 && Object.keys(rawOverrides).length === 0));
  const overrides = {};
  for (const [date, patch] of Object.entries(rawOverrides)) {
    const merged = validateBase({ ...base, ...patch }, entityId);
    overrides[date] = Object.fromEntries(EDIT_FIELDS.filter(key => Object.hasOwn(patch, key)).map(key => [key, merged[key]]));
  }
  const { importMeta, ...withoutMeta } = base;
  const canonical = { ...withoutMeta, excludedDates, overrides };
  if (importMeta) canonical.importMeta = importMeta;
  return canonical;
}

function updatePatchValue(value) {
  requireCondition(isRecord(value));
  for (const key of ["id", "householdId", "source"]) {
    if (Object.hasOwn(value, key)) {
      const error = new TypeError("Immutable calendar field");
      error.code = "IMMUTABLE_FIELD";
      throw error;
    }
  }
  requireKeys(value, UPDATE_FIELDS);
  const patch = {};
  for (const key of UPDATE_FIELDS) {
    if (!Object.hasOwn(value, key)) continue;
    const input = value[key];
    patch[key] = EDIT_FIELDS.includes(key) ? editValue(key, input)
      : key === "recurrence" ? recurrenceValue(input)
        : key === "seriesId" ? seriesIdValue(input)
          : key === "excludedDates" ? excludedDatesValue(input)
            : key === "overrides" ? overridesValue(input)
              : importMetaValue(input);
  }
  return patch;
}

function mutationValue(value) {
  requireKeys(value, MUTATION_FIELDS);
  requireCondition(MUTATION_FIELDS.every(key => Object.hasOwn(value, key)));
  const mutationId = requireText(value.mutationId, 200);
  requireCondition(value.entityType === "calendar_event");
  const entityId = requireText(value.entityId, 200);
  requireCondition(["CREATE", "UPDATE", "DELETE"].includes(value.operation));
  requireCondition(Number.isInteger(value.baseRevision));
  const patch = value.operation === "CREATE"
    ? validateCalendarEventPayload(value.patch, entityId)
    : value.operation === "UPDATE" ? updatePatchValue(value.patch)
      : (requireKeys(value.patch, []), {});
  return {
    mutationId, entityType: value.entityType, entityId,
    operation: value.operation, baseRevision: value.baseRevision, patch,
  };
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJsonValue(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortedJsonValue(value));
}

async function digestCanonicalMutation(value) {
  const digestInput = {
    v: 1, entityType: value.entityType, entityId: value.entityId,
    operation: value.operation, baseRevision: value.baseRevision, patch: value.patch,
  };
  const bytes = new TextEncoder().encode(DIGEST_PREFIX + canonicalJson(digestInput));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function calendarMutationDigest(value) {
  return digestCanonicalMutation(mutationValue(value));
}

function groupOf(field) {
  if (RULE_FIELDS.has(field)) return "rule";
  if (IDENTITY_FIELDS.has(field)) return "identity";
  return field;
}

function isOverlap(patch, history) {
  const incoming = new Set(Object.keys(patch).map(groupOf));
  return history.some(row => JSON.parse(row.changed_fields_json).some(field => incoming.has(groupOf(field))));
}

function deriveUpdate(previous, patch, entityId) {
  const recurrence = patch.recurrence ?? previous.recurrence;
  const reset = (Object.hasOwn(patch, "date") && patch.date !== previous.date)
    || canonicalJson(recurrence) !== canonicalJson(previous.recurrence);
  const seriesId = recurrence.frequency === "none" ? null : previous.seriesId ?? `series:${entityId}`;
  requireCondition(!Object.hasOwn(patch, "seriesId") || patch.seriesId === seriesId);
  if (reset) {
    requireCondition(!Object.hasOwn(patch, "excludedDates") || patch.excludedDates.length === 0);
    requireCondition(!Object.hasOwn(patch, "overrides") || Object.keys(patch.overrides).length === 0);
  }
  const category = patch.category ?? previous.category;
  requireCondition(!(category !== "waste" && Object.hasOwn(patch, "subtype") && patch.subtype !== null));
  return validateCalendarEventPayload({
    ...previous, ...patch,
    id: entityId, source: previous.source, householdId: null,
    subtype: category === "waste" ? (Object.hasOwn(patch, "subtype") ? patch.subtype : previous.subtype) : null,
    seriesId,
    excludedDates: reset ? [] : patch.excludedDates ?? previous.excludedDates,
    overrides: reset ? {} : patch.overrides ?? previous.overrides,
  }, entityId);
}

const rejected = code => ({ status: "REJECTED", code });
const conflict = code => ({ status: "CONFLICT", code });
const unavailable = () => conflict("ENTITY_UNAVAILABLE");

function canonicalTimestamp(clock) {
  requireCondition(typeof clock === "function");
  const value = clock();
  requireCondition(typeof value === "string" && Number.isFinite(new Date(value).valueOf())
    && new Date(value).toISOString() === value);
  return value;
}

export async function applyCalendarMutation({ db, context, mutation, clock }) {
  requireCondition(db && typeof db.prepare === "function" && typeof db.batch === "function");
  requireCondition(isRecord(context) && typeof context.householdId === "string"
    && typeof context.userId === "string");
  let value;
  try { value = mutationValue(mutation); }
  catch (error) { return rejected(error.code === "IMMUTABLE_FIELD" ? error.code : "INVALID_REQUEST"); }
  const digest = await digestCanonicalMutation(value);
  const existingMutation = await findAppliedMutation(db, value.mutationId);
  if (existingMutation) {
    if (existingMutation.household_id !== context.householdId) return rejected("MUTATION_UNAVAILABLE");
    const stored = JSON.parse(existingMutation.result_json);
    return stored.digest === digest
      ? { status: "REPLAYED", result: stored.result }
      : rejected("MUTATION_ID_REUSED");
  }
  if (value.operation === "CREATE" ? value.baseRevision !== 0 : value.baseRevision <= 0)
    return rejected("INVALID_REQUEST");

  let previous = null;
  let headRevision = 0;
  let nextPayload = null;
  let changedFields = [];
  let result;
  if (value.operation === "CREATE") {
    if (await findCalendarEntityId(db, value.entityId)) return unavailable();
    nextPayload = value.patch;
    changedFields = Object.keys(nextPayload).sort();
    result = { status: "APPLIED", revision: 1 };
  } else {
    const row = await findCalendarEntity(db, context.householdId, value.entityId);
    if (!row || row.deleted_at !== null) return unavailable();
    headRevision = row.revision;
    if (value.baseRevision > headRevision) return unavailable();
    if (value.operation === "DELETE") {
      if (value.baseRevision !== headRevision) return unavailable();
      result = { status: "APPLIED", revision: headRevision + 1 };
    } else {
      previous = validateCalendarEventPayload(JSON.parse(row.payload_json), value.entityId);
      const stale = value.baseRevision < headRevision;
      if (stale) {
        const history = await findChangedFieldsSince(db, context.householdId, value.entityId, value.baseRevision);
        // An incomplete history cannot establish that a stale patch is disjoint.
        if (history.length !== headRevision - value.baseRevision
          || history.some((entry, index) => entry.revision !== value.baseRevision + index + 1))
          return conflict("HISTORY_UNAVAILABLE");
        if (isOverlap(value.patch, history)) return conflict("FIELD_OVERLAP");
      }
      try { nextPayload = deriveUpdate(previous, value.patch, value.entityId); }
      catch { return stale ? conflict("MERGE_INVALID") : rejected("INVALID_PAYLOAD"); }
      changedFields = Object.keys(nextPayload).filter(key =>
        canonicalJson(previous[key]) !== canonicalJson(nextPayload[key])).sort();
      result = { status: stale ? "MERGED" : "APPLIED", revision: headRevision + 1 };
    }
  }

  const timestamp = canonicalTimestamp(clock);
  const record = {
    mutationId: value.mutationId, householdId: context.householdId, userId: context.userId,
    entityId: value.entityId, operation: value.operation, expectedRevision: headRevision,
    revision: result.revision, payloadJson: nextPayload === null ? null : JSON.stringify(nextPayload),
    changedFields, timestamp, digest, result,
  };
  try {
    if (value.operation === "CREATE") await commitCalendarCreate(db, record);
    else if (value.operation === "UPDATE") await commitCalendarUpdate(db, record);
    else await commitCalendarDelete(db, record);
    return result;
  } catch {
    // A concurrent duplicate may have committed between the preflight and the
    // guarded batch. Re-read the durable record; never replay based on memory.
    const committed = await findAppliedMutation(db, value.mutationId);
    if (committed) {
      if (committed.household_id !== context.householdId) return rejected("MUTATION_UNAVAILABLE");
      const stored = JSON.parse(committed.result_json);
      return stored.digest === digest
        ? { status: "REPLAYED", result: stored.result }
        : rejected("MUTATION_ID_REUSED");
    }
    if (value.operation === "CREATE") {
      if (await findCalendarEntityId(db, value.entityId)) return unavailable();
    } else {
      const current = await findCalendarEntity(db, context.householdId, value.entityId);
      if (!current || current.deleted_at !== null || current.revision !== headRevision) return unavailable();
    }
    throw new Error("Calendar mutation persistence failed");
  }
}
