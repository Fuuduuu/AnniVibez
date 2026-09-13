export const PREFERENCES_KEY='majamajandus_reminder_preferences_v1';
const defaults={version:1,defaultDaysBefore:0,systemEnabled:false};
const valid=data=>data?.version === 1 && [0,1,3,7].includes(data.defaultDaysBefore) && typeof data.systemEnabled === 'boolean';

export const withReminderDefault=(input,preferences)=>({...input,reminder:input.reminder ?? {daysBefore:preferences.defaultDaysBefore}});

export function createReminderPreferences(storage) {
  function load() {
    try {
      const raw=storage.getItem(PREFERENCES_KEY);
      if(raw === null) return {...defaults,writable:true};
      const data=JSON.parse(raw);if(!valid(data)) throw Error('invalid');
      return {...data,writable:true};
    } catch {return {...defaults,writable:false,error:'Teavituste eelistusi ei saanud lugeda. Seadme teavitused jäävad välja lülitatuks.'};}
  }
  return {load,save(patch) {
    const current=load();if(!current.writable) throw Error(current.error);
    const {writable,...data}=current;
    const next={...data,...patch};if(!valid(next)) throw Error('Vigane meeldetuletuse eelistus.');
    try {storage.setItem(PREFERENCES_KEY,JSON.stringify(next));} catch {throw Error('Eelistuse salvestamine ebaõnnestus.');}
    return {...next,writable:true};
  }};
}
