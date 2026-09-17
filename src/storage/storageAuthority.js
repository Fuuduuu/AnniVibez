import { requestResult } from './indexedDb.js';
import { createLocalReplica, validateCalendarEventRecord } from './localReplica.js';
import { runLegacyMigration, readLegacySources, sourceDigest, LEGACY_SHARED_KEYS } from './legacyMigration.js';
import { validateRuntimeRecord, validateSharedPlaceOrders } from './runtimeRecords.js';
import { normalizePlaces } from '../places/savedPlaces.js';
import { createEventRepository } from '../calendar/eventRepository.js';
import { createHouseholdRepository } from '../waste/householdRepository.js';

// Runtime cutover C4: the authority controller and the complete dormant cutover state machine.
// Nothing outside src/storage/ imports this module yet; it is exercised only by tests. It receives
// every browser capability by injection and performs no runtime wiring of its own (that is C6).

const AUTHORITY_KEY = 'storageAuthorityV1';
const ATTEMPT_KEY = 'storageRevertAttemptV1';
const HINT_KEY = 'majandus_storage_authority_v1';
const MARKER_KEY = 'legacyMigrationV1';
const LOCK_NAME = 'majandus:storage-authority';

const AUTHORITY_FIELDS = Object.freeze([
  'commitCount', 'key', 'legacyDigestAtSwitch', 'legacyUntrusted', 'markerPreparationId', 'persistGranted', 'status', 'switchId', 'switchedAt',
]);
const ATTEMPT_FIELDS = Object.freeze(['attemptId', 'commitCountAtStart', 'key', 'phase', 'switchId']);
const HINT_FIELDS = Object.freeze(['legacyDigestAtSwitch', 'switchId', 'switchedAt', 'version']);
const AUTHORITY_STATUSES = Object.freeze(['active', 'reverting', 'reverted']);
const DIGEST = /^[0-9a-f]{64}$/;
const ENTITY_STORES = Object.freeze(['householdProfile', 'calendarEvents', 'sharedPlaces', 'wasteState']);
const EMPTY_CHECK_STORES = Object.freeze(['outbox', 'auth', 'syncState', 'conflicts']);
const EXTRA_META_KEYS = Object.freeze(['calendarLegacyEnvelopeExtras', 'householdLegacyEnvelopeExtras']);
const SINGLETON_STORE_OF = Object.freeze({ household: 'householdProfile', waste: 'wasteState' });
const BACKUP_DOMAINS = Object.freeze(['calendar', 'household', 'places']);
const SWITCHABLE_MIGRATION_STATUSES = Object.freeze(['completed', 'already-complete', 'prepared-recovered', 'reprepared']);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = value => typeof value === 'string' && value.length > 0;

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

// Domain load/validation boundary (Section 2 snapshot load, Section 3 DOMAIN_INVALID, Section 5 item 6,
// Section 6c step 3). Reuses the C3 runtime validators; domain semantics are never reimplemented here.
// Returns the names of every domain ('household', 'calendar', 'places') whose stored records fail
// validation. 'calendar' covers both calendarEvents and wasteState, matching the C3 domain grouping.
function classifyDomainValidity({ householdProfile, calendarEvents, wasteState, sharedPlaces }) {
  const invalid = new Set();
  if (householdProfile !== null) {
    try {
      validateRuntimeRecord('householdProfile', householdProfile);
    } catch {
      invalid.add('household');
    }
  }
  let calendarInvalid = false;
  for (const record of calendarEvents) {
    try {
      validateRuntimeRecord('calendarEvents', record);
    } catch {
      calendarInvalid = true;
      break;
    }
  }
  if (!calendarInvalid && wasteState !== null) {
    try {
      validateRuntimeRecord('wasteState', wasteState);
    } catch {
      calendarInvalid = true;
    }
  }
  if (calendarInvalid) invalid.add('calendar');
  let placesInvalid = false;
  for (const record of sharedPlaces) {
    try {
      validateRuntimeRecord('sharedPlaces', record);
    } catch {
      placesInvalid = true;
      break;
    }
  }
  if (!placesInvalid) {
    try {
      validateSharedPlaceOrders(sharedPlaces);
    } catch {
      placesInvalid = true;
    }
  }
  if (placesInvalid) invalid.add('places');
  return [...invalid];
}

// Authority/hint timestamps follow the same strict rule as Task 2 record timestamps.
function isAcceptedTimestamp(value) {
  try {
    validateCalendarEventRecord({ id: 'storage-authority-timestamp-probe', payload: {}, revision: 0, updatedAt: value, deletedAt: null, syncStatus: 'local' });
    return true;
  } catch {
    return false;
  }
}

// ---- Section 1a: authority record ----------------------------------------------------------

export function isWellFormedAuthorityRecord(record) {
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

function freshAuthorityRecord({ switchId, switchedAt, legacyDigestAtSwitch, markerPreparationId }) {
  const record = {
    commitCount: 0, key: AUTHORITY_KEY, legacyDigestAtSwitch, legacyUntrusted: false,
    markerPreparationId, persistGranted: null, status: 'active', switchId, switchedAt,
  };
  if (!isWellFormedAuthorityRecord(record)) throw new TypeError('invalid fresh authority record');
  return record;
}

// ---- Section 1c: revert attempt record ------------------------------------------------------

export function isWellFormedRevertAttemptRecord(record) {
  if (!isPlainObject(record)) return false;
  const keys = Object.keys(record).sort();
  return keys.length === ATTEMPT_FIELDS.length && keys.every((key, index) => key === ATTEMPT_FIELDS[index])
    && record.key === ATTEMPT_KEY
    && isNonEmptyString(record.switchId)
    && isNonEmptyString(record.attemptId)
    && Number.isSafeInteger(record.commitCountAtStart) && record.commitCountAtStart >= 0
    && (record.phase === 'started' || record.phase === 'backups-verified');
}

// Classifies the { authorityRaw, attemptRaw } pair read at boot into: 'none' (no attempt, nothing
// reverting), 'orphan' (Section 1c orphan rule), 'invalid-under-reverting' (missing/malformed while
// reverting) or 'valid' (consistent attempt under a reverting authority).
function classifyBootAttempt(authorityRaw, attemptRaw) {
  if (attemptRaw === undefined) {
    if (authorityRaw !== undefined && authorityRaw.status === 'reverting') return { kind: 'invalid-under-reverting' };
    return { kind: 'none' };
  }
  if (authorityRaw === undefined || authorityRaw.status !== 'reverting') return { kind: 'orphan' };
  const wellFormed = isWellFormedRevertAttemptRecord(attemptRaw);
  if (wellFormed && attemptRaw.switchId !== authorityRaw.switchId) return { kind: 'orphan' };
  if (!wellFormed) return { kind: 'invalid-under-reverting' };
  if (attemptRaw.commitCountAtStart !== authorityRaw.commitCount) return { kind: 'invalid-under-reverting' };
  return { kind: 'valid', attempt: attemptRaw };
}

// ---- Section 1b: authority hint ------------------------------------------------------------

function isWellFormedHint(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === HINT_FIELDS.length && keys.every((key, index) => key === HINT_FIELDS[index])
    && value.version === 1
    && isNonEmptyString(value.switchId)
    && typeof value.legacyDigestAtSwitch === 'string' && DIGEST.test(value.legacyDigestAtSwitch)
    && typeof value.switchedAt === 'string' && isAcceptedTimestamp(value.switchedAt);
}

// Classifies a hint read into exactly: absent, valid, malformed or unreadable (Section 1b).
export function classifyHint(storage) {
  let raw;
  try {
    raw = storage.getItem(HINT_KEY);
  } catch {
    return { kind: 'unreadable' };
  }
  if (raw === null) return { kind: 'absent' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'malformed', raw };
  }
  if (!isWellFormedHint(parsed)) return { kind: 'malformed', raw };
  return { kind: 'valid', raw, value: parsed };
}

