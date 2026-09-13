import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWasteLookup, normalizeWasteResult, addressKey } from '../../src/waste/providers.js';
import { createHouseholdRepository, HOUSEHOLD_KEY } from '../../src/waste/householdRepository.js';
import { createEventRepository, EVENT_STORAGE_KEY } from '../../src/calendar/eventRepository.js';
import { expandOccurrences, upcomingOccurrences } from '../../src/calendar/recurrence.js';

const provider={id:'fixture',name:'Test source'};
const address='Testi 1, Rakvere';
const row={externalId:'source-1',date:'2026-09-14',subtype:'bio',title:'Biojäätmed'};
const now=new Date('2026-09-13T12:00:00Z');
const batch=(entries=[row],extra={})=>normalizeWasteResult(provider,address,{entries,...extra});
const memory=()=>{const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
const repository=storage=>{let n=0;return createEventRepository(storage,()=>`event-${++n}`);};
const manual={title:'Minu bio',category:'waste',subtype:'bio',date:'2026-09-14',recurrence:{frequency:'weekly',interval:2}};

test('production boundary is truthfully unsupported, including an absent address',async()=>{
  const find=createWasteLookup();
  assert.equal((await find({address})).status,'UNSUPPORTED');
  assert.equal((await find({address:''})).status,'UNSUPPORTED');
});
test('supported adapter normalizes before exposing entries, retaining real source identity',async()=>{
  const find=createWasteLookup([{...provider,supports:()=>true,lookup:async()=>({entries:[{...row,secret:'discard'}]})}]);
  const result=await find({address});
  assert.equal(result.status,'SUPPORTED_WITH_RESULTS');
  assert.deepEqual(result.entries,[{...row,time:null,provider:'fixture'}]);
  assert.equal(result.addressKey,addressKey(address));
});
test('unsupported source is not queried and a supported empty response differs from unsupported',async()=>{
  const find=createWasteLookup([{...provider,supports:()=>false,lookup:()=>assert.fail('must not query')}]);
  assert.equal((await find({address})).status,'UNSUPPORTED');
  assert.equal(batch([]).status,'SUPPORTED_NO_RESULTS');
});
test('provider error and malformed response are sanitized ERROR results',async()=>{
  for(const lookup of [async()=>{throw Error('private token');},async()=>({entries:[{...row,date:'2026-02-31'}]})]) {
    const result=await createWasteLookup([{...provider,supports:()=>true,lookup}])({address});
    assert.equal(result.status,'ERROR');assert.ok(!JSON.stringify(result).includes('private token'));
  }
});
test('derived identity is deterministic, address-scoped and never replaces a source ID',()=>{
  const noId={...row};delete noId.externalId;
  const a=batch([noId]);assert.deepEqual(a,batch([noId]));
  assert.notEqual(a.entries[0].externalId,normalizeWasteResult(provider,'Teine 2',{entries:[noId]}).entries[0].externalId);
  assert.equal(batch().entries[0].externalId,'source-1');
  assert.equal(addressKey('  TESTI   1, Rakvere  '),addressKey(address));
});
test('invalid taxonomy/time, conflicting identities and invalid ranges fail closed',()=>{
  for(const entries of [[{...row,subtype:'bus'}],[{...row,time:'25:00'}],[row,{...row,date:'2026-09-15'}]]) assert.throws(()=>batch(entries));
  assert.throws(()=>batch([row],{range:{from:'2026-10-01',to:'2026-09-01',authoritative:true}}));
  assert.throws(()=>batch([row],{range:{from:'2026-10-01',to:'2026-10-31',authoritative:true}}));
});
test('first import creates concrete imported household events with provenance in the existing store',()=>{
  const storage=memory(),r=repository(storage), result=r.importWaste(batch(),now);
  const event=result.events[0];
  assert.equal(event.source,'imported');assert.equal(event.category,'waste');assert.equal(event.householdId,null);
  assert.equal(event.seriesId,null);assert.equal(event.recurrence.frequency,'none');
  assert.equal(event.importMeta.provider,'fixture');assert.equal(event.importMeta.externalId,'source-1');
  assert.equal(event.importMeta.importedAt,now.toISOString());
  assert.deepEqual([...storage.data.keys()],[EVENT_STORAGE_KEY]);
  assert.equal(result.wasteImports[0].lastSuccess,now.toISOString());
});
test('identical refresh is byte-identical with a frozen timestamp and never duplicates',()=>{
  const storage=memory(),r=repository(storage);
  r.importWaste(batch(),now);const first=storage.getItem(EVENT_STORAGE_KEY);
  r.importWaste(batch(),now);assert.equal(storage.getItem(EVENT_STORAGE_KEY),first);
  assert.equal(r.load().events.length,1);
});
test('changed source date/type/title updates the same event ID; new source occurrence is added',()=>{
  const r=repository(memory()),old=r.importWaste(batch(),now).events[0];
  const result=r.importWaste(batch([{...row,date:'2026-09-15',subtype:'paper',title:'Paber'}, {...row,externalId:'new'}]),now);
  assert.equal(result.events.length,2);const updated=result.events.find(e=>e.id===old.id);
  assert.equal(updated.date,'2026-09-15');assert.equal(updated.title,'Paber');assert.equal(updated.subtype,'paper');
});
test('manual events are never overwritten even with colliding external metadata',()=>{
  const r=repository(memory());const own=r.create({...manual,importMeta:{provider:'fixture',externalId:'source-1',addressKey:addressKey(address)}}).events[0];
  r.importWaste(batch(),now);assert.deepEqual(r.load().events.find(e=>e.id===own.id),own);
  assert.equal(r.load().events.length,2);
});
test('absent results never delete manual or imported events, including authoritative empty ranges',()=>{
  const r=repository(memory());r.create(manual);r.importWaste(batch(),now);
  const before=r.load().events;
  r.importWaste(batch([],{range:{from:'2026-09-01',to:'2026-09-30',authoritative:true}}),now);
  assert.deepEqual(r.load().events,before);
});
test('user reminder and notes survive refresh while source fields remain refreshable',()=>{
  const r=repository(memory());const event=r.importWaste(batch(),now).events[0];
  r.update(event.id,{reminder:{daysBefore:3},notes:'Värav lahti'});
  const updated=r.importWaste(batch([{...row,date:'2026-09-15'}]),new Date('2026-09-14T12:00:00Z')).events[0];
  assert.deepEqual(updated.reminder,{daysBefore:3});assert.equal(updated.notes,'Värav lahti');
  assert.equal(updated.importMeta.importedAt,now.toISOString());assert.equal(updated.date,'2026-09-15');
});
test('imported source fields cannot be silently user-rewritten; deletion remains an explicit local action',()=>{
  const r=repository(memory()),event=r.importWaste(batch(),now).events[0];
  assert.throws(()=>r.update(event.id,{date:'2026-09-20'}),/allika/);
  assert.throws(()=>r.update(event.id,{category:'general'}),/allika/);
  r.remove(event.id);assert.equal(r.load().events.length,0);
  r.importWaste(batch(),now);assert.equal(r.load().events.length,1);
});
test('same external ID at a different provider or address cannot overwrite another household import',()=>{
  const r=repository(memory());r.importWaste(batch(),now);
  r.importWaste(normalizeWasteResult(provider,'Teine 2',{entries:[row]}),now);
  r.importWaste(normalizeWasteResult({id:'other',name:'Other'},address,{entries:[row]}),now);
  assert.equal(r.load().events.length,3);assert.equal(r.load().wasteImports.length,3);
});
test('unsupported/error batches cannot write events or last-success metadata',()=>{
  const storage=memory(),r=repository(storage);
  for(const status of ['ERROR','UNSUPPORTED']) assert.throws(()=>r.importWaste({status},now));
  assert.equal(storage.data.size,0);
});
test('failed import writes remain atomic and do not publish partial events',()=>{
  const storage=memory(),r=repository(storage);r.create(manual);const before=storage.getItem(EVENT_STORAGE_KEY);
  storage.setItem=()=>{throw Error('quota');};assert.throws(()=>r.importWaste(batch(),now),/Salvestamine/);
  assert.equal(storage.getItem(EVENT_STORAGE_KEY),before);
});
test('malformed import history fails safely before UI can format invalid ranges',()=>{
  for(const wasteImports of [{},[null],[{key:'x',provider:'fixture',providerName:'Test',address,addressKey:addressKey(address),lastSuccess:now.toISOString(),range:{from:'bad',to:'bad'}}]]) {
    const storage=memory();const raw=JSON.stringify({version:1,events:[],wasteImports});storage.setItem(EVENT_STORAGE_KEY,raw);
    const r=repository(storage);assert.equal(r.load().writable,false);
    assert.throws(()=>r.importWaste(batch(),now));assert.equal(storage.getItem(EVENT_STORAGE_KEY),raw);
  }
});
test('manual waste schedule uses existing every-N-weeks engine',()=>{
  const r=repository(memory()),events=r.create(manual).events;
  assert.equal(events[0].source,'manual');
  assert.deepEqual(expandOccurrences(events,'2026-09-01','2026-10-31').map(e=>e.date),['2026-09-14','2026-09-28','2026-10-12','2026-10-26']);
});
test('manual waste schedule edit and whole-series delete use existing repository operations',()=>{
  const r=repository(memory()),event=r.create(manual).events[0];
  r.update(event.id,{title:'Paber',subtype:'paper',recurrence:{frequency:'monthly',interval:2}},{scope:'series'});
  assert.deepEqual(expandOccurrences(r.load().events,'2026-09-01','2026-12-31').map(e=>e.date),['2026-09-14','2026-11-14']);
  r.remove(event.id,{scope:'series'});assert.equal(r.load().events.length,0);
});
test('imported/manual waste joins ordinary calendar expansion and Home upcoming sorting',()=>{
  const r=repository(memory());r.create(manual);r.importWaste(batch([{...row,date:'2026-09-15'}]),now);
  assert.equal(expandOccurrences(r.load().events,'2026-09-14','2026-09-15').length,2);
  assert.deepEqual(upcomingOccurrences(r.load().events,new Date(2026,8,13,12),2).map(e=>e.source),['manual','imported']);
});
test('household address/name persist under a distinct key without touching events or diary',()=>{
  const storage=memory();storage.setItem('sade_diary_pin','keep');
  const r=createHouseholdRepository(storage);assert.equal(r.load().profile.address,'');assert.equal(storage.data.size,1);
  r.save({name:'Kodu',address:' Testi 1, Rakvere '});
  assert.deepEqual(createHouseholdRepository(storage).load().profile,{name:'Kodu',address});
  assert.equal(storage.getItem('sade_diary_pin'),'keep');assert.notEqual(HOUSEHOLD_KEY,EVENT_STORAGE_KEY);
});
test('malformed or future household storage is read-only and is never overwritten',()=>{
  for(const raw of ['{bad','{"version":2,"profile":{}}','{"version":1,"profile":{"address":4}}']) {
    const storage=memory();storage.setItem(HOUSEHOLD_KEY,raw);const r=createHouseholdRepository(storage);
    assert.equal(r.load().writable,false);assert.throws(()=>r.save({name:'Kodu',address}));assert.equal(storage.getItem(HOUSEHOLD_KEY),raw);
  }
});
test('household profile preserves future fields and reports failed saves',()=>{
  const storage=memory();storage.setItem(HOUSEHOLD_KEY,JSON.stringify({version:1,future:2,profile:{name:'Kodu',address,future:3}}));
  const r=createHouseholdRepository(storage);r.save({name:'Uus',address});
  assert.equal(r.load().profile.future,3);assert.equal(JSON.parse(storage.getItem(HOUSEHOLD_KEY)).future,2);
  storage.setItem=()=>{throw Error('quota');};assert.throws(()=>r.save({name:'Ei',address}),/Salvestamine/);
});
