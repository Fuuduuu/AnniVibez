import { addDays, dayNumber, localDate } from '../calendar/dates.js';

export const DELIVERY_KEY='majamajandus_reminder_delivery_v1';
const LOCK='majamajandus-reminder-delivery';

export function createDeliveryStore(storage,locks) {
  function load() {
    try {
      const raw=storage.getItem(DELIVERY_KEY);
      if(raw === null) return {version:1,records:{},writable:true};
      const data=JSON.parse(raw);
      if(data?.version !== 1 || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)) throw Error('invalid');
      for(const record of Object.values(data.records)) {
        if(!record || !['pending','delivered'].includes(record.state)) throw Error('invalid');
        dayNumber(record.expiresOn);
      }
      return {...data,writable:true};
    } catch {return {records:{},writable:false};}
  }
  const pruneRecords=(records,now)=>Object.fromEntries(Object.entries(records).filter(([,record])=>record.expiresOn > localDate(now)));
  function save(data,records) {
    const {writable,...envelope}=data;
    storage.setItem(DELIVERY_KEY,JSON.stringify({...envelope,records}));
  }
  return {load,
    prune(now) {
      const data=load();if(!data.writable) return;
      save(data,pruneRecords(data.records,now));
    },
    async deliver(item,now,show,isCurrent=()=>true) {
      if(!locks?.request || !isCurrent()) return {status:'unavailable'};
      try {
        return await locks.request(LOCK,async()=>{
          if(!isCurrent()) return {status:'cancelled'};
          const data=load();if(!data.writable) return {status:'storage-unavailable'};
          const records=pruneRecords(data.records,now);
          if(Object.hasOwn(records,item.reminderKey)) return {status:'duplicate'};
          // Persist a reservation BEFORE calling the platform. An interrupted attempt stays reserved to prevent repeat alerts.
          records[item.reminderKey]={state:'pending',expiresOn:addDays(item.date,1)};
          save(data,records);
          const result=isCurrent() ? await show() : {status:'cancelled'};
          if(result.status === 'shown') records[item.reminderKey].state='delivered';
          else delete records[item.reminderKey];
          save(data,records);
          return result;
        });
      } catch {return {status:'error'};}
    },
  };
}
