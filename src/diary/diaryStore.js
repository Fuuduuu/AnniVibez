const DB_NAME = 'majandus_diary_v1';
const DB_VERSION = 1;
const STORE_NAME = 'diary';
const STATE_KEY = 'state';
const PIN_KEY = 'sade_diary_pin';
const ENTRIES_KEY = 'sade_diary_entries';

const fail = code => ({ ok: false, code });

function openDiaryDb() {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    let blocked = false;
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('diary database blocked'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function transaction(db, mode, body) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      if (mode === 'readwrite') {
        try { tx = db.transaction(STORE_NAME, mode, { durability: 'strict' }); }
        catch (error) {
          if (!(error instanceof TypeError)) throw error;
          tx = db.transaction(STORE_NAME, mode);
        }
      } else tx = db.transaction(STORE_NAME, mode);
    } catch (error) {
      reject(error);
      return;
    }
    let value;
    let bodyError;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(bodyError ?? tx.error ?? new Error('diary transaction aborted'));
    try {
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(STATE_KEY);
      request.onsuccess = () => {
        try { value = body(request.result ?? null, store, tx); }
        catch (error) {
          bodyError = error;
          try { tx.abort(); } catch { /* The transaction already reached a terminal state. */ }
        }
      };
      request.onerror = () => { bodyError = request.error; };
    } catch (error) {
      bodyError = error;
      try { tx.abort(); } catch { reject(error); }
    }
  });
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validEntries(entries) {
  if (!Array.isArray(entries)) return false;
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id) || !validDate(entry.date)) return false;
    ids.add(entry.id);
  }
  return true;
}

function validEncodedPin(pin) {
  if (pin === null) return true;
  if (typeof pin !== 'string') return false;
  try {
    const decoded = atob(pin);
    return /^\d{4,8}$/.test(decoded) && btoa(decoded) === pin;
  } catch { return false; }
}

function validState(state) {
  return state && state.key === STATE_KEY && state.version === 1 &&
    validEncodedPin(state.pin) && validEntries(state.entries) &&
    (state.origin === 'fresh' || state.origin === 'legacy-migration') &&
    typeof state.legacyDigest === 'string' && /^[a-f0-9]{64}$/.test(state.legacyDigest) &&
    typeof state.migratedAt === 'string' && typeof state.updatedAt === 'string';
}

function legacyRaw() {
  return [localStorage.getItem(PIN_KEY), localStorage.getItem(ENTRIES_KEY)];
}

function validateLegacy([rawPin, rawEntries]) {
  if (!validEncodedPin(rawPin)) return null;
  let entries;
  try { entries = rawEntries === null ? [] : JSON.parse(rawEntries); }
  catch { return null; }
  return validEntries(entries) ? { pin: rawPin, entries } : null;
}

