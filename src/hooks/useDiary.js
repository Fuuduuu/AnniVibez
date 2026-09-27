import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDiaryEntry, changeDiaryPin, deleteDiaryEntry, loadDiary, resetDiary,
  setupDiaryPin } from '../diary/diaryStore.js';

function statusFrom(result) {
  if (!result.ok) return result.code === 'MIGRATION_FAILED' ? 'migration-failed' : 'unavailable';
  if (result.state.pin === null && result.state.entries.length) return 'orphaned';
  return 'ready';
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(dateStr, now = new Date()) {
  if (!dateStr) return Infinity;
  const d = new Date(`${dateStr}T00:00:00`);
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
  const [status, setStatus] = useState('loading');
  const [authority, setAuthority] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [entries, setEntries] = useState([]);
  const [pinError, setPinError] = useState(false);
  const [legacyNotice, setLegacyNotice] = useState(false);
  const [legacyCheckFailed, setLegacyCheckFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadDiary().then(result => {
      if (!active) return;
      setStatus(statusFrom(result));
      if (result.ok) {
        setAuthority(result.state);
        setLegacyNotice(result.legacyChanged);
        setLegacyCheckFailed(result.legacyCheckFailed);
      }
    }).catch(() => { if (active) setStatus('unavailable'); });
    return () => { active = false; };
  }, []);

  const setupPin = useCallback(async pin => {
    const result = await setupDiaryPin(pin);
    if (!result.ok) return result;
    setAuthority(result.state);
    setEntries([]);
    setUnlocked(true);
    setPinError(false);
    setStatus('ready');
    return result;
  }, []);

  const tryUnlock = useCallback(async pin => {
    const result = await loadDiary();
    if (!result.ok) { setStatus(statusFrom(result)); return false; }
    setAuthority(result.state);
    setLegacyNotice(result.legacyChanged);
    setLegacyCheckFailed(result.legacyCheckFailed);
    if (result.state.pin === null || result.state.pin !== btoa(pin)) {
      setPinError(true);
      return false;
    }
    setEntries(result.state.entries);
    setUnlocked(true);
    setPinError(false);
    setStatus('ready');
    return true;
  }, []);

  const lock = useCallback(() => {
    setUnlocked(false);
    setEntries([]);
    setPinError(false);
  }, []);

  const verifyPin = useCallback(pin => authority?.pin !== null && authority?.pin === btoa(pin), [authority]);

  const changePin = useCallback(async (oldPin, newPin) => {
    const result = await changeDiaryPin(oldPin, newPin);
    if (result.ok) setAuthority(result.state);
    return result;
  }, []);

  const resetPin = useCallback(async () => {
    const result = await resetDiary();
    if (!result.ok) return result;
    setAuthority(result.state);
    setEntries([]);
    setUnlocked(false);
    setPinError(false);
    setLegacyNotice(result.legacyCleanupFailed);
    setStatus('ready');
    return result;
  }, []);

  const addEntry = useCallback(async data => {
    const entry = {
      id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
      date: todayStr(),
      createdAt: new Date().toISOString(),
      emoji: data.emoji || '😐',
      title: data.title || '',
      good: data.good || '',
      hard: data.hard || '',
      free: data.free || '',
    };
    const result = await addDiaryEntry(entry);
    if (!result.ok) return result;
    setAuthority(result.state);
    setEntries(result.state.entries);
    return { ok: true, entry };
  }, []);

  const deleteEntry = useCallback(async id => {
    const result = await deleteDiaryEntry(id);
    if (!result.ok) return result;
    setAuthority(result.state);
    setEntries(result.state.entries);
    return { ok: true, removed: result.removed };
  }, []);

  const streak = useMemo(() => streakInfo(entries), [entries]);
  const hasTodayEntry = useMemo(() => entries.some(entry => entry.date === todayStr()), [entries]);

  return {
    status, pinSet: Boolean(authority?.pin), unlocked, entries, pinError, legacyNotice, legacyCheckFailed,
    streak, hasTodayEntry, setupPin, tryUnlock, lock, verifyPin, changePin, resetPin, addEntry, deleteEntry,
  };
}
