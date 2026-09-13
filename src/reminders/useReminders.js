import { useEffect, useState } from 'react';
import { createNotificationService } from './capability';
import { createDeliveryStore } from './delivery';
import { createReminderPreferences, PREFERENCES_KEY } from './preferences';

export function useReminders(notificationService) {
  const [services]=useState(()=>{
    let storage;try {storage=window.localStorage;} catch {storage=null;}
    return {service:notificationService ?? createNotificationService(),delivery:createDeliveryStore(storage,navigator.locks),repository:createReminderPreferences(storage)};
  });
  const [preferences,setPreferences]=useState(()=>services.repository.load());
  useEffect(()=>{
    const reload=event=>{if(event.key === PREFERENCES_KEY || event.key === null) setPreferences(services.repository.load());};
    window.addEventListener('storage',reload);return ()=>window.removeEventListener('storage',reload);
  },[services]);
  return {...services,preferences,save(patch) {const next=services.repository.save(patch);setPreferences(next);return next;}};
}
