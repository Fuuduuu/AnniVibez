import { useEffect, useState } from 'react';
import { createHouseholdRepository, HOUSEHOLD_KEY } from './householdRepository';

export function useHousehold() {
  const [repository]=useState(()=>{
    let storage;try {storage=window.localStorage;} catch {storage=null;}
    return createHouseholdRepository(storage);
  });
  const [snapshot,setSnapshot]=useState(()=>repository.load());
  useEffect(()=>{
    const reload=event=>{if(event.key === HOUSEHOLD_KEY || event.key === null) setSnapshot(repository.load());};
    window.addEventListener('storage',reload);
    return ()=>window.removeEventListener('storage',reload);
  },[repository]);
  return {...snapshot,save(patch) {const next=repository.save(patch);setSnapshot(next);return next;}};
}