async function legacyDigest(rawPin, rawEntries) {
  const bytes = new TextEncoder().encode(JSON.stringify([rawPin, rawEntries]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

class LegacyChanged extends Error {}

async function ensureState(db) {
  let existing;
  try { existing = await transaction(db, 'readonly', state => state); }
  catch { return fail('DIARY_STORAGE_UNAVAILABLE'); }
  if (existing) return validState(existing) ? { ok: true, state: existing } : fail('DIARY_STORAGE_UNAVAILABLE');

  // A second tab may migrate between this first read and our write transaction.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let raw;
    let legacy;
    let digest;
    try {
      raw = legacyRaw();
      legacy = validateLegacy(raw);
      if (!legacy) return fail('MIGRATION_FAILED');
      digest = await legacyDigest(...raw);
    } catch { return fail('MIGRATION_FAILED'); }
    try {
      const state = await transaction(db, 'readwrite', (winner, store) => {
        if (winner) {
          if (!validState(winner)) throw new Error('invalid authoritative diary state');
          return winner;
        }
        const currentRaw = legacyRaw();
        if (currentRaw[0] !== raw[0] || currentRaw[1] !== raw[1]) throw new LegacyChanged();
        const now = new Date().toISOString();
        const created = { key: STATE_KEY, version: 1, pin: legacy.pin, entries: legacy.entries,
          origin: raw[0] === null && raw[1] === null ? 'fresh' : 'legacy-migration',
          legacyDigest: digest, migratedAt: now, updatedAt: now };
        store.put(created);
        return created;
      });
      return { ok: true, state };
    } catch (error) {
      if (error instanceof LegacyChanged) continue;
      return fail('MIGRATION_FAILED');
    }
  }
  return fail('MIGRATION_FAILED');
}

async function withDiary(operation) {
  let db;
  try { db = await openDiaryDb(); }
  catch { return fail('DIARY_STORAGE_UNAVAILABLE'); }
  try {
    const authority = await ensureState(db);
    if (!authority.ok) return authority;
    return await operation(db, authority.state);
  } finally { db.close(); }
}

export async function loadDiary() {
  return withDiary(async (_, state) => {
    try {
      const raw = legacyRaw();
      return { ok: true, state, legacyChanged: await legacyDigest(...raw) !== state.legacyDigest,
        legacyCheckFailed: false };
    } catch {
      return { ok: true, state, legacyChanged: false, legacyCheckFailed: true };
    }
  });
}

async function mutate(write) {
  return withDiary(async db => {
    try {
      return await transaction(db, 'readwrite', (state, store) => {
        if (!validState(state)) throw new Error('invalid authoritative diary state');
        const operation = write(state);
        if (!operation.ok || !operation.next) return operation;
        store.put(operation.next);
        return { ...operation, state: operation.next };
      });
    } catch { return fail('DIARY_WRITE_FAILED'); }
  });
}

function updated(state, change) {
  return { ...state, ...change, updatedAt: new Date().toISOString() };
}

export async function setupDiaryPin(pin) {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) return fail('INVALID_PIN');
  return mutate(state => {
    if (state.pin !== null) return fail('DIARY_PIN_ALREADY_SET');
    if (state.entries.length) return fail('DIARY_ORPHANED_LEGACY');
    const next = updated(state, { pin: btoa(pin) });
    return { ok: true, next };
  });
}

export async function changeDiaryPin(oldPin, newPin) {
  if (typeof newPin !== 'string' || !/^\d{4,8}$/.test(newPin)) return fail('INVALID_PIN');
  return mutate(state => {
    if (state.pin === null) return fail('DIARY_RESET_ELSEWHERE');
    if (state.pin !== btoa(oldPin)) return fail('INVALID_PIN');
    return { ok: true, next: updated(state, { pin: btoa(newPin) }) };
  });
}

export async function addDiaryEntry(entry) {
  if (!validEntries([entry])) return fail('INVALID_REQUEST');
  return mutate(state => {
    if (state.pin === null) return fail('DIARY_RESET_ELSEWHERE');
    if (state.entries.some(saved => saved.id === entry.id)) return fail('DIARY_CONFLICT');
    return { ok: true, next: updated(state, { entries: [entry, ...state.entries] }), entry };
  });
}

export async function deleteDiaryEntry(id) {
  return mutate(state => {
    if (state.pin === null) return fail('DIARY_RESET_ELSEWHERE');
    if (!state.entries.some(entry => entry.id === id)) return { ok: true, removed: false, state };
    return { ok: true, removed: true,
      next: updated(state, { entries: state.entries.filter(entry => entry.id !== id) }) };
  });
}

export async function resetDiary() {
  let emptyDigest;
  try { emptyDigest = await legacyDigest(null, null); }
  catch { return fail('DIARY_STORAGE_UNAVAILABLE'); }
  const result = await mutate(state => ({ ok: true,
    next: updated(state, { pin: null, entries: [], legacyDigest: emptyDigest }) }));
  if (!result.ok) return result;
  let legacyCleanupFailed = false;
  for (const key of [PIN_KEY, ENTRIES_KEY]) {
    try {
      localStorage.removeItem(key);
      if (localStorage.getItem(key) !== null) legacyCleanupFailed = true;
    } catch { legacyCleanupFailed = true; }
  }
  return { ...result, legacyCleanupFailed };
}
