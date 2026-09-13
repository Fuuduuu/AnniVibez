import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { reminderStatus, dueReminders, homeOccurrences } from '../../src/reminders/due.js';
import { createNotificationService } from '../../src/reminders/capability.js';
import { createDeliveryStore, DELIVERY_KEY } from '../../src/reminders/delivery.js';
import { createReminderPreferences, PREFERENCES_KEY, withReminderDefault } from '../../src/reminders/preferences.js';
import { createEvent } from '../../src/calendar/eventModel.js';
import { createEventRepository, EVENT_STORAGE_KEY } from '../../src/calendar/eventRepository.js';
import { createHouseholdRepository, HOUSEHOLD_KEY } from '../../src/waste/householdRepository.js';
import { normalizeWasteResult } from '../../src/waste/providers.js';

const make=(patch={})=>createEvent({title:'Hooldus',category:'maintenance',date:'2026-09-14',time:'07:00',reminder:{daysBefore:1},...patch},'one');
const now=new Date(2026,8,13,7);
const memory=()=>{const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
const locks=()=>{let queue=Promise.resolve();return {request:(_name,fn)=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;}};};
const environment=(permission='default')=>{
  const calls={request:0,shown:0};
  const env={isSecureContext:true,document:{visibilityState:'visible'},navigator:{locks:locks(),serviceWorker:{getRegistration:async()=>({active:{},showNotification:async()=>{calls.shown++;}})}},
    Notification:{permission,requestPermission:async()=>{calls.request++;env.Notification.permission='granted';return 'granted';}}};
  return {env,calls,service:createNotificationService(env)};
};
for(const days of [1,3,7]) test(`${days}-day reminder becomes due at the exact local event time`,()=>{
  const e=make({reminder:{daysBefore:days}}),time=new Date(2026,8,14-days,7);
  assert.equal(reminderStatus(e,time).state,'due');
  assert.equal(reminderStatus(e,new Date(time.getTime()-60000)).state,'future');
  assert.equal(reminderStatus(e,time).dueDate,`2026-09-${String(14-days).padStart(2,'0')}`);
});
test('none and absent legacy reminder never become due',()=>{
  assert.equal(reminderStatus(make({reminder:{daysBefore:0}}),now).state,'none');
  const old=make();delete old.reminder;assert.equal(reminderStatus(old,now).state,'none');
});
test('date-only reminder is due at 09:00 local, never midnight',()=>{
  const e=make({time:null});assert.equal(reminderStatus(e,new Date(2026,8,13,8,59)).state,'future');
  assert.equal(reminderStatus(e,new Date(2026,8,13,9)).state,'due');
  assert.equal(reminderStatus(e,now).dueTime,'09:00');
});
test('due identities distinguish recurring dates, changed offsets and moved overrides',()=>{
  const e=make({recurrence:{frequency:'weekly',interval:1}});
  const first=dueReminders([e],now)[0],second=dueReminders([e],new Date(2026,8,20,7))[0];
  assert.notEqual(first.reminderKey,second.reminderKey);
  assert.notEqual(first.reminderKey,dueReminders([make({reminder:{daysBefore:3}})],now)[0].reminderKey);
  e.overrides={'2026-09-14':{date:'2026-09-15',time:'08:00'}};
  assert.equal(dueReminders([e],now).length,0);
  const moved=dueReminders([e],new Date(2026,8,14,8))[0];
  assert.equal(moved.occurrenceDate,'2026-09-14');assert.notEqual(moved.reminderKey,first.reminderKey);
});
test('excluded occurrences produce no reminder',()=>{
  const e=make({recurrence:{frequency:'weekly',interval:1}});e.excludedDates=['2026-09-14'];
  assert.equal(dueReminders([e],now).length,0);
});
test('expired timed events are not notified but remain softly overdue on Home for that day',()=>{
  const e=make(),after=new Date(2026,8,14,8);
  assert.equal(dueReminders([e],after).length,0);
  assert.equal(reminderStatus(e,after).state,'overdue');
  assert.equal(homeOccurrences([e],after)[0].id,'one');
  assert.equal(homeOccurrences([e],new Date(2026,8,15,8)).length,0);
});
test('waste/imported events use the same due query and none does not inherit defaults',()=>{
  const e=make({category:'waste',subtype:'paper'});e.source='imported';
  assert.equal(dueReminders([e],now).length,1);
  assert.equal(dueReminders([make({reminder:{daysBefore:0}})],now).length,0);
});
test('local date calculation is stable across timezones and DST',()=>{
  for(const TZ of ['Europe/Tallinn','Pacific/Honolulu','Asia/Tokyo']) {
    const result=spawnSync(process.execPath,['--input-type=module','-e',`
      import {reminderStatus} from './src/reminders/due.js';
      const status=reminderStatus({id:'x',date:'2026-10-26',time:'07:00',reminder:{daysBefore:1}},new Date(2026,9,25,7));
      if(status.state!=='due'||status.dueDate!=='2026-10-25'||status.dueTime!=='07:00')process.exit(1);
    `],{cwd:new URL('../../',import.meta.url),env:{...process.env,TZ},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
});
test('unsupported/insecure runtime exposes no fake future scheduling capability',()=>{
  for(const env of [{},{isSecureContext:false,Notification:{}}]) {
    const cap=createNotificationService(env).getNotificationCapability();
    assert.equal(cap.permission,'unsupported');assert.equal(cap.exactScheduling,false);assert.equal(cap.backgroundGuaranteed,false);
  }
});
for(const permission of ['default','granted','denied']) test(`capability represents permission ${permission} without prompting`,()=>{
  const {service,calls}=environment(permission);assert.equal(service.getNotificationCapability().permission,permission);assert.equal(calls.request,0);
});
test('permission requires explicit user action, denied permission is not requested again',async()=>{
  const {service,calls}=environment();await service.requestNotificationPermission();assert.equal(calls.request,0);
  assert.equal((await service.requestNotificationPermission({userInitiated:true})).permission,'granted');assert.equal(calls.request,1);
  const denied=environment('denied');await denied.service.requestNotificationPermission({userInitiated:true});assert.equal(denied.calls.request,0);
});
test('no permission or hidden page cannot show system notification',async()=>{
  for(const state of ['default','denied']) {
    const {service,calls}=environment(state);assert.notEqual((await service.showNotification({title:'x'})).status,'shown');assert.equal(calls.shown,0);
  }
  const {env,service,calls}=environment('granted');env.document.visibilityState='hidden';
  await service.showNotification({title:'x'});assert.equal(calls.shown,0);
});
test('show uses active existing service worker and reports unavailable/error honestly',async()=>{
  const {env,service,calls}=environment('granted');assert.equal((await service.showNotification({title:'x',tag:'one'})).status,'shown');assert.equal(calls.shown,1);
  env.navigator.serviceWorker.getRegistration=async()=>undefined;
  assert.equal((await service.showNotification({title:'x'})).status,'unavailable');
  env.navigator.serviceWorker.getRegistration=async()=>{throw Error('blocked');};
  assert.equal((await service.showNotification({title:'x'})).status,'error');
});
test('visibility/permission are rechecked after awaiting service worker registration',async()=>{
  const {env,service,calls}=environment('granted');env.navigator.serviceWorker.getRegistration=async()=>{env.Notification.permission='denied';return {active:{},showNotification:async()=>calls.shown++};};
  assert.notEqual((await service.showNotification({title:'x'})).status,'shown');assert.equal(calls.shown,0);
});
test('an expired or cancelled reminder cannot be sent after service-worker readiness was awaited',async()=>{
  const {env,service,calls}=environment('granted');let current=true;
  env.navigator.serviceWorker.getRegistration=async()=>{current=false;return {active:{},showNotification:async()=>calls.shown++};};
  assert.equal((await service.showNotification({title:'x'},()=>current)).status,'blocked');assert.equal(calls.shown,0);
});
test('first delivery succeeds, repeated render/reload/concurrent calls do not duplicate',async()=>{
  const storage=memory(),mutex=locks(),a=createDeliveryStore(storage,mutex),b=createDeliveryStore(storage,mutex),item=dueReminders([make()],now)[0];
  let shown=0;const show=async()=>{shown++;return {status:'shown'};};
  await Promise.all([a.deliver(item,now,show),b.deliver(item,now,show)]);
  await createDeliveryStore(storage,mutex).deliver(item,now,show);assert.equal(shown,1);
  assert.equal([...storage.data.keys()][0],DELIVERY_KEY);
});
test('different occurrence and reminder offset remain separately deliverable',async()=>{
  const store=createDeliveryStore(memory(),locks());let shown=0;const show=async()=>{shown++;return {status:'shown'};};
  for(const e of [make(),make({reminder:{daysBefore:3}}),make({date:'2026-09-15',reminder:{daysBefore:3}})]) await store.deliver(dueReminders([e],now)[0],now,show);
  assert.equal(shown,3);
});
test('pruning expires only records whose event day ended; event data is never mutated',async()=>{
  const storage=memory(),store=createDeliveryStore(storage,locks());storage.setItem(EVENT_STORAGE_KEY,'preserve');
  await store.deliver(dueReminders([make()],now)[0],now,async()=>({status:'shown'}));
  store.prune(new Date(2026,8,14,23));assert.equal(Object.keys(store.load().records).length,1);
  store.prune(new Date(2026,8,15,0));assert.equal(Object.keys(store.load().records).length,0);
  assert.equal(storage.getItem(EVENT_STORAGE_KEY),'preserve');
});
test('malformed delivery storage and write failures fail closed without notifications or data wipes',async()=>{
  const storage=memory();storage.setItem(DELIVERY_KEY,'{broken');const store=createDeliveryStore(storage,locks());
  assert.equal(store.load().writable,false);let shown=0;
  await store.deliver(dueReminders([make()],now)[0],now,async()=>{shown++;return {status:'shown'};});
  assert.equal(shown,0);assert.equal(storage.getItem(DELIVERY_KEY),'{broken');
  const quota=memory();quota.setItem=()=>{throw Error('quota');};
  await createDeliveryStore(quota,locks()).deliver(dueReminders([make()],now)[0],now,async()=>{shown++;});assert.equal(shown,0);
});
test('failed notification may retry, interrupted/pending delivery never loops on reload',async()=>{
  const storage=memory(),store=createDeliveryStore(storage,locks()),item=dueReminders([make()],now)[0];
  await store.deliver(item,now,async()=>({status:'error'}));assert.equal(Object.keys(store.load().records).length,0);
  let shown=0;await store.deliver(item,now,async()=>{shown++;storage.setItem=()=>{throw Error('quota');};return {status:'shown'};});
  await createDeliveryStore(storage,locks()).deliver(item,now,async()=>{shown++;});assert.equal(shown,1);
});
test('without a cross-tab lock or a current lifecycle automatic delivery is unavailable',async()=>{
  let shown=0;const item=dueReminders([make()],now)[0],show=async()=>{shown++;return {status:'shown'};};
  await createDeliveryStore(memory(),null).deliver(item,now,show);
  await createDeliveryStore(memory(),locks()).deliver(item,now,show,()=>false);assert.equal(shown,0);
});
test('new-event default applies only when no per-event reminder has been chosen',()=>{
  const prefs={defaultDaysBefore:3};assert.deepEqual(withReminderDefault({},prefs).reminder,{daysBefore:3});
  assert.deepEqual(withReminderDefault({reminder:{daysBefore:1}},prefs).reminder,{daysBefore:1});
  assert.deepEqual(withReminderDefault({reminder:{daysBefore:0}},prefs).reminder,{daysBefore:0});
});
test('preferences start opt-out, persist separately, and malformed values cannot activate notifications',()=>{
  const storage=memory(),repo=createReminderPreferences(storage);assert.equal(repo.load().systemEnabled,false);assert.equal(storage.data.size,0);
  repo.save({defaultDaysBefore:7,systemEnabled:true});assert.equal(repo.load().defaultDaysBefore,7);
  storage.setItem(PREFERENCES_KEY,'{broken');assert.equal(repo.load().systemEnabled,false);assert.equal(repo.load().writable,false);
  assert.throws(()=>repo.save({systemEnabled:true}));assert.equal(storage.getItem(PREFERENCES_KEY),'{broken');
});
test('existing MJM02 manual, MJM03 imported and household profile load without rewriting keys',()=>{
  const storage=memory();let n=0;const repo=createEventRepository(storage,()=> `legacy-${++n}`);repo.create({title:'Old',category:'general',date:'2026-09-14'});
  repo.importWaste(normalizeWasteResult({id:'source',name:'Test'},'Test 1',{entries:[{externalId:'x',date:'2026-09-15',title:'Bio',subtype:'bio'}]}),now);
  createHouseholdRepository(storage).save({name:'Kodu',address:'Test 1'});
  const before=[storage.getItem(EVENT_STORAGE_KEY),storage.getItem(HOUSEHOLD_KEY)];
  assert.equal(repo.load().events.length,2);dueReminders(repo.load().events,now);
  assert.deepEqual([storage.getItem(EVENT_STORAGE_KEY),storage.getItem(HOUSEHOLD_KEY)],before);
});