function hintFor(authority) {
  return { version: 1, switchId: authority.switchId, legacyDigestAtSwitch: authority.legacyDigestAtSwitch, switchedAt: authority.switchedAt };
}

export function hintMatches(hintValue, authority) {
  return isPlainObject(hintValue) && isPlainObject(authority)
    && hintValue.switchId === authority.switchId
    && hintValue.legacyDigestAtSwitch === authority.legacyDigestAtSwitch
    && hintValue.switchedAt === authority.switchedAt;
}

function writeHintGate(storage, authority) {
  const payload = JSON.stringify(hintFor(authority));
  try {
    storage.setItem(HINT_KEY, payload);
    return storage.getItem(HINT_KEY) === payload;
  } catch {
    return false;
  }
}

function removeHintVerified(storage) {
  try {
    storage.removeItem(HINT_KEY);
    return storage.getItem(HINT_KEY) === null;
  } catch {
    return false;
  }
}

// LEGACY write guard (Section 1b): a non-null hint, or a throwing read, refuses a legacy write.
export function canWriteLegacy(storage) {
  return classifyHint(storage).kind === 'absent';
}

// ---- backup keys (Section 6b) ---------------------------------------------------------------

const backupKey = (switchId, attemptId, domain) => `majandus_legacy_backup_v1_${switchId}_${attemptId}_${domain}`;
const pointerKey = switchId => `majandus_legacy_backup_v1_${switchId}_current`;
const legacyKeyForDomain = domain => LEGACY_SHARED_KEYS[BACKUP_DOMAINS.indexOf(domain)];

