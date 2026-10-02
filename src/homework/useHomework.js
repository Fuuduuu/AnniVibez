import { useEffect, useState } from 'react';
import { createHomeworkRepository, HOMEWORK_KEY } from './repository.js';

export function useHomework() {
  const [repository] = useState(() => {
    let storage;
    try { storage = window.localStorage; } catch { /* The repository reports inaccessible storage. */ }
    return createHomeworkRepository(storage);
  });
  const [snapshot, setSnapshot] = useState(() => repository.load());
  useEffect(() => {
    const refresh = () => {
      const next = repository.load();
      setSnapshot(previous => next.writable ? next : { ...previous, writable: false, error: next.error });
    };
    const onStorage = event => { if (event.key === HOMEWORK_KEY || event.key === null) refresh(); };
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
    remove: id => change('remove', id), setCompleted: (id, completed) => change('setCompleted', id, completed) };
}
