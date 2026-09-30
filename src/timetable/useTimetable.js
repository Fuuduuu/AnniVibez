import { useEffect, useState } from 'react';
import { createTimetableRepository, TIMETABLE_KEY } from './repository.js';

export function useTimetable() {
  const [repository] = useState(() => {
    let storage;
    try { storage = window.localStorage; } catch { /* The repository exposes a truthful read-only error. */ }
    return createTimetableRepository(storage);
  });
  const [snapshot, setSnapshot] = useState(() => repository.load());
  useEffect(() => {
    const refresh = () => {
      const next = repository.load();
      setSnapshot(previous => next.writable ? next : { ...previous, writable: false, error: next.error });
    };
    const onStorage = event => { if (event.key === TIMETABLE_KEY || event.key === null) refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [repository]);
  const change = (action, ...args) => {
    const next = repository[action](...args);
    setSnapshot(next);
    return next;
  };
  return { ...snapshot, create: input => change('create', input), update: (id, patch) => change('update', id, patch),
    remove: id => change('remove', id), saveStudent: input => change('saveStudent', input) };
}
