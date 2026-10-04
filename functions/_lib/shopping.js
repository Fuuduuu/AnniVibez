import {
  commitShoppingCreate, commitShoppingDelete, commitShoppingUpdate,
  findAppliedShoppingMutation, findShoppingChangedFieldsSince, findShoppingEntity, findShoppingEntityId,
} from "./shoppingRepository.js";

const ITEM_FIELDS = ["id", "name", "quantity", "category", "note", "checkedAt", "createdAt"];
const UPDATE_FIELDS = ["name", "quantity", "category", "note", "checkedAt"];
const MUTATION_FIELDS = ["mutationId", "entityType", "entityId", "operation", "baseRevision", "patch"];
const CATEGORIES = new Set(["food", "home", "pharmacy", "other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireCondition(condition) {
  if (!condition) throw new TypeError("Invalid shopping item");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requireKeys(value, fields) {
  requireCondition(isRecord(value) && Object.keys(value).every(key => fields.includes(key)));
}

function uuid(value) {
  requireCondition(typeof value === "string" && UUID.test(value));
  return value;
}

function timestamp(value) {
  requireCondition(typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(new Date(value).valueOf()) && new Date(value).toISOString() === value);
  return value;
}

function fieldValue(key, value) {
  if (key === "checkedAt") return value === null ? null : timestamp(value);
  if (key === "category") {
    requireCondition(CATEGORIES.has(value));
    return value;
  }
  requireCondition(typeof value === "string");
  const normalized = key === "name" ? value.trim() : value;
  const maximum = key === "name" ? 160 : key === "quantity" ? 40 : 500;
  requireCondition(normalized.length <= maximum && (key !== "name" || normalized.length > 0));
  return normalized;
}

export function validateShoppingItemPayload(value, entityId) {
  requireKeys(value, ITEM_FIELDS);
  const id = uuid(value.id);
  requireCondition(id === uuid(entityId));
  return {
    id, name: fieldValue("name", value.name),
    quantity: fieldValue("quantity", Object.hasOwn(value, "quantity") ? value.quantity : ""),
    category: fieldValue("category", Object.hasOwn(value, "category") ? value.category : "food"),
    note: fieldValue("note", Object.hasOwn(value, "note") ? value.note : ""),
    checkedAt: fieldValue("checkedAt", Object.hasOwn(value, "checkedAt") ? value.checkedAt : null),
    createdAt: timestamp(value.createdAt),
  };
}

function updatePatch(value) {
  requireCondition(isRecord(value));
  if (["id", "createdAt"].some(key => Object.hasOwn(value, key))) {
    const error = new TypeError("Immutable shopping field");
    error.code = "IMMUTABLE_FIELD";
    throw error;
  }
  requireKeys(value, UPDATE_FIELDS);
  return Object.fromEntries(UPDATE_FIELDS.filter(key => Object.hasOwn(value, key)).map(key => [key, fieldValue(key, value[key])]));
}

function mutationValue(value) {
  requireKeys(value, MUTATION_FIELDS);
  requireCondition(MUTATION_FIELDS.every(key => Object.hasOwn(value, key)));
  const mutationId = uuid(value.mutationId);
  const entityId = uuid(value.entityId);
  requireCondition(value.entityType === "shopping_item" && ["CREATE", "UPDATE", "DELETE"].includes(value.operation));
  requireCondition(Number.isSafeInteger(value.baseRevision)
    && (value.operation === "CREATE" ? value.baseRevision === 0 : value.baseRevision >= 1));
  const patch = value.operation === "CREATE" ? validateShoppingItemPayload(value.patch, entityId)
    : value.operation === "UPDATE" ? updatePatch(value.patch) : (requireKeys(value.patch, []), {});
  return { mutationId, entityType: "shopping_item", entityId, operation: value.operation, baseRevision: value.baseRevision, patch };
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJsonValue(value[key])]));
  return value;
}

export const canonicalJson = value => JSON.stringify(sortedJsonValue(value));

