import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHomeworkRepository, HOMEWORK_KEY} from '../../src/homework/repository.js';
import {createTimetableRepository, TIMETABLE_KEY} from '../../src/timetable/repository.js';

const input=patch=>({subject:'Matemaatika',title:'Harjutus 4',dueDate:'2026-10-02',...patch});
function fixture() {
  const values=new Map([['calendar','unchanged'],['majamajandus_calendar_sync_v1','unchanged']]);
  const writes=[]; let index=0;
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes.push(key);values.set(key,value);}};
  const repository=createHomeworkRepository(storage,()=>`hw-${++index}`,()=>new Date('2026-10-02T10:00:00Z'));
  return {values,writes,storage,repository};
}

test('empty load is writable and does not write or touch other domains',()=>{
  const {repository,writes}=fixture();
  assert.deepEqual(repository.load(),{version:1,items:[],writable:true,error:null});
  assert.deepEqual(writes,[]);
});
test('create persists canonical device-local homework on its own versioned key',()=>{
  const {repository,storage,writes,values}=fixture();
  const snapshot=repository.create(input({subject:' Matemaatika ',notes:' vihikusse '}));
  assert.equal(snapshot.items[0].subject,'Matemaatika');
  assert.equal(snapshot.items[0].studentId,'anni');
  assert.equal(snapshot.items[0].source,'local');
  assert.equal(snapshot.items[0].completedAt,null);
  assert.deepEqual(createHomeworkRepository(storage).load(),snapshot);
  assert.deepEqual(writes,[HOMEWORK_KEY]);
  assert.equal(values.get('calendar'),'unchanged');
  assert.equal(values.get('majamajandus_calendar_sync_v1'),'unchanged');
});
test('update preserves task identity and completion while editing optional fields',()=>{
  const {repository}=fixture(); repository.create(input());
  repository.setCompleted('hw-1',true);
  const edited=repository.update('hw-1',{title:'Harjutus 5',dueTime:'10:30',lessonId:'lesson-1'}).items[0];
  assert.equal(edited.id,'hw-1'); assert.equal(edited.title,'Harjutus 5');
  assert.equal(edited.completedAt,'2026-10-02T10:00:00.000Z');
  assert.equal(edited.lessonId,'lesson-1');
  assert.throws(()=>repository.update('hw-1',{studentId:'other'}));
});
test('complete/reopen are idempotent and completed work can be deleted',()=>{
  const {repository}=fixture();repository.create(input());
  const done=repository.setCompleted('hw-1',true).items[0].completedAt;
  assert.equal(repository.setCompleted('hw-1',true).items[0].completedAt,done);
  assert.equal(repository.setCompleted('hw-1',false).items[0].completedAt,null);
  assert.equal(repository.remove('hw-1').items.length,0);
  assert.throws(()=>repository.remove('hw-1'),/ei leitud/);
});
test('each mutation rereads the latest local snapshot before writing',()=>{
  const {repository,storage}=fixture(); repository.create(input());
  const other=createHomeworkRepository(storage,()=> 'other');
  other.create(input({title:'Teise akna töö'}));
  const snapshot=repository.update('hw-1',{title:'Muudetud'});
  assert.deepEqual(snapshot.items.map(item=>item.title),['Muudetud','Teise akna töö']);
  other.remove('hw-1');
  assert.throws(()=>repository.update('hw-1',{title:'Ära taasta'}),/ei leitud/);
  assert.equal(other.load().items.length,1);
});
test('a lesson rename/removal never edits or deletes the independent homework snapshot',()=>{
  const {repository,storage,values}=fixture();
  const timetable=createTimetableRepository(storage,()=> 'lesson-1');
  timetable.create({weekday:5,period:1,subject:'Matemaatika',start:'09:00',end:'09:45'});
  repository.create(input({lessonId:'lesson-1'}));
  const raw=values.get(HOMEWORK_KEY);
  timetable.update('lesson-1',{subject:'Arvutamine'});
  timetable.remove('lesson-1');
  assert.equal(values.get(HOMEWORK_KEY),raw);
  assert.equal(repository.load().items[0].subject,'Matemaatika');
  assert.equal(repository.load().items[0].lessonId,'lesson-1');
  assert.equal(JSON.parse(values.get(TIMETABLE_KEY)).lessons.length,0);
});
for (const [label,raw] of [['invalid JSON','{'],['unknown version','{"version":2,"items":[]}'],
  ['invalid item','{"version":1,"items":[{}]}'],['duplicate ids',JSON.stringify({version:1,items:[1,2].map(()=>({...input(),id:'same',studentId:'anni',source:'local'}))})]]) {
  test(`unreadable ${label} is preserved and writes are refused`,()=>{
    const {repository,values,writes}=fixture(); values.set(HOMEWORK_KEY,raw);
    assert.equal(repository.load().writable,false);
    assert.throws(()=>repository.create(input()));
    assert.equal(values.get(HOMEWORK_KEY),raw); assert.deepEqual(writes,[]);
  });
}
test('unavailable storage and failed writes never report success',()=>{
  assert.equal(createHomeworkRepository(null).load().writable,false);
  const {storage,repository,values}=fixture();repository.create(input());const before=values.get(HOMEWORK_KEY);
  storage.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>repository.update('hw-1',{title:'Draft'}),/salvestamine ebaõnnestus/);
  assert.equal(values.get(HOMEWORK_KEY),before);
});
