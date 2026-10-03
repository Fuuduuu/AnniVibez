import { createEvent, validateEvent, EDIT_FIELDS } from './eventModel.js';
import { CATEGORY_IDENTITY_FIELDS, mergeCategoryIdentity } from './categoryModel.js';
import { matchesDate } from './recurrence.js';
import { dayNumber } from './dates.js';
import { reconcileWaste, validateImportHistory } from '../waste/reconcile.js';

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
      validateImportHistory(data.wasteImports);
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
    const changed=change(current.events,current);
    const {events:input,...metadata}=Array.isArray(changed) ? {events:changed} : changed;
    const events=input.map(validateEvent);
    if (new Set(events.map(e=>e.id)).size !== events.length) throw new Error('Sündmuse ID on juba kasutusel.');
    const {writable,error,...envelope}=current;
    const next={...envelope,...metadata,events};
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
    importWaste(result,now=new Date()) {
      return commit((events,current)=>{
        const next=reconcileWaste(events,result,now,newId);
        return {events:next.events,wasteImports:[...(current.wasteImports ?? []).filter(b=>b.key !== next.batch.key),next.batch]};
      });
    },
    update(id,patch,options={}) {
      return commit(events=>{
        const event=target(events,id,options);
        if(event.source === 'imported' && Object.keys(patch).some(key=>!['reminder','notes'].includes(key))) {
          throw new Error('Imporditud sündmuse põhiväljad on allika hallata. Muuda ainult märkmeid või meeldetuletust.');
        }
        let next;
        if(event.recurrence.frequency !== 'none' && options.scope === 'occurrence') {
          const base={...event,date:options.occurrenceDate,excludedDates:[],overrides:{}};
          const previous=mergeCategoryIdentity(base,event.overrides[options.occurrenceDate] ?? {});
          const input=Object.fromEntries(Object.entries(patch).filter(([key])=>EDIT_FIELDS.includes(key)));
          if(previous.category === 'payment' && !Object.hasOwn(input,'category')) input.category='general';
          const merged=validateEvent(mergeCategoryIdentity(previous,input));
          const changes=Object.fromEntries(EDIT_FIELDS.filter(key=>JSON.stringify(stable(merged[key])) !== JSON.stringify(stable(base[key])))
            .map(key=>[key,merged[key]]));
          // An occurrence owns the entire category snapshot; title-only edits keep inheriting the series.
          if(CATEGORY_IDENTITY_FIELDS.some(key=>Object.hasOwn(changes,key))) {
            for(const key of CATEGORY_IDENTITY_FIELDS) changes[key]=merged[key] ?? null;
          }
          const overrides={...event.overrides};
          if(Object.keys(changes).length) overrides[options.occurrenceDate]=changes;
          else delete overrides[options.occurrenceDate];
          next={...event,overrides};
        } else {
          const rule=patch.recurrence ?? event.recurrence;
          const reset=(patch.date && patch.date !== event.date) || JSON.stringify(stable(rule)) !== JSON.stringify(stable(event.recurrence));
          const input=event.category === 'payment' && !Object.hasOwn(patch,'category') ? {...patch,category:'general'} : patch;
          next={...mergeCategoryIdentity(event,input),id:event.id,source:event.source,householdId:event.householdId,
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