async function digestCanonicalMutation(value) {
  const bytes = new TextEncoder().encode("majandus:v1:shopping-mutation:" + canonicalJson({
    v: 1, entityType: value.entityType, entityId: value.entityId,
    operation: value.operation, baseRevision: value.baseRevision, patch: value.patch,
  }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export const shoppingMutationDigest = value => digestCanonicalMutation(mutationValue(value));

const rejected = code => ({ status: "REJECTED", code });
const conflict = code => ({ status: "CONFLICT", code });
const unavailable = () => conflict("ENTITY_UNAVAILABLE");

function replay(row, householdId, digest) {
  if (row.household_id !== householdId) return rejected("MUTATION_UNAVAILABLE");
  const stored = JSON.parse(row.result_json);
  if (stored.digest !== digest) return rejected("MUTATION_ID_REUSED");
  requireCondition(isRecord(stored.result) && ["APPLIED", "MERGED"].includes(stored.result.status)
    && Number.isSafeInteger(stored.result.revision) && stored.result.revision >= 1);
  return { status: "REPLAYED", result: stored.result };
}

export async function applyShoppingMutation({ db, context, mutation, clock }) {
  requireCondition(db && typeof db.prepare === "function" && typeof db.batch === "function");
  requireCondition(isRecord(context) && typeof context.householdId === "string" && context.householdId.length > 0
    && typeof context.userId === "string" && context.userId.length > 0);
  let value;
  try { value = mutationValue(mutation); }
  catch (error) { return rejected(error.code === "IMMUTABLE_FIELD" ? error.code : "INVALID_REQUEST"); }
  const digest = await digestCanonicalMutation(value);
  const existing = await findAppliedShoppingMutation(db, value.mutationId);
  if (existing) return replay(existing, context.householdId, digest);
  let headRevision = 0;
  let nextPayload = null;
  let changedFields = [];
  let stale = false;
  if (value.operation === "CREATE") {
    if (await findShoppingEntityId(db, value.entityId)) return unavailable();
    nextPayload = value.patch;
    changedFields = Object.keys(nextPayload).sort();
  } else {
    const row = await findShoppingEntity(db, context.householdId, value.entityId);
    if (!row || row.deleted_at !== null) return unavailable();
    requireCondition(Number.isSafeInteger(row.revision) && row.revision >= 1);
    headRevision = row.revision;
    if (value.baseRevision > headRevision || (value.operation === "DELETE" && value.baseRevision !== headRevision)) return unavailable();
    if (value.operation === "UPDATE") {
      const previous = validateShoppingItemPayload(JSON.parse(row.payload_json), value.entityId);
      requireCondition(previous.createdAt === row.created_at);
      stale = value.baseRevision < headRevision;
      if (stale) {
        const history = await findShoppingChangedFieldsSince(db, context.householdId, value.entityId, value.baseRevision);
        if (history.length !== headRevision - value.baseRevision
          || history.some((entry, index) => entry.revision !== value.baseRevision + index + 1)) return conflict("HISTORY_UNAVAILABLE");
        const fields = history.flatMap(entry => {
          const changed = JSON.parse(entry.changed_fields_json);
          requireCondition(Array.isArray(changed) && changed.every(key => ITEM_FIELDS.includes(key)));
          return changed;
        });
        if (fields.some(key => Object.hasOwn(value.patch, key))) return conflict("FIELD_OVERLAP");
      }
      nextPayload = validateShoppingItemPayload({ ...previous, ...value.patch }, value.entityId);
      changedFields = Object.keys(nextPayload).filter(key => canonicalJson(nextPayload[key]) !== canonicalJson(previous[key])).sort();
    }
  }
  requireCondition(typeof clock === "function");
  const changedAt = timestamp(clock());
  const result = { status: stale ? "MERGED" : "APPLIED", revision: headRevision + 1 };
  const record = {
    mutationId: value.mutationId, householdId: context.householdId, userId: context.userId,
    entityId: value.entityId, operation: value.operation, revision: result.revision,
    expectedRevision: headRevision, payloadJson: nextPayload === null ? null : JSON.stringify(nextPayload),
    createdAt: nextPayload?.createdAt, changedFields, timestamp: changedAt, digest, result,
  };
  try {
    if (value.operation === "CREATE") await commitShoppingCreate(db, record);
    else if (value.operation === "UPDATE") await commitShoppingUpdate(db, record);
    else await commitShoppingDelete(db, record);
    return result;
  } catch {
    const committed = await findAppliedShoppingMutation(db, value.mutationId);
    if (committed) return replay(committed, context.householdId, digest);
    if (value.operation === "CREATE") {
      if (await findShoppingEntityId(db, value.entityId)) return unavailable();
    } else {
      const current = await findShoppingEntity(db, context.householdId, value.entityId);
      if (!current || current.deleted_at !== null || current.revision !== headRevision) return unavailable();
    }
    throw new Error("Shopping mutation persistence failed");
  }
}
