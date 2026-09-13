import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createEvent, validateEvent } from '../../src/calendar/eventModel.js';
import { expandOccurrences, upcomingOccurrences } from '../../src/calendar/recurrence.js';
import { createEventRepository, EVENT_STORAGE_KEY } from '../../src/calendar/eventRepository.js';
import { addDays, addMonths, localDate, relativeDate, monthDays } from '../../src/calendar/dates.js';

const draft = {title:'Prügipäev',category:'waste',subtype:'mixed',date:'2026-09-14',time:'07:00'};
const make = (patch={}, id='e1') => createEvent({...draft,...patch}, id);
const weekly = () => make({recurrence:{frequency:'weekly',interval:1}});
const memory = initial => {
  const data = new Map(Object.entries(initial || {}));
  return {data,getItem:k=>data.get(k) ?? null,setItem:(k,v)=>data.set(k,v)};
};
const repo = storage => createEventRepository(storage, (()=>{let n=0;return ()=>`id${++n}`;})());
const dates = events => events.map(e=>e.date);

test('missing storage loads empty without writing; key is dedicated', () => {
  const storage=memory();
  assert.match(EVENT_STORAGE_KEY,/majamajandus/);
  assert.doesNotMatch(EVENT_STORAGE_KEY,/diary|sade/);
  assert.deepEqual(repo(storage).load().events,[]);
  assert.equal(storage.data.size,0);
});
test('storage save/reload is deterministic and preserves unrelated diary data and future fields', () => {
  const storage=memory({sade_diary_entries:'keep'});
  const r=repo(storage);
  const first=r.create({...draft,future:{flag:true}}).events[0];
  assert.equal(first.source,'manual');
  assert.equal(first.householdId,null);
  const before=storage.getItem(EVENT_STORAGE_KEY);
  r.update(first.id,{});
  assert.equal(storage.getItem(EVENT_STORAGE_KEY),before);
  assert.deepEqual(repo(storage).load().events[0].future,{flag:true});
  assert.equal(storage.getItem('sade_diary_entries'),'keep');
});
test('malformed and future-version storage are safe read-only fallbacks, never overwritten', () => {
  for (const raw of ['{oops','null','{}','[]',JSON.stringify({version:2,events:[]}),JSON.stringify({version:1,events:[{id:'bad'}]})]) {
    const storage=memory({[EVENT_STORAGE_KEY]:raw});
    const r=repo(storage); const loaded=r.load();
    assert.deepEqual(loaded.events,[]); assert.equal(loaded.writable,false); assert.ok(loaded.error);
    assert.throws(()=>r.create(draft));
    assert.equal(storage.getItem(EVENT_STORAGE_KEY),raw);
  }
});
test('create/edit/delete preserve stable IDs, source and future metadata', () => {
  const storage=memory(); const r=repo(storage);
  const event=r.create({...draft,source:'imported',householdId:'not-authorized'}).events[0];
  assert.equal(event.source,'manual'); assert.equal(event.householdId,null);
  const edited=r.update(event.id,{title:'Paber',subtype:'paper',date:'2026-09-15',notes:'Ukse juures'}).events[0];
  assert.equal(edited.id,event.id); assert.equal(edited.title,'Paber'); assert.equal(edited.date,'2026-09-15');
  assert.equal(edited.seriesId,null); assert.equal(edited.notes,'Ukse juures');
  assert.deepEqual(r.remove(event.id).events,[]);
});
test('categories/subtypes/time/date/rules validate and BUS is forbidden', () => {
  for(const category of ['maintenance','payment','general']) assert.equal(make({category,subtype:null}).subtype,null);
  for(const subtype of ['mixed','bio','paper','packaging','other']) assert.equal(make({subtype}).subtype,subtype);
  for(const patch of [{category:'bus'},{subtype:'unknown'},{date:'2026-02-30'},{time:'24:00'},{title:' '},
    {recurrence:{frequency:'weekly',interval:0}},{recurrence:{frequency:'daily',interval:1}}]) assert.throws(()=>make(patch));
  assert.equal(make({time:''}).time,null);
  assert.equal(validateEvent({...make(),source:'imported'}).source,'imported');
});
test('weekly and custom interval expansion is bounded with stable occurrence identity', () => {
  const e=weekly(); const before=JSON.stringify(e);
  const result=expandOccurrences([e],'2026-09-14','2026-10-05');
  assert.deepEqual(dates(result),['2026-09-14','2026-09-21','2026-09-28','2026-10-05']);
  assert.equal(new Set(result.map(x=>x.occurrenceId)).size,4);
  assert.ok(result.every(x=>x.seriesId===e.seriesId && x.eventId===e.id));
  assert.deepEqual(expandOccurrences([e],'2026-09-21','2026-09-21')[0],result[1]);
  assert.equal(JSON.stringify(e),before);
  assert.deepEqual(dates(expandOccurrences([make({recurrence:{frequency:'weekly',interval:2}})],'2026-09-14','2026-10-12')),
    ['2026-09-14','2026-09-28','2026-10-12']);
});
test('monthly clamps short months without drifting original day 31', () => {
  const e=make({date:'2026-01-31',recurrence:{frequency:'monthly',interval:1}});
  assert.deepEqual(dates(expandOccurrences([e],'2026-01-01','2026-04-30')),['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
});
test('yearly leap-day recurrence clamps February then returns to leap day', () => {
  const e=make({date:'2024-02-29',recurrence:{frequency:'yearly',interval:1}});
  assert.deepEqual(dates(expandOccurrences([e],'2025-01-01','2028-12-31')),['2025-02-28','2026-02-28','2027-02-28','2028-02-29']);
});
test('deleting one occurrence uses exclusion and leaves the rest intact', () => {
  const storage=memory();const r=repo(storage);const e=r.create(weekly()).events[0];
  const edited=r.remove(e.id,{scope:'occurrence',occurrenceDate:'2026-09-21'}).events[0];
  assert.deepEqual(edited.excludedDates,['2026-09-21']);
  assert.deepEqual(dates(expandOccurrences([edited],'2026-09-14','2026-09-28')),['2026-09-14','2026-09-28']);
  assert.equal(r.load().events.length,1);
});
test('deleting an entire series removes its source and all derived occurrences', () => {
  const r=repo(memory());const e=r.create(weekly()).events[0];
  assert.deepEqual(r.remove(e.id,{scope:'series'}).events,[]);
});
test('recurring mutations require explicit scope and a real occurrence', () => {
  const r=repo(memory());const e=r.create(weekly()).events[0];
  assert.throws(()=>r.remove(e.id)); assert.throws(()=>r.update(e.id,{title:'oops'}));
  assert.throws(()=>r.update(e.id,{title:'oops'},{scope:'occurrence',occurrenceDate:'2026-09-22'}));
});
test('editing one occurrence creates a small override, retains identity even when moved across ranges', () => {
  const r=repo(memory());const e=r.create(weekly()).events[0];
  const edited=r.update(e.id,{title:'Erand',date:'2026-10-02',time:'08:00'},
    {scope:'occurrence',occurrenceDate:'2026-09-21'}).events[0];
  assert.equal(edited.title,e.title); assert.equal(edited.date,e.date);
  assert.deepEqual(Object.keys(edited.overrides),['2026-09-21']);
  assert.equal(expandOccurrences([edited],'2026-09-21','2026-09-21').length,0);
  const moved=expandOccurrences([edited],'2026-10-02','2026-10-02')[0];
  assert.equal(moved.title,'Erand');assert.equal(moved.occurrenceDate,'2026-09-21');
  assert.equal(moved.occurrenceId,expandOccurrences([e],'2026-09-21','2026-09-21')[0].occurrenceId);
  assert.equal(r.load().events.length,1);
});
test('series edits preserve exceptions unless start date or rule changes, then explicitly reset them', () => {
  const r=repo(memory());const e=r.create(weekly()).events[0];
  r.remove(e.id,{scope:'occurrence',occurrenceDate:'2026-09-21'});
  let edited=r.update(e.id,{title:'Kõik'},{scope:'series'}).events[0];
  assert.deepEqual(edited.excludedDates,['2026-09-21']);assert.equal(edited.seriesId,e.seriesId);
  edited=r.update(e.id,{date:'2026-09-15'},{scope:'series'}).events[0];
  assert.deepEqual(edited.excludedDates,[]);assert.deepEqual(edited.overrides,{});
});
test('a title-only occurrence edit does not freeze unchanged date/time/category against later series edits', () => {
  const r=repo(memory());const e=r.create(weekly()).events[0];
  const day=expandOccurrences([e],'2026-09-21','2026-09-21')[0];
  let edited=r.update(e.id,{title:'Üks kord',date:day.date,time:day.time,category:day.category,subtype:day.subtype,notes:day.notes,reminder:day.reminder},
    {scope:'occurrence',occurrenceDate:'2026-09-21'}).events[0];
  assert.deepEqual(edited.overrides['2026-09-21'],{title:'Üks kord'});
  edited=r.update(e.id,{time:'11:00'},{scope:'series'}).events[0];
  assert.equal(expandOccurrences([edited],'2026-09-21','2026-09-21')[0].time,'11:00');
});
test('far-future valid dates do not overflow upcoming derivation or the month grid', () => {
  const e=make({date:'9999-12-31',recurrence:{frequency:'yearly',interval:1}});
  assert.equal(upcomingOccurrences([e],new Date(2026,8,14),5)[0].date,'9999-12-31');
  assert.equal(monthDays('9999-12-31').filter(Boolean).at(-1),'9999-12-31');
});
test('upcoming uses actual moved date/time, all-day first, excludes past timed events, ties stable', () => {
  const list=[make({date:'2026-09-15',time:'08:00'},'b'),make({time:'05:00'},'past'),
    make({time:null},'day'),make({time:'09:00'},'today'),make({date:'2036-09-14'},'future')];
  const result=upcomingOccurrences(list,new Date(2026,8,14,6,0),5);
  assert.deepEqual(result.map(e=>e.eventId),['day','today','b','future']);
  assert.deepEqual(upcomingOccurrences([],new Date(2026,8,14),5),[]);
});
test('long-lived series query does not materialize history or years in storage', () => {
  const r=repo(memory());const e=r.create(make({date:'2000-01-03',recurrence:{frequency:'weekly',interval:1}})).events[0];
  const result=expandOccurrences([e],'2026-09-01','2026-09-30');
  assert.equal(result.length,4);assert.equal(r.load().events.length,1);
});
test('storage write failures never publish unsaved events and concurrent operations read latest storage', () => {
  const storage=memory(); const a=repo(storage); let counter=0;
  const b=createEventRepository(storage,()=>`b${++counter}`);
  a.create(draft); b.create({...draft,title:'Teine'});
  assert.equal(a.load().events.length,2);
  storage.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>a.update('id1',{title:'Unsaved'}));
  assert.equal(a.load().events[0].title,draft.title);
});
test('local calendar helpers are deterministic across DST and never shift date-only values', () => {
  assert.equal(addDays('2026-03-28',2),'2026-03-30');
  assert.equal(addMonths('2026-01-31',1),'2026-02-28');
  assert.equal(relativeDate('2026-09-15','2026-09-14'),'homme');
  assert.equal(relativeDate('2026-09-14','2026-09-14'),'täna');
  assert.equal(monthDays('2026-09-14').length,42);
  for(const TZ of ['Europe/Tallinn','Pacific/Honolulu','Asia/Tokyo']) {
    const code=`import {localDate,addDays} from './src/calendar/dates.js';
      import {createEvent} from './src/calendar/eventModel.js';
      console.log(JSON.stringify([localDate(new Date(2026,8,14,0,1)),addDays('2026-09-14',1),
      createEvent(${JSON.stringify(draft)},'x').date]));`;
    const run=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('../../',import.meta.url),env:{...process.env,TZ},encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.deepEqual(JSON.parse(run.stdout),['2026-09-14','2026-09-15','2026-09-14']);
  }
});
