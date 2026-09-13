import { validateEvent } from '../calendar/eventModel.js';
import { normalizeWasteResult } from './providers.js';
import { dayNumber } from '../calendar/dates.js';

export const importKey = (provider,address) => JSON.stringify([provider,address]);

export function validateImportHistory(history) {
  if(history === undefined) return;
  if(!Array.isArray(history)) throw Error('Vigane impordiajalugu.');
  for(const batch of history) {
    if(!batch || !['key','provider','providerName','address','addressKey','lastSuccess'].every(key=>typeof batch[key] === 'string' && batch[key])
      || !Number.isFinite(Date.parse(batch.lastSuccess)) || !Number.isInteger(batch.returnedCount) || batch.returnedCount < 0
      || batch.key !== importKey(batch.provider,batch.addressKey)) throw Error('Vigane impordiajalugu.');
    if(batch.range != null) {
      dayNumber(batch.range.from);dayNumber(batch.range.to);
      if(batch.range.from > batch.range.to || typeof batch.range.authoritative !== 'boolean') throw Error('Vigane impordivahemik.');
    }
  }
}

export function reconcileWaste(events,result,now,newId) {
  if(!['SUPPORTED_WITH_RESULTS','SUPPORTED_NO_RESULTS'].includes(result?.status)) throw Error('Seda otsingut ei saa importida.');
  const batch=normalizeWasteResult(result.provider,result.address,result);
  const stamp=now.toISOString();
  const next=[...events];
  for(const entry of batch.entries) {
    const index=next.findIndex(e=>e.source === 'imported' && e.importMeta?.provider === batch.provider.id
      && e.importMeta.addressKey === batch.addressKey && e.importMeta.externalId === entry.externalId);
    const old=index >= 0 ? next[index] : null;
    const event=validateEvent({...old,id:old?.id ?? newId(),householdId:null,title:entry.title,category:'waste',subtype:entry.subtype,
      date:entry.date,time:entry.time,source:'imported',seriesId:null,recurrence:{frequency:'none',interval:1},
      excludedDates:[],overrides:{},reminder:old?.reminder ?? {daysBefore:0},notes:old?.notes ?? '',
      importMeta:{...old?.importMeta,provider:batch.provider.id,providerName:batch.provider.name,addressKey:batch.addressKey,
        address:batch.address,externalId:entry.externalId,importedAt:old?.importMeta.importedAt ?? stamp}});
    if(old) next[index]=event;
    else next.push(event);
  }
  // Omission is not cancellation. Retain absent entries, even for authoritative ranges, until a removal policy is approved.
  return {events:next,batch:{key:importKey(batch.provider.id,batch.addressKey),provider:batch.provider.id,
    providerName:batch.provider.name,address:batch.address,addressKey:batch.addressKey,lastSuccess:stamp,
    range:batch.range,returnedCount:batch.entries.length}};
}