export function createStorageAuthorityController({
  indexedDb, storage, locks, broadcast, persist, cryptoApi, clock = () => new Date().toISOString(), newId, mode = 'forward',
} = {}) {
  const replica = createLocalReplica({ indexedDb, clock });
  let state = 'BOOTING';
  let lastResult = { state: 'BOOTING' };
  let listeners = [];
  // Once the replica reports a connection loss, RELOAD_REQUIRED is the only correct terminal state
  // (Section 5 item 4a-5): a boot step racing the event must never overwrite it with LEGACY or anything
  // else, however far its own async chain had already progressed.
  let connectionLost = false;
  // Mounted-READY identity and notices (Issue A). Reset on every fresh BOOTING entry so a stale
  // identity from a previous boot never leaks into the next one's mounted-signal handling.
  let mountedAuthority = null;
  let divergenceNoticeActive = false;
  let domainInvalidList = [];

  const setState = (next, detail = {}) => {
    state = next;
    if (next === 'BOOTING') {
      mountedAuthority = null;
      divergenceNoticeActive = false;
      domainInvalidList = [];
    }
    lastResult = { state: next, ...detail };
    for (const listener of listeners) listener(lastResult);
    return lastResult;
  };

  // Section 3 READY detail, derived from the mounted notices tracked above rather than recomputed
  // ad hoc at each call site, so every mounted recheck reports a consistent shape.
  const readyDetail = () => {
    const detail = {};
    if (divergenceNoticeActive) detail.divergence = 'LEGACY_DIVERGED';
    if (domainInvalidList.length > 0) detail.domainInvalid = domainInvalidList;
    return detail;
  };

  // Section 2 step 8 hint gate, shared by the initial boot and every mounted-READY hint recheck
  // (Issue A). Returns true once the hint is valid and matching (rewriting it first if needed).
  async function ensureHintGate(authority) {
    const hint = classifyHint(storage);
    const matches = hint.kind === 'valid' && hintMatches(hint.value, authority);
    if (matches) return true;
    const gated = writeHintGate(storage, authority);
    if (!gated) return false;
    try { broadcast?.postMessage?.({ type: 'authority-changed' }); } catch { /* best-effort */ }
    return true;
  }
  const finish = (next, detail = {}) => (connectionLost && next !== 'RELOAD_REQUIRED' ? setState('RELOAD_REQUIRED') : setState(next, detail));

  // Subscribed immediately after creating the replica, before any boot step opens the database.
  replica.subscribe(() => {
    connectionLost = true;
    setState('RELOAD_REQUIRED');
  });

  function classifyOpenError(error) {
    if (error?.name === 'IndexedDbBlockedError') return ['BLOCKED', {}];
    if (error?.name === 'ReplicaConnectionLostError' || error?.name === 'VersionError') return ['RELOAD_REQUIRED', {}];
    return ['STORAGE_UNAVAILABLE', { reason: 'open-or-read-failed' }];
  }

  async function readAuthorityAndAttempt() {
    return replica.transact(['meta'], 'readonly', async ({ stores }) => ({
      authority: await requestResult(stores.meta.get(AUTHORITY_KEY)),
      attempt: await requestResult(stores.meta.get(ATTEMPT_KEY)),
    }));
  }

  async function currentLegacyDigest() {
    const sources = readLegacySources(storage);
    if (sources.status !== 'readable') return null;
    try {
      return await sourceDigest(sources, cryptoApi);
    } catch {
      return null;
    }
  }

  async function checkDivergence(authority) {
    const digest = await currentLegacyDigest();
    return digest === null || digest !== authority.legacyDigestAtSwitch;
  }

  async function persistLifecycle(authority) {
    if (typeof persist !== 'function') return;
    // Attempted at most once per boot, only while the valid record is active with persistGranted null;
    // a stored boolean (including false) is a final answer and is never retried.
    if (authority.persistGranted !== null) return;
    let resolved;
    try {
      resolved = await persist();
    } catch {
      return;
    }
    if (typeof resolved !== 'boolean') return;
    try {
      await replica.transact(['meta'], 'readwrite', async ({ stores }) => {
        const current = await requestResult(stores.meta.get(AUTHORITY_KEY));
        if (!isWellFormedAuthorityRecord(current) || current.status !== 'active' || current.persistGranted !== null || current.switchId !== authority.switchId) return;
        stores.meta.put({ ...current, persistGranted: resolved });
      });
    } catch {
      // A failure of the guarded update itself is ignored for this boot.
    }
  }

  // ---- forward boot (Section 2) --------------------------------------------------------------

  // Section 2 "load initial domain snapshots" / Section 5 item 6 "the same validators run on every
  // load". A read failure (for example ReplicaConnectionLostError) is not caught here: it propagates
  // to boot()'s own classifyOpenError mapping, same as every other transact() call in this controller.
  async function loadAndValidateDomains() {
    const data = await replica.transact(['householdProfile', 'calendarEvents', 'sharedPlaces', 'wasteState'], 'readonly', async ({ stores }) => ({
      householdProfile: (await requestResult(stores.householdProfile.get('household'))) ?? null,
      wasteState: (await requestResult(stores.wasteState.get('waste'))) ?? null,
      calendarEvents: await requestResult(stores.calendarEvents.getAll()),
      sharedPlaces: await requestResult(stores.sharedPlaces.getAll()),
    }));
    return classifyDomainValidity(data);
  }

  async function bootAuthorityActive(authority) {
    const gated = await ensureHintGate(authority);
    if (!gated) return finish('AUTHORITY_HINT_PENDING');
    const diverged = await checkDivergence(authority);
    await persistLifecycle(authority);
    // Every domain stays independently usable: an invalid domain is reported, not repaired, and
    // never blocks the other domains or the overall READY mount (Section 3 DOMAIN_INVALID is per domain).
    const domainInvalid = await loadAndValidateDomains();
    mountedAuthority = authority;
    divergenceNoticeActive = diverged;
    domainInvalidList = domainInvalid;
    return finish('READY', readyDetail());
  }

  // Distinguishes the three outcomes a caller must never conflate: this execution created authority;
  // another execution's authority is already present (absence no longer proven); or the guard failed
  // while this same transaction confirmed authority is still absent.
  async function switchTransaction({ switchId, switchedAt, legacyDigestAtSwitch }) {
    return replica.transact(['meta'], 'readwrite', async ({ stores }) => {
      const authority = await requestResult(stores.meta.get(AUTHORITY_KEY));
      if (authority !== undefined) return { kind: 'authority-present' };
      const marker = await requestResult(stores.meta.get(MARKER_KEY));
      if (!marker || marker.status !== 'complete' || !isNonEmptyString(marker.preparationId) || marker.sourceDigest !== legacyDigestAtSwitch) {
        return { kind: 'guard-failed-authority-absent' };
      }
      const fresh = freshAuthorityRecord({ switchId, switchedAt, legacyDigestAtSwitch, markerPreparationId: marker.preparationId });
      stores.meta.put(fresh);
      return { kind: 'switched', record: fresh };
    });
  }

  // The stale reset re-reads authority AND the revert-attempt key inside its own transaction; a
  // raced-in attempt with authority absent is an orphan and nothing around it is deleted.
  async function staleResetTransaction() {
    try {
      return await replica.transact(
        ['meta', 'householdProfile', 'calendarEvents', 'sharedPlaces', 'wasteState', 'outbox', 'auth', 'syncState', 'conflicts'],
        'readwrite',
        async ({ stores }) => {
          const authority = await requestResult(stores.meta.get(AUTHORITY_KEY));
          if (authority !== undefined) return 'authority-present';
          const attempt = await requestResult(stores.meta.get(ATTEMPT_KEY));
          if (attempt !== undefined) return 'attempt-present';
          const marker = await requestResult(stores.meta.get(MARKER_KEY));
          if (!marker || marker.status !== 'complete') return 'refused';
          for (const name of EMPTY_CHECK_STORES) if (await requestResult(stores[name].count()) > 0) return 'refused';
          for (const id of marker.migratedCalendarIds) stores.calendarEvents.delete(id);
          for (const id of marker.generatedIds.sharedPlaces) stores.sharedPlaces.delete(id);
          for (const key of marker.migratedMetaKeys) stores.meta.delete(key);
          for (const key of marker.migratedSingletonKeys) stores[SINGLETON_STORE_OF[key]].delete(key);
          stores.meta.delete(MARKER_KEY);
          return 'reset';
        },
      );
    } catch {
      return 'refused';
    }
  }

  // Bounded re-entry into the CURRENT authority flow. A boot that observed another execution's
  // migration or authority re-reads durable state instead of trusting its own stale snapshot. Once the
  // bound is spent, a fresh read proving authority absent is the only way to LEGACY.
  const MAX_REENTRIES = 3;
  const reenterForward = reentries => bootForward({ reentries: reentries + 1 });

  async function finishAfterMigration(migrationResult, { switchId, storageLostContext, reentries }) {
    if (!SWITCHABLE_MIGRATION_STATUSES.includes(migrationResult.status)) {
      if (migrationResult.status === 'replica-not-empty' && storageLostContext) return finish('STORAGE_LOST', storageLostContext);
      if (migrationResult.status === 'concurrent-migration') return reenterForward(reentries);
      return finish('LEGACY');
    }
    const sources = readLegacySources(storage);
    if (sources.status !== 'readable') return finish('LEGACY');
    let digest;
    try {
      digest = await sourceDigest(sources, cryptoApi);
    } catch {
      return finish('LEGACY');
    }
    let switched;
    try {
      const switchedAt = clock();
      switched = await switchTransaction({ switchId, switchedAt, legacyDigestAtSwitch: digest });
    } catch {
      return finish('LEGACY');
    }
    if (switched.kind === 'switched') return bootAuthorityActive(switched.record);
    if (switched.kind === 'authority-present') return reenterForward(reentries);
    return finish('LEGACY');
  }

  async function runMigrationAndSwitch({ switchId, storageLostContext, reentries = 0 } = {}) {
    const context = { switchId, storageLostContext, reentries };
    const migrationResult = await runLegacyMigration({ replica, storage, cryptoApi, newId, newPreparationId: newId, now: clock });
    if (migrationResult.status === 'source-changed-after-complete') {
      const reset = await staleResetTransaction();
      if (reset === 'attempt-present') return finish('STORAGE_UNAVAILABLE', { reason: 'revert-attempt-orphan' });
      if (reset === 'authority-present') return reenterForward(reentries);
      if (reset === 'reset') {
        const rerun = await runLegacyMigration({ replica, storage, cryptoApi, newId, newPreparationId: newId, now: clock });
        return finishAfterMigration(rerun, context);
      }
    }
    return finishAfterMigration(migrationResult, context);
  }

  async function bootAuthorityAbsent({ reentries }) {
    const hint = classifyHint(storage);
    if (hint.kind === 'unreadable') return finish('STORAGE_UNAVAILABLE', { reason: 'hint-unreadable' });
    if (hint.kind === 'valid') return finish('STORAGE_LOST', { variant: 'dated', switchedAt: hint.value.switchedAt, hintRaw: hint.raw });
    if (hint.kind === 'malformed') return finish('STORAGE_LOST', { variant: 'undated', hintRaw: hint.raw });
    // Re-entry bound spent: this boot's own fresh read proved authority absent.
    if (reentries > MAX_REENTRIES) return finish('LEGACY');
    return runMigrationAndSwitch({ switchId: newId(), reentries });
  }

  // The reverted reset re-reads authority AND the revert-attempt key inside its own transaction.
  async function revertedResetTransaction() {
    try {
      return await replica.transact(
        ['meta', 'householdProfile', 'calendarEvents', 'sharedPlaces', 'wasteState', 'outbox', 'auth', 'syncState', 'conflicts'],
        'readwrite',
        async ({ stores }) => {
          const authority = await requestResult(stores.meta.get(AUTHORITY_KEY));
          if (!isWellFormedAuthorityRecord(authority) || authority.status !== 'reverted') return 'authority-changed';
          const attempt = await requestResult(stores.meta.get(ATTEMPT_KEY));
          if (attempt !== undefined) return 'attempt-present';
          for (const name of EMPTY_CHECK_STORES) if (await requestResult(stores[name].count()) > 0) return 'refused';
          for (const name of ENTITY_STORES) {
            const keys = await requestResult(stores[name].getAllKeys());
            for (const key of keys) stores[name].delete(key);
          }
          for (const key of EXTRA_META_KEYS) stores.meta.delete(key);
          stores.meta.delete(MARKER_KEY);
          stores.meta.delete(AUTHORITY_KEY);
          return 'reset';
        },
      );
    } catch {
      return 'refused';
    }
  }

  async function bootAuthorityReverted({ reentries }) {
    const hint = classifyHint(storage);
    if (hint.kind === 'unreadable') return finish('STORAGE_UNAVAILABLE', { reason: 'hint-unreadable' });
    if (hint.kind === 'valid' || hint.kind === 'malformed') {
      const removed = removeHintVerified(storage);
      if (!removed) return finish('STORAGE_UNAVAILABLE', { reason: 'hint-removal-failed' });
    }
    const reset = await revertedResetTransaction();
    if (reset === 'attempt-present') return finish('STORAGE_UNAVAILABLE', { reason: 'revert-attempt-orphan' });
    if (reset === 'authority-changed' && reentries <= MAX_REENTRIES) return reenterForward(reentries);
    if (reset !== 'reset') return finish('STORAGE_UNAVAILABLE', { reason: 'reverted-reset-blocked' });
    if (reentries > MAX_REENTRIES) return finish('LEGACY');
    return runMigrationAndSwitch({ switchId: newId(), reentries });
  }

  // Section 1a forward row, decided entirely from the authority and attempt values read inside this
  // one meta transaction; nothing computed from the boot-time read is trusted.
  async function forwardFindsRevertingTransaction(expectedSwitchId) {
    return replica.transact(['meta'], 'readwrite', async ({ stores }) => {
      const current = await requestResult(stores.meta.get(AUTHORITY_KEY));
      const currentAttempt = await requestResult(stores.meta.get(ATTEMPT_KEY));
      if (!isWellFormedAuthorityRecord(current) || current.status !== 'reverting' || current.switchId !== expectedSwitchId) return { kind: 'authority-changed' };
      const attemptClass = classifyBootAttempt(current, currentAttempt);
      if (attemptClass.kind === 'orphan') return { kind: 'orphan' };
      const legacyUntrusted = attemptClass.kind === 'valid'
        ? current.legacyUntrusted || attemptClass.attempt.phase !== 'started'
        : true;
      const next = { ...current, status: 'active', legacyUntrusted };
      stores.meta.put(next);
      if (currentAttempt !== undefined) stores.meta.delete(ATTEMPT_KEY);
      return { kind: 'converged', record: next };
    });
  }

  async function bootAuthorityReverting(authorityRaw, { reentries }) {
    let transition;
    try {
      transition = await forwardFindsRevertingTransaction(authorityRaw.switchId);
    } catch {
      return finish('STORAGE_UNAVAILABLE', { reason: 'authority-transition-failed' });
    }
    if (transition.kind === 'converged') return bootAuthorityActive(transition.record);
    if (transition.kind === 'orphan') return finish('STORAGE_UNAVAILABLE', { reason: 'revert-attempt-orphan' });
    if (reentries <= MAX_REENTRIES) return reenterForward(reentries);
    return finish('STORAGE_UNAVAILABLE', { reason: 'authority-transition-failed' });
  }

  async function bootForward({ reentries = 0 } = {}) {
    let metaRead;
    try {
      metaRead = await readAuthorityAndAttempt();
    } catch (error) {
      return finish(...classifyOpenError(error));
    }
    const { authority: authorityRaw, attempt: attemptRaw } = metaRead;
    if (authorityRaw !== undefined && !isWellFormedAuthorityRecord(authorityRaw)) return finish('STORAGE_UNAVAILABLE', { reason: 'authority-malformed' });
    const attemptClass = classifyBootAttempt(authorityRaw, attemptRaw);
    if (attemptClass.kind === 'orphan') return finish('STORAGE_UNAVAILABLE', { reason: 'revert-attempt-orphan' });
    const context = { reentries };
    if (authorityRaw === undefined) return bootAuthorityAbsent(context);
    if (authorityRaw.status === 'reverted') return bootAuthorityReverted(context);
    if (authorityRaw.status === 'active') return bootAuthorityActive(authorityRaw);
    return bootAuthorityReverting(authorityRaw, context);
  }

  // ---- revert boot (Section 6) ----------------------------------------------------------------

  function probeTargetKeys(switchId, attemptId) {
    const values = [];
    try {
      for (const domain of BACKUP_DOMAINS) values.push(storage.getItem(backupKey(switchId, attemptId, domain)));
    } catch {
      return 'unreadable';
    }
    return values.every(value => value === null) ? 'free' : 'taken';
  }

  async function selectAttemptId(switchId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let candidate;
      try {
        candidate = newId();
      } catch {
        candidate = '';
      }
      if (!isNonEmptyString(candidate)) continue;
      const probe = probeTargetKeys(switchId, candidate);
      if (probe === 'free') return { ok: true, attemptId: candidate };
      if (probe === 'unreadable') return { ok: false, reason: 'revert-backup-key-unreadable' };
    }
    return { ok: false, reason: 'revert-attempt-id-collision' };
  }

  function readBackupSet(switchId, attemptId) {
    let pointerRaw;
    try {
      pointerRaw = storage.getItem(pointerKey(switchId));
    } catch {
      return { ok: false };
    }
    if (pointerRaw === null) return { ok: false };
    let pointer;
    try {
      pointer = JSON.parse(pointerRaw);
    } catch {
      return { ok: false };
    }
    if (!isPlainObject(pointer) || Object.keys(pointer).length !== 3 || pointer.version !== 1 || pointer.switchId !== switchId || pointer.attemptId !== attemptId) return { ok: false };
    const backups = [];
    for (const domain of BACKUP_DOMAINS) {
      let raw;
      try {
        raw = storage.getItem(backupKey(switchId, attemptId, domain));
      } catch {
        return { ok: false };
      }
      if (raw === null) return { ok: false };
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false };
      }
      const legacyKey = legacyKeyForDomain(domain);
      if (!isPlainObject(parsed) || Object.keys(parsed).length !== 3 || parsed.version !== 1 || parsed.legacyKey !== legacyKey || !(typeof parsed.raw === 'string' || parsed.raw === null)) return { ok: false };
      backups.push(parsed);
    }
    return { ok: true, backups };
  }

  async function prepareBackups({ switchId, attemptId }) {
    const probe0 = probeTargetKeys(switchId, attemptId);
    if (probe0 === 'taken') return { ok: false, reason: 'revert-attempt-id-collision' };
    if (probe0 === 'unreadable') return { ok: false, reason: 'revert-backup-key-unreadable' };
    let raws;
    try {
      raws = LEGACY_SHARED_KEYS.map(key => storage.getItem(key));
    } catch {
      return { ok: false, reason: 'revert-preparation-failed' };
    }
    const values = BACKUP_DOMAINS.map((domain, index) => JSON.stringify({ version: 1, legacyKey: LEGACY_SHARED_KEYS[index], raw: raws[index] }));
    try {
      BACKUP_DOMAINS.forEach((domain, index) => storage.setItem(backupKey(switchId, attemptId, domain), values[index]));
    } catch {
      return { ok: false, reason: 'revert-preparation-failed' };
    }
    for (const [index, domain] of BACKUP_DOMAINS.entries()) {
      let stored;
      try {
        stored = storage.getItem(backupKey(switchId, attemptId, domain));
      } catch {
        return { ok: false, reason: 'revert-preparation-failed' };
      }
      if (stored !== values[index]) return { ok: false, reason: 'revert-preparation-failed' };
    }
    const pointerValue = JSON.stringify({ version: 1, switchId, attemptId });
    try {
      storage.setItem(pointerKey(switchId), pointerValue);
      if (storage.getItem(pointerKey(switchId)) !== pointerValue) return { ok: false, reason: 'revert-preparation-failed' };
    } catch {
      return { ok: false, reason: 'revert-preparation-failed' };
    }
    return { ok: true };
  }

  // meta extras records are stored as { key, value: { sourceVersion, fields } } (Section 5 item 6 /
  // legacyMigration.js envelopeExtras); unwrapped here so downstream code only sees { sourceVersion, fields }.
  async function readDomainSnapshotForExport() {
    return replica.transact(['meta', 'householdProfile', 'calendarEvents', 'sharedPlaces', 'wasteState'], 'readonly', async ({ stores }) => ({
      calendarExtras: (await requestResult(stores.meta.get(EXTRA_META_KEYS[0])))?.value ?? null,
      householdExtras: (await requestResult(stores.meta.get(EXTRA_META_KEYS[1])))?.value ?? null,
      householdProfile: (await requestResult(stores.householdProfile.get('household'))) ?? null,
      wasteState: (await requestResult(stores.wasteState.get('waste'))) ?? null,
      calendarEvents: await requestResult(stores.calendarEvents.getAll()),
      sharedPlaces: await requestResult(stores.sharedPlaces.getAll()),
    }));
  }

  function buildExportPayloads(snapshot) {
    const sortedEvents = [...snapshot.calendarEvents].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const calendarEnvelope = {
      version: snapshot.calendarExtras ? snapshot.calendarExtras.sourceVersion : 1,
      ...(snapshot.calendarExtras ? snapshot.calendarExtras.fields : {}),
      events: sortedEvents.map(record => record.payload),
      ...(snapshot.wasteState ? { wasteImports: snapshot.wasteState.payload.wasteImports } : {}),
    };
    const profile = snapshot.householdProfile
      ? (({ serverHouseholdId, ...rest }) => rest)(snapshot.householdProfile.payload)
      : { name: '', address: '' };
    const householdEnvelope = {
      version: snapshot.householdExtras ? snapshot.householdExtras.sourceVersion : 1,
      ...(snapshot.householdExtras ? snapshot.householdExtras.fields : {}),
      profile,
    };
    const orderedPlaces = [...snapshot.sharedPlaces].sort((left, right) => left.order - right.order).map(record => record.payload);
    return {
      calendar: JSON.stringify(calendarEnvelope),
      household: JSON.stringify(householdEnvelope),
      places: JSON.stringify(normalizePlaces(orderedPlaces)),
    };
  }

  function verifyExportedLegacy(snapshot) {
    const refuseNewId = () => { throw new Error('export verification must not mint IDs'); };
    let calendarLoaded;
    try {
      calendarLoaded = createEventRepository(storage, refuseNewId).load();
    } catch {
      return false;
    }
    if (!calendarLoaded.writable) return false;
    const expectedIds = new Set(snapshot.calendarEvents.map(record => record.id));
    const loadedIds = new Set(calendarLoaded.events.map(event => event.id));
    if (expectedIds.size !== loadedIds.size || ![...expectedIds].every(id => loadedIds.has(id))) return false;
    for (const record of snapshot.calendarEvents) {
      const loadedEvent = calendarLoaded.events.find(event => event.id === record.id);
      if (!sameValue(loadedEvent, record.payload)) return false;
    }
    const expectedWasteImports = snapshot.wasteState ? snapshot.wasteState.payload.wasteImports : undefined;
    if (!(sameValue(calendarLoaded.wasteImports, expectedWasteImports) || (calendarLoaded.wasteImports === undefined && expectedWasteImports === undefined))) return false;
    for (const [key, value] of Object.entries(snapshot.calendarExtras ? snapshot.calendarExtras.fields : {})) {
      if (!sameValue(calendarLoaded[key], value)) return false;
    }

    let householdLoaded;
    try {
      householdLoaded = createHouseholdRepository(storage).load();
    } catch {
      return false;
    }
    if (!householdLoaded.writable) return false;
    const expectedProfile = snapshot.householdProfile
      ? (({ serverHouseholdId, ...rest }) => rest)(snapshot.householdProfile.payload)
      : { name: '', address: '' };
    if (!sameValue(householdLoaded.profile, expectedProfile)) return false;
    for (const [key, value] of Object.entries(snapshot.householdExtras ? snapshot.householdExtras.fields : {})) {
      if (!sameValue(householdLoaded[key], value)) return false;
    }

    let placesRaw;
    try {
      placesRaw = storage.getItem(LEGACY_SHARED_KEYS[2]);
    } catch {
      return false;
    }
    let placesParsed;
    try {
      placesParsed = JSON.parse(placesRaw);
    } catch {
      return false;
    }
    const expectedPlaces = normalizePlaces([...snapshot.sharedPlaces].sort((left, right) => left.order - right.order).map(record => record.payload));
    return sameValue(normalizePlaces(placesParsed), expectedPlaces);
  }

  async function abortBeforeExport(authority, attempt) {
    try {
      await replica.transact(['meta'], 'readwrite', async ({ stores }) => {
        const currentAuthority = await requestResult(stores.meta.get(AUTHORITY_KEY));
        const currentAttempt = await requestResult(stores.meta.get(ATTEMPT_KEY));
        if (!isWellFormedAuthorityRecord(currentAuthority) || currentAuthority.status !== 'reverting' || currentAuthority.switchId !== authority.switchId
          || !isWellFormedRevertAttemptRecord(currentAttempt) || currentAttempt.switchId !== authority.switchId
          || currentAttempt.attemptId !== attempt.attemptId || currentAttempt.phase !== 'started'
          || currentAttempt.commitCountAtStart !== currentAuthority.commitCount) throw new Error('abort-guard-failed');
        stores.meta.put({ ...currentAuthority, status: 'active' });
        stores.meta.delete(ATTEMPT_KEY);
      });
    } catch {
      // Leaves the durable state at reverting/started; the next boot resumes safely.
    }
  }

  function compensate(backups) {
    try {
      backups.forEach(entry => { if (entry.raw === null) storage.removeItem(entry.legacyKey); else storage.setItem(entry.legacyKey, entry.raw); });
    } catch {
      return false;
    }
    return backups.every(entry => {
      let current;
      try {
        current = storage.getItem(entry.legacyKey);
      } catch {
        return false;
      }
      return current === entry.raw;
    });
  }

  // Compensation is owned by one meta readwrite transaction. The exact durable guard is checked FIRST;
  // only while it holds are the backups re-read and the three shared keys restored and verified,
  // synchronously, with no await between the first restore write and the authority/attempt writes.
  // A failed guard means zero compensation writes and zero attempt cleanup.
  async function compensateAndFail(authority, attempt) {
    let verified = null;
    let outcome;
    try {
      outcome = await replica.transact(['meta'], 'readwrite', async ({ stores }) => {
        const currentAuthority = await requestResult(stores.meta.get(AUTHORITY_KEY));
        const currentAttempt = await requestResult(stores.meta.get(ATTEMPT_KEY));
        if (!isWellFormedAuthorityRecord(currentAuthority) || currentAuthority.status !== 'reverting' || currentAuthority.switchId !== authority.switchId
          || !isWellFormedRevertAttemptRecord(currentAttempt) || currentAttempt.switchId !== authority.switchId
          || currentAttempt.attemptId !== attempt.attemptId || currentAttempt.phase !== 'backups-verified'
          || currentAttempt.commitCountAtStart !== currentAuthority.commitCount) return 'guard-failed';
        const backupSet = readBackupSet(authority.switchId, attempt.attemptId);
        if (!backupSet.ok) return 'backups-lost';
        verified = compensate(backupSet.backups);
        stores.meta.put(verified ? { ...currentAuthority, status: 'active' } : { ...currentAuthority, status: 'active', legacyUntrusted: true });
        stores.meta.delete(ATTEMPT_KEY);
        return 'compensated';
      });
    } catch {
      if (verified === null) return finish('REVERT_FAILED', { reason: 'revert-compensation-not-run' });
      return finish('REVERT_FAILED', { reason: verified ? 'revert-compensation-verified-write-failed' : 'revert-compensation-failed-write-failed' });
    }
    if (outcome === 'guard-failed') return finish('REVERT_FAILED', { reason: 'revert-compensation-guard-failed' });
    if (outcome === 'backups-lost') return finish('REVERT_FAILED', { reason: 'revert-backups-lost' });
    return finish('REVERT_FAILED', { reason: verified ? 'revert-compensation-verified' : 'revert-compensation-failed' });
  }

  async function transitionToBackupsVerified(authority, attempt) {
    try {
      return await replica.transact(['meta'], 'readwrite', async ({ stores }) => {
        const currentAuthority = await requestResult(stores.meta.get(AUTHORITY_KEY));
        const currentAttempt = await requestResult(stores.meta.get(ATTEMPT_KEY));
        if (!isWellFormedAuthorityRecord(currentAuthority) || currentAuthority.status !== 'reverting' || currentAuthority.switchId !== authority.switchId
          || !isWellFormedRevertAttemptRecord(currentAttempt) || currentAttempt.switchId !== authority.switchId
          || currentAttempt.attemptId !== attempt.attemptId || currentAttempt.phase !== 'started'
          || currentAttempt.commitCountAtStart !== currentAuthority.commitCount) return null;
        const next = { ...currentAttempt, phase: 'backups-verified' };
        stores.meta.put(next);
        return next;
      });
    } catch {
      return null;
    }
  }

  async function completeRevert(authority, attempt) {
    try {
      const ok = await replica.transact(['meta'], 'readwrite', async ({ stores }) => {
        const currentAuthority = await requestResult(stores.meta.get(AUTHORITY_KEY));
        const currentAttempt = await requestResult(stores.meta.get(ATTEMPT_KEY));
        if (!isWellFormedAuthorityRecord(currentAuthority) || currentAuthority.status !== 'reverting' || currentAuthority.switchId !== authority.switchId
          || !isWellFormedRevertAttemptRecord(currentAttempt) || currentAttempt.switchId !== authority.switchId
          || currentAttempt.attemptId !== attempt.attemptId || currentAttempt.phase !== 'backups-verified'
          || currentAttempt.commitCountAtStart !== currentAuthority.commitCount) return false;
        stores.meta.put({ ...currentAuthority, status: 'reverted' });
        stores.meta.delete(ATTEMPT_KEY);
        return true;
      });
      if (ok) return true;
    } catch {
      // fall through to the ambiguous re-read
    }
    // Ambiguous failure: re-read BOTH records before deciding. Compensation may only run against the
    // exact same attempt identity that was just exported; anything else (including a newer, different
    // attempt) is REVERT_FAILED with no further shared-key write, never a compensation from a stale set.
    let reread;
    try {
      reread = await replica.transact(['meta'], 'readonly', async ({ stores }) => ({
        authority: await requestResult(stores.meta.get(AUTHORITY_KEY)),
        attempt: await requestResult(stores.meta.get(ATTEMPT_KEY)),
      }));
    } catch {
      return 'failed-unknown';
    }
    if (isWellFormedAuthorityRecord(reread.authority) && reread.authority.status === 'reverted' && reread.attempt === undefined) return true;
    if (isWellFormedAuthorityRecord(reread.authority) && reread.authority.status === 'reverting' && reread.authority.switchId === authority.switchId
      && isWellFormedRevertAttemptRecord(reread.attempt) && reread.attempt.switchId === authority.switchId
      && reread.attempt.attemptId === attempt.attemptId && reread.attempt.phase === 'backups-verified'
      && reread.attempt.commitCountAtStart === reread.authority.commitCount) return 'compensate';
    return 'failed-unknown';
  }

  async function continueReverting(authority, initialAttempt) {
    let attempt = initialAttempt;
    let snapshot;
    let payloads;
    try {
      snapshot = await readDomainSnapshotForExport();
      // Section 6c step 3: read AND VALIDATE all three domain snapshots before export. An invalid
      // record must never be exported merely because the legacy repository can parse the result.
      const invalidDomains = classifyDomainValidity(snapshot);
      if (invalidDomains.length > 0) throw new Error(`revert snapshot invalid: ${invalidDomains.join(',')}`);
      payloads = buildExportPayloads(snapshot);
    } catch {
      if (attempt.phase === 'started') {
        await abortBeforeExport(authority, attempt);
        return finish('REVERT_FAILED', { reason: 'revert-snapshot-invalid' });
      }
      const backupSet = readBackupSet(authority.switchId, attempt.attemptId);
      if (!backupSet.ok) return finish('REVERT_FAILED', { reason: 'revert-backups-lost' });
      return compensateAndFail(authority, attempt);
    }

    if (attempt.phase === 'started') {
      const prep = await prepareBackups({ switchId: authority.switchId, attemptId: attempt.attemptId });
      if (!prep.ok) {
        await abortBeforeExport(authority, attempt);
        return finish('REVERT_FAILED', { reason: prep.reason });
      }
      const transitioned = await transitionToBackupsVerified(authority, attempt);
      if (!transitioned) return finish('REVERT_FAILED', { reason: 'revert-phase-transition-failed' });
      attempt = transitioned;
    }

    const backupSet = readBackupSet(authority.switchId, attempt.attemptId);
    if (!backupSet.ok) return finish('REVERT_FAILED', { reason: 'revert-backups-lost' });

    let exported = true;
    try {
      storage.setItem(LEGACY_SHARED_KEYS[0], payloads.calendar);
      storage.setItem(LEGACY_SHARED_KEYS[1], payloads.household);
      storage.setItem(LEGACY_SHARED_KEYS[2], payloads.places);
    } catch {
      exported = false;
    }
    if (exported && !verifyExportedLegacy(snapshot)) exported = false;
    if (!exported) return compensateAndFail(authority, attempt);

    const completed = await completeRevert(authority, attempt);
    if (completed === 'failed-unknown') return finish('REVERT_FAILED', { reason: 'revert-complete-reread-failed' });
    if (completed === 'compensate') return compensateAndFail(authority, attempt);
    const removed = removeHintVerified(storage);
    if (!removed) return finish('STORAGE_UNAVAILABLE', { reason: 'hint-removal-failed' });
    return finish('LEGACY');
  }

  async function beginRevert(authorityRaw) {
    // The candidate is probed under this exact switchId (Section 6b). If the authority's switchId has
    // since changed, the candidate's collision-freeness was never verified in the new namespace, so the
    // begin transaction must refuse rather than reuse it there.
    const expectedSwitchId = authorityRaw.switchId;
    const selection = await selectAttemptId(expectedSwitchId);
    if (!selection.ok) return finish('REVERT_FAILED', { reason: selection.reason });
    let began;
    try {
      began = await replica.transact(['meta'], 'readwrite', async ({ stores }) => {
        const current = await requestResult(stores.meta.get(AUTHORITY_KEY));
        if (!isWellFormedAuthorityRecord(current) || current.status !== 'active' || current.switchId !== expectedSwitchId) return null;
        const existingAttempt = await requestResult(stores.meta.get(ATTEMPT_KEY));
        if (existingAttempt !== undefined) return null;
        const nextAuthority = { ...current, status: 'reverting' };
        const attempt = { key: ATTEMPT_KEY, switchId: current.switchId, attemptId: selection.attemptId, commitCountAtStart: current.commitCount, phase: 'started' };
        stores.meta.put(nextAuthority);
        stores.meta.put(attempt);
        return { authority: nextAuthority, attempt };
      });
    } catch {
      began = null;
    }
    if (!began) return finish('REVERT_FAILED', { reason: 'revert-begin-failed' });
    return continueReverting(began.authority, began.attempt);
  }

  async function bootRevertAuthorityReverted() {
    const hint = classifyHint(storage);
    if (hint.kind === 'unreadable') return finish('STORAGE_UNAVAILABLE', { reason: 'hint-unreadable' });
    if (hint.kind === 'valid' || hint.kind === 'malformed') {
      const removed = removeHintVerified(storage);
      if (!removed) return finish('STORAGE_UNAVAILABLE', { reason: 'hint-removal-failed' });
    }
    return finish('LEGACY');
  }

  async function bootRevertAuthorityAbsent() {
    const hint = classifyHint(storage);
    if (hint.kind === 'absent') return finish('LEGACY');
    if (hint.kind === 'valid') return finish('REVERT_STORAGE_LOST', { variant: 'dated', switchedAt: hint.value.switchedAt, hintRaw: hint.raw });
    if (hint.kind === 'malformed') return finish('REVERT_STORAGE_LOST', { variant: 'undated', hintRaw: hint.raw });
    return finish('STORAGE_UNAVAILABLE', { reason: 'hint-unreadable' });
  }

  async function bootRevert() {
    let metaRead;
    try {
      metaRead = await readAuthorityAndAttempt();
    } catch (error) {
      return finish(...classifyOpenError(error));
    }
    const { authority: authorityRaw, attempt: attemptRaw } = metaRead;
    if (authorityRaw !== undefined && !isWellFormedAuthorityRecord(authorityRaw)) return finish('STORAGE_UNAVAILABLE', { reason: 'authority-malformed' });
    const attemptClass = classifyBootAttempt(authorityRaw, attemptRaw);
    if (attemptClass.kind === 'orphan') return finish('STORAGE_UNAVAILABLE', { reason: 'revert-attempt-orphan' });
    if (authorityRaw === undefined) return bootRevertAuthorityAbsent();
    if (authorityRaw.status === 'reverted') return bootRevertAuthorityReverted();
    if (authorityRaw.status === 'active') {
      // Section 3: REVERTING is entered only once the revert is actually beginning (a valid active
      // authority, about to transition). Authority-absent and already-reverted paths above never pass
      // through here, and a malformed/unknown authority already returned before this point.
      setState('REVERTING');
      return beginRevert(authorityRaw);
    }
    if (attemptClass.kind === 'invalid-under-reverting') return finish('REVERT_FAILED', { reason: 'revert-attempt-invalid' });
    // Resuming a genuinely in-progress revert (a valid durable attempt under a reverting authority).
    setState('REVERTING');
    return continueReverting(authorityRaw, attemptClass.attempt);
  }

  // ---- mounted runtime signals (Issue A) --------------------------------------------------------
  // C6 owns the actual browser event wiring (storage events, focus/visibilitychange, the injected
  // broadcast channel); this controller owns only the resulting state decisions. No browser global is
  // read here -- every capability stays injected, same as boot().

  const LEGACY_KEY_SET = new Set(LEGACY_SHARED_KEYS);

  // Section 2 divergence re-check for an already-mounted READY tab. Sticky: once flagged, the notice
  // is never cleared by a later signal (no re-adopt; every occurrence is a STOP condition).
  async function recheckLegacyDivergenceInReady() {
    if (state !== 'READY' || !mountedAuthority) return;
    if (!divergenceNoticeActive) {
      const diverged = await checkDivergence(mountedAuthority);
      if (diverged) divergenceNoticeActive = true;
    }
    if (state === 'READY') finish('READY', readyDetail());
  }

  // Section 1b hint watch for an already-mounted READY tab: reclassify, and rewrite through the same
  // hint gate boot() uses on any non-matching result. A gate failure moves out of READY; it never
  // falls back to LEGACY.
  async function recheckHintInReady() {
    if (state !== 'READY' || !mountedAuthority) return;
    const gated = await ensureHintGate(mountedAuthority);
    if (!gated) { finish('AUTHORITY_HINT_PENDING'); return; }
    if (state === 'READY') finish('READY', readyDetail());
  }

  // Section 5 item 6 domain re-validation for an already-mounted READY tab (used by the generic
  // foreground/focus recheck below; it never repairs, only reports).
  async function recheckDomainsInReady() {
    if (state !== 'READY' || !mountedAuthority) return;
    domainInvalidList = await loadAndValidateDomains();
    if (state === 'READY') finish('READY', readyDetail());
  }

  // Generic foreground/authority recheck for an already-mounted READY tab (focus/visibilitychange,
  // or an authority-changed broadcast). Re-reads the durable authority and attempt records and
  // compares identity against what this tab mounted with. A changed, missing or non-active authority
  // always means RELOAD_REQUIRED here -- this mounted recheck never runs the forward-boot
  // reverting -> active convergence transition; that belongs to a fresh boot() only.
  async function recheckAuthorityIdentityInReady() {
    if (state !== 'READY' || !mountedAuthority) return;
    let metaRead;
    try {
      metaRead = await readAuthorityAndAttempt();
    } catch (error) {
      finish(...classifyOpenError(error));
      return;
    }
    const { authority: raw, attempt: attemptRaw } = metaRead;
    if (raw === undefined) { finish('RELOAD_REQUIRED'); return; }
    if (!isWellFormedAuthorityRecord(raw)) { finish('STORAGE_UNAVAILABLE', { reason: 'authority-malformed' }); return; }
    if (raw.status !== 'active' || raw.switchId !== mountedAuthority.switchId) { finish('RELOAD_REQUIRED'); return; }
    const attemptClass = classifyBootAttempt(raw, attemptRaw);
    if (attemptClass.kind === 'orphan') { finish('STORAGE_UNAVAILABLE', { reason: 'revert-attempt-orphan' }); return; }
    mountedAuthority = raw;
    await recheckHintInReady();
    if (state !== 'READY') return;
    await recheckLegacyDivergenceInReady();
    if (state !== 'READY') return;
    await recheckDomainsInReady();
  }

  // storage event (or storage.clear(), key === null) for one of the 3 shared legacy keys and/or the
  // hint key. A mounted LEGACY tab responds only to the hint case (Section 1b LEGACY write guard
  // already covers the write path itself; this covers the already-open-tab response).
  async function handleStorageSignal(key) {
    const affectsLegacy = key === null || LEGACY_KEY_SET.has(key);
    const affectsHint = key === null || key === HINT_KEY;
    if (!affectsLegacy && !affectsHint) return;
    if (state === 'READY') {
      if (affectsLegacy) await recheckLegacyDivergenceInReady();
      if (affectsHint && state === 'READY') await recheckHintInReady();
      return;
    }
    if (state === 'LEGACY' && affectsHint) {
      const hint = classifyHint(storage);
      // Any non-absent classification (valid, malformed or unreadable) means a new build switched
      // elsewhere; this LEGACY tab must reload rather than silently boot itself into READY.
      if (hint.kind !== 'absent') finish('RELOAD_REQUIRED');
    }
  }

  async function handleAuthorityChangedBroadcast() {
    if (state === 'LEGACY') { finish('RELOAD_REQUIRED'); return; }
    if (state === 'READY') await recheckAuthorityIdentityInReady();
  }

  async function handleForegroundSignal() {
    if (state === 'READY') await recheckAuthorityIdentityInReady();
  }

  // Narrow C6-facing entrypoint: C4 owns every state decision; C6 only forwards the raw signal
  // (a storage event, a focus/visibilitychange event, or a received broadcast message) here. C4 does
  // not subscribe to the injected broadcast capability itself, so close() has no extra listener to
  // detach for it.
  async function handleRuntimeSignal(signal) {
    if (!isPlainObject(signal)) return lastResult;
    if (signal.type === 'authority-changed') { await handleAuthorityChangedBroadcast(); return lastResult; }
    if (signal.type === 'storage') { await handleStorageSignal(signal.key === undefined ? null : signal.key); return lastResult; }
    if (signal.type === 'focus' || signal.type === 'visibility') { await handleForegroundSignal(); return lastResult; }
    return lastResult;
  }

  // ---- public entrypoints ----------------------------------------------------------------------

  async function boot() {
    setState('BOOTING');
    const run = () => (mode === 'revert' ? bootRevert() : bootForward());
    try {
      return await (locks ? locks.request(LOCK_NAME, run) : run());
    } catch (error) {
      return finish(...classifyOpenError(error));
    }
  }

  async function confirmStorageLost() {
    if (state !== 'STORAGE_LOST') throw new Error('confirmStorageLost requires the STORAGE_LOST state');
    const context = { variant: lastResult.variant, switchedAt: lastResult.switchedAt, hintRaw: lastResult.hintRaw };
    setState('BOOTING');
    const run = () => runMigrationAndSwitch({ switchId: newId(), storageLostContext: context });
    try {
      return await (locks ? locks.request(LOCK_NAME, run) : run());
    } catch (error) {
      return finish(...classifyOpenError(error));
    }
  }

  async function confirmRevertStorageLost() {
    if (state !== 'REVERT_STORAGE_LOST') throw new Error('confirmRevertStorageLost requires the REVERT_STORAGE_LOST state');
    const expected = { variant: lastResult.variant, hintRaw: lastResult.hintRaw };
    const run = async () => {
      let metaRead;
      try {
        metaRead = await readAuthorityAndAttempt();
      } catch {
        setState('BOOTING');
        return bootRevert();
      }
      const currentHint = classifyHint(storage);
      const expectedKind = expected.variant === 'dated' ? 'valid' : 'malformed';
      const stillMatches = metaRead.authority === undefined && metaRead.attempt === undefined
        && currentHint.kind === expectedKind && currentHint.raw === expected.hintRaw;
      if (!stillMatches) {
        setState('BOOTING');
        return bootRevert();
      }
      const removed = removeHintVerified(storage);
      if (!removed) return finish('STORAGE_UNAVAILABLE', { reason: 'hint-removal-failed' });
      return finish('LEGACY');
    };
    return locks ? locks.request(LOCK_NAME, run) : run();
  }

  return {
    replica,
    getState: () => state,
    getResult: () => lastResult,
    subscribe: listener => {
      listeners = [...listeners, listener];
      return () => { listeners = listeners.filter(entry => entry !== listener); };
    },
    boot,
    retry: boot,
    confirmStorageLost,
    confirmRevertStorageLost,
    handleRuntimeSignal,
    close: () => replica.close(),
  };
}
