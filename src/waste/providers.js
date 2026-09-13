import { dayNumber } from '../calendar/dates.js';
import { WASTE_SUBTYPES } from '../calendar/eventModel.js';

export const addressKey = address => address.trim().replace(/\s+/g,' ').toLocaleLowerCase('et-EE');
const text = (value,maximum=500) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

export function normalizeWasteResult(provider,address,response) {
  if(!text(address) || !text(provider?.id,100) || !text(provider?.name,100) || !Array.isArray(response?.entries)) throw Error('Vigane allika vastus.');
  const key=addressKey(address);
  const entries=new Map();
  for(const item of response.entries) {
    if(!item || !Object.hasOwn(WASTE_SUBTYPES,item.subtype) || !text(item.title,200)) throw Error('Vigane kogumispäev.');
    dayNumber(item.date);
    const time=item.time ?? null;
    if(time !== null && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw Error('Vigane kellaaeg.');
    const externalId=item.externalId ?? `derived:${JSON.stringify([provider.id,key,item.subtype,item.date])}`;
    if(!text(externalId,1500)) throw Error('Vigane allika ID.');
    const entry={externalId,date:item.date,subtype:item.subtype,title:item.title.trim(),time,provider:provider.id};
    if(entries.has(externalId) && JSON.stringify(entries.get(externalId)) !== JSON.stringify(entry)) throw Error('Vastuoluline allika ID.');
    entries.set(externalId,entry);
  }
  let range=null;
  if(response.range != null) {
    const {from,to,authoritative=false}=response.range;
    dayNumber(from);dayNumber(to);
    if(from > to || typeof authoritative !== 'boolean' || [...entries.values()].some(e=>e.date < from || e.date > to)) throw Error('Vigane impordivahemik.');
    range={from,to,authoritative};
  }
  return {status:entries.size ? 'SUPPORTED_WITH_RESULTS' : 'SUPPORTED_NO_RESULTS',
    provider:{id:provider.id,name:provider.name},address:address.trim(),addressKey:key,range,
    entries:[...entries.values()].sort((a,b)=>a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId))};
}

export function createWasteLookup(providers=[]) {
  return async function findWasteSchedule({address,signal}) {
    if(!text(address)) return {status:'UNSUPPORTED',entries:[]};
    try {
      for(const provider of providers) {
        if(await provider.supports(address.trim())) {
          const response=await provider.lookup({address:address.trim(),signal});
          return normalizeWasteResult(provider,address,response);
        }
      }
      return {status:'UNSUPPORTED',entries:[]};
    } catch {
      return {status:'ERROR',entries:[],message:'Graafiku otsimine ebaõnnestus. Proovi uuesti või lisa graafik käsitsi.'};
    }
  };
}

// Register only adapters backed by a verified real source. No demo data or address requests are sent.
export const findWasteSchedule = createWasteLookup();
