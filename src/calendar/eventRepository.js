import { createEvent, validateEvent, EDIT_FIELDS } from './eventModel.js';
import { matchesDate } from './recurrence.js';
import { dayNumber } from './dates.js';

export const EVENT_STORAGE_KEY = 'majamajandus_household_events_v1';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;

export function createEventRepository(storage, newId = () => crypto.randomUUID()) {
  function read() {
    try {
      if (!storage) throw new Error('Salvestusruum pole saadaval.');
      const raw=storage.getItem(EVENT_STORAGE_KEY);
      if(raw === null) return {version:1,events:[],writable:true,error:null};
      const data=JSON.parse(raw);
      if(!data || data.version !== 1 || !Array.isArray(data.events)) throw new Error('Tundmatu või vigane kalendri salvestus.');
      const events=data.events.map(validateEvent);
      if (new Set(events.map(e=>e.id)).size !== events.length) throw new Error('Korduvad sündmuse ID-d.');
      return {...data,events,writable:true,error:null};
    } catch {
      return {events:[],writable:false,error:'Kalendri andmeid ei saanud lugeda. Salvestust ei kirjutata üle.'};
    }
  }
  function commit(change) {
    const current=read();
    if(!current.writable) throw new Error(current.error);
    const events=change(current.events).map(validateEvent);
    if (new Set(events.map(e=>e.id)).size !== events.length) throw new Error('Sündmuse ID on juba kasutusel.');
    const {writable,error,...envelope}=current;
    const next={...envelope,events};
    try { storage.setItem(EVENT_STORAGE_KEY,JSON.stringify(stable(next))); }
    catch { throw new Error('Salvestamine ebaõnnestus. Kontrolli seadme salvestusruumi ja proovi uuesti.'); }
    return {...next,writable:true,error:null};
  }
  function target(events,id,options) {
    const event=events.find(e=>e.id === id);
    if(!event) throw new Error('Sündmust ei leitud. Ava kalender uuesti.');
    if(event.recurrence.frequency !== 'none') {
      if(!['occurrence','series'].includes(options.scope)) throw new Error('Vali üksikkord või kogu sari.');
      if(options.scope === 'occurrence') {
        dayNumber(options.occurrenceDate);
        if(!matchesDate(event,options.occurrenceDate) || event.excludedDates.includes(options.occurrenceDate)) throw new Error('Seda üksikkorda ei leitud.');
      }
    }
    return event;
  }
  return {
    load:read,
    create:input=>commit(events=>[...events,createEvent(input,newId())]),
    update(id,patch,options={}) {
      return commit(events=>{
        const event=target(events,id,options);
        let next;
        if(event.recurrence.frequency !== 'none' && options.scope === 'occurrence') {
          const base={...event,date:options.occurrenceDate,excludedDates:[],overrides:{}};
          const input=Object.fromEntries(Object.entries(patch).filter(([key])=>EDIT_FIELDS.includes(key)));
          const merged=validateEvent({...base,...event.overrides[options.occurrenceDate],...input});
          const changes=Object.fromEntries(EDIT_FIELDS.filter(key=>JSON.stringify(stable(merged[key])) !== JSON.stringify(stable(base[key])))
            .map(key=>[key,merged[key]]));
          // Category and subtype form one identity; title-only overrides must not freeze other series fields.
          if(Object.hasOwn(changes,'category') || Object.hasOwn(changes,'subtype')) {
            changes.category=merged.category;changes.subtype=merged.subtype;
          }
          const overrides={...event.overrides};
          if(Object.keys(changes).length) overrides[options.occurrenceDate]=changes;
          else delete overrides[options.occurrenceDate];
          next={...event,overrides};
        } else {
          const rule=patch.recurrence ?? event.recurrence;
          const reset=(patch.date && patch.date !== event.date) || JSON.stringify(stable(rule)) !== JSON.stringify(stable(event.recurrence));
          next={...event,...patch,id:event.id,source:event.source,householdId:event.householdId,
            seriesId:rule.frequency === 'none' ? null : event.seriesId ?? `series:${event.id}`,
            excludedDates:reset ? [] : event.excludedDates,overrides:reset ? {} : event.overrides};
        }
        return events.map(e=>e.id === id ? next : e);
      });
    },
    remove(id,options={}) {
      return commit(events=>{
        const event=target(events,id,options);
        if(event.recurrence.frequency === 'none' || options.scope === 'series') return events.filter(e=>e.id !== id);
        const overrides={...event.overrides};delete overrides[options.occurrenceDate];
        return events.map(e=>e.id === id ? {...event,overrides,excludedDates:[...event.excludedDates,options.occurrenceDate]} : e);
      });
    },
  };
}
