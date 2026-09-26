import { useState, useCallback, useMemo, useRef } from 'react';

const PIN_KEY     = 'sade_diary_pin';
const ENTRIES_KEY = 'sade_diary_entries';

function readEntries() {
  try { return JSON.parse(localStorage.getItem(ENTRIES_KEY) || '[]'); } catch { return []; }
}
function writeEntries(entries) {
  try {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
export function readPin() {
  try { const v = localStorage.getItem(PIN_KEY); return v ? atob(v) : null; } catch { return null; }
}
export function writePin(pin) {
  try {
    localStorage.setItem(PIN_KEY, btoa(pin));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
export function clearDiaryStorage() {
  let pinBytes;
  let entryBytes;
  try {
    pinBytes = localStorage.getItem(PIN_KEY);
    entryBytes = localStorage.getItem(ENTRIES_KEY);
  } catch (error) {
    return { ok: false, error, restored: false };
  }

  let pinMayHaveChanged = false;
  let entriesMayHaveChanged = false;
  try {
    pinMayHaveChanged = true;
    localStorage.removeItem(PIN_KEY);
    entriesMayHaveChanged = true;
    localStorage.removeItem(ENTRIES_KEY);
    return { ok: true };
  } catch (error) {
    let restored = true;
    for (const [changed, key, bytes] of [
      [pinMayHaveChanged, PIN_KEY, pinBytes],
      [entriesMayHaveChanged, ENTRIES_KEY, entryBytes],
    ]) {
      if (!changed) continue;
      try {
        if (bytes === null) localStorage.removeItem(key);
        else localStorage.setItem(key, bytes);
        if (localStorage.getItem(key) !== bytes) restored = false;
      } catch {
        restored = false;
      }
    }
    return { ok: false, error, restored };
  }
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function daysBetween(dateStr, now = new Date()) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr + 'T00:00:00');
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((n - d) / 86400000);
}

export function streakInfo(entries) {
  if (!entries.length) return { days: 0, lastDate: null, warning: false };
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const lastDate = sorted[0].date;
  const days = daysBetween(lastDate);
  return { days, lastDate, warning: days >= 3 };
}

export function useDiary() {
  const [unlocked,  setUnlocked]  = useState(false);
  const [entries,   setEntries]   = useState([]);
  const [pinError,  setPinError]  = useState(false);
  const committedEntries = useRef([]);

  const pinSet = !!readPin();

  const setupPin = useCallback((pin) => {
    const result = writePin(pin);
    if (!result.ok) return result;
    committedEntries.current = [];
    setEntries([]);
    setUnlocked(true);
    setPinError(false);
    return result;
  }, []);

  const tryUnlock = useCallback((pin) => {
    if (pin === readPin()) {
      const savedEntries = readEntries();
      committedEntries.current = savedEntries;
      setEntries(savedEntries);
      setUnlocked(true);
      setPinError(false);
      return true;
    }
    setPinError(true);
    return false;
  }, []);

  const lock = useCallback(() => {
    committedEntries.current = [];
    setUnlocked(false);
    setEntries([]);
    setPinError(false);
  }, []);

  const changePin = useCallback((oldPin, newPin) => {
    if (oldPin !== readPin()) return false;
    return writePin(newPin).ok;
  }, []);

  const resetPin = useCallback(() => {
    const result = clearDiaryStorage();
    if (!result.ok) return result;
    committedEntries.current = [];
    setUnlocked(false);
    setEntries([]);
    setPinError(false);
    return result;
  }, []);

  const addEntry = useCallback((data) => {
    const entry = {
      id: String(Date.now()),
      date: todayStr(),
      createdAt: new Date().toISOString(),
      emoji: data.emoji || '😐',
      title: data.title || '',
      good:  data.good  || '',
      hard:  data.hard  || '',
      free:  data.free  || '',
    };
    const next = [entry, ...committedEntries.current];
    const result = writeEntries(next);
    if (!result.ok) return result;
    committedEntries.current = next;
    setEntries(next);
    return { ok: true, entry };
  }, []);

  const deleteEntry = useCallback((id) => {
    const next = committedEntries.current.filter(e => e.id !== id);
    const result = writeEntries(next);
    if (!result.ok) return result;
    committedEntries.current = next;
    setEntries(next);
    return result;
  }, []);

  const streak         = useMemo(() => streakInfo(entries), [entries]);
  const hasTodayEntry  = useMemo(() => entries.some(e => e.date === todayStr()), [entries]);

  return {
    pinSet, unlocked, entries, pinError, streak, hasTodayEntry,
    setupPin, tryUnlock, lock, changePin, resetPin, addEntry, deleteEntry,
  };
}
