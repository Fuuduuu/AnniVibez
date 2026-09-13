import { useEffect } from 'react';
import { dueReminders, reminderStatus } from '../reminders/due';
import { formatDate } from '../calendar/dates';

export function ReminderRuntime({events,reminders}) {
  const {preferences,service,delivery}=reminders;
  useEffect(()=>{
    if(!preferences.systemEnabled || !preferences.writable) return;
    let active=true,running=false;
    const isCurrent=()=>active && document.visibilityState === 'visible';
    async function refresh() {
      const capability=service.getNotificationCapability();
      if(running || !isCurrent() || !capability.activeDelivery || capability.permission !== 'granted') return;
      running=true;
      try {
        const now=new Date();
        for(const item of dueReminders(events,now)) {
          if(!isCurrent()) break;
          const stillDue=()=>isCurrent() && reminderStatus(item,new Date()).state === 'due';
          await delivery.deliver(item,now,()=>service.showNotification({title:item.title,
            body:`${formatDate(item.date)}${item.time ? ` · ${item.time}` : ' · Kogu päev'}`,tag:item.reminderKey},stillDue),stillDue);
        }
      } finally {running=false;}
    }
    void refresh();
    const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[events,preferences.systemEnabled,preferences.writable,service,delivery]);
  return null;
}
