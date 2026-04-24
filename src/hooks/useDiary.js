import { useState, useCallback, useMemo } from 'react';

const PIN_KEY     = 'sade_diary_pin';
const ENTRIES_KEY = 'sade_diary_entries';

function readEntries() {
  try { return JSON.parse(localStorage.getItem(ENTRIES_KEY) || '[]'); } catch { return []; }
}
function writeEntries(entries) {
  try { localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries)); } catch {}
}
export function readPin() {
  try { const v = localStorage.getItem(PIN_KEY); return v ? atob(v) : null; } catch { return null; }
}
function writePin(pin) {
  try { localStorage.setItem(PIN_KEY, btoa(pin)); } catch {}
}
function clearAll() {
  try { localStorage.removeItem(PIN_KEY); localStorage.removeItem(ENTRIES_KEY); } catch {}
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

  const pinSet = !!readPin();

  const setupPin = useCallback((pin) => {
    writePin(pin);
    setEntries([]);
    setUnlocked(true);
    setPinError(false);
  }, []);

  const tryUnlock = useCallback((pin) => {
    if (pin === readPin()) {
      setEntries(readEntries());
      setUnlocked(true);
      setPinError(false);
      return true;
    }
    setPinError(true);
    return false;
  }, []);

  const lock = useCallback(() => {
    setUnlocked(false);
    setEntries([]);
    setPinError(false);
  }, []);

  const changePin = useCallback((oldPin, newPin) => {
    if (oldPin !== readPin()) return false;
    writePin(newPin);
    return true;
  }, []);

  const resetPin = useCallback(() => {
    clearAll();
    setUnlocked(false);
    setEntries([]);
    setPinError(false);
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
    setEntries(prev => {
      const next = [entry, ...prev];
      writeEntries(next);
      return next;
    });
    return entry;
  }, []);

  const deleteEntry = useCallback((id) => {
    setEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      writeEntries(next);
      return next;
    });
  }, []);

  const streak         = useMemo(() => streakInfo(entries), [entries]);
  const hasTodayEntry  = useMemo(() => entries.some(e => e.date === todayStr()), [entries]);

  return {
    pinSet, unlocked, entries, pinError, streak, hasTodayEntry,
    setupPin, tryUnlock, lock, changePin, resetPin, addEntry, deleteEntry,
  };
}
