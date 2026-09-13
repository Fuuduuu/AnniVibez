import { useEffect, useState } from 'react';
import { createEventRepository, EVENT_STORAGE_KEY } from './eventRepository';

export function useHouseholdEvents() {
  const [repository] = useState(() => {
    let storage;
    try { storage=window.localStorage; } catch { storage=null; }
    return createEventRepository(storage);
  });
  const [snapshot,setSnapshot] = useState(() => repository.load());
  useEffect(() => {
    const reload = event => {
      if(event.key === EVENT_STORAGE_KEY || event.key === null) setSnapshot(repository.load());
    };
    window.addEventListener('storage',reload);
    return () => window.removeEventListener('storage',reload);
  }, [repository]);
  const mutate = (method,...args) => {
    const next=repository[method](...args);
    setSnapshot(next);
    return next;
  };
  return {...snapshot,create:input=>mutate('create',input),
    importWaste:(...args)=>mutate('importWaste',...args),
    update:(...args)=>mutate('update',...args),remove:(...args)=>mutate('remove',...args)};
}
