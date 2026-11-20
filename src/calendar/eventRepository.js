import { createEvent, validateEvent, EDIT_FIELDS } from './eventModel.js';
import { CATEGORY_IDENTITY_FIELDS, mergeCategoryIdentity } from './categoryModel.js';
import { matchesDate } from './recurrence.js';
import { dayNumber } from './dates.js';
import { reconcileWaste, validateImportHistory } from '../waste/reconcile.js';

export const EVENT_STORAGE_KEY = 'majamajandus_household_events_v1';
export const CALENDAR_EDIT_CONFLICT = 'CALENDAR_EDIT_CONFLICT';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
const equal = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const occurrenceBase = (event, date) => ({ ...event, date, excludedDates: [], overrides: {} });

export function getEventEditTarget(event, { scope, occurrenceDate }) {
  if (!event) return null;
  if (event.recurrence.frequency === 'none') return scope == null ? event : null;
  if (scope === 'series') return event;
  if (scope !== 'occurrence' || typeof occurrenceDate !== 'string'
    || !matchesDate(event, occurrenceDate) || event.excludedDates.includes(occurrenceDate)) return null;
  return mergeCategoryIdentity(occurrenceBase(event, occurrenceDate), event.overrides[occurrenceDate] ?? {});
}

function assertEditBaseline(current, patch, options) {
  const { baseline, scope } = options;
  const before = getEventEditTarget(baseline, options);
  const latest = getEventEditTarget(current, options);
  const conflict = () => Object.assign(new Error('Sündmus muutus vahepeal. Mustand on alles.'), {
    code: CALENDAR_EDIT_CONFLICT, current,
  });
  if (!before || !latest || current.id !== baseline.id || current.source !== baseline.source
    || current.seriesId !== baseline.seriesId) throw conflict();

  const fields = new Set(Object.keys(patch));
  if (CATEGORY_IDENTITY_FIELDS.some(key => fields.has(key))) CATEGORY_IDENTITY_FIELDS.forEach(key => fields.add(key));
  // Changing a series schedule also discards its exceptions. Protect those implicit writes.
  if (scope === 'series' && (fields.has('date') || fields.has('recurrence'))) {
    for (const key of ['date', 'recurrence', 'excludedDates', 'overrides']) fields.add(key);
  }
  if ([...fields].some(key => !equal(before[key], latest[key]))) throw conflict();
  return before;
}

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
  function target(event,options) {
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
        const current=events.find(event => event.id === id) ?? null;
        if(current?.source === 'imported' && Object.keys(patch).some(key=>!['reminder','notes'].includes(key))) {
          throw new Error('Imporditud sündmuse põhiväljad on allika hallata. Muuda ainult märkmeid või meeldetuletust.');
        }
        const opening = options.baseline ? assertEditBaseline(current, patch, options) : null;
        const event=target(current,options);
        const occurrence = event.recurrence.frequency !== 'none' && options.scope === 'occurrence';
        const previous = occurrence ? getEventEditTarget(event, options) : event;
        // A guarded save migrates a retained payment only if the editor opened on that category.
        const migratePayment = previous.source !== 'imported' && previous.category === 'payment'
          && (!opening || opening.category === 'payment') && !Object.hasOwn(patch, 'category');
        const input = migratePayment ? { ...patch, category: 'general' } : patch;
        let next;
        if (occurrence) {
          const base=occurrenceBase(event,options.occurrenceDate);
          const editable=Object.fromEntries(Object.entries(input).filter(([key])=>EDIT_FIELDS.includes(key)));
          const merged=validateEvent(mergeCategoryIdentity(previous,editable));
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
          next={...mergeCategoryIdentity(event,input),id:event.id,source:event.source,householdId:event.householdId,
            seriesId:rule.frequency === 'none' ? null : event.seriesId ?? `series:${event.id}`,
            excludedDates:reset ? [] : event.excludedDates,overrides:reset ? {} : event.overrides};
        }
        return events.map(e=>e.id === id ? next : e);
      });
    },
    remove(id,options={}) {
      return commit(events=>{
        const event=target(events.find(e=>e.id === id),options);
        if(event.recurrence.frequency === 'none' || options.scope === 'series') return events.filter(e=>e.id !== id);
        const overrides={...event.overrides};delete overrides[options.occurrenceDate];
        return events.map(e=>e.id === id ? {...event,overrides,excludedDates:[...event.excludedDates,options.occurrenceDate]} : e);
      });
    },
  };
}
