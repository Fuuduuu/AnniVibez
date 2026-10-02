import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as model from '../../src/homework/model.js';

const task=patch=>({id:'hw-1',studentId:'anni',subject:'Matemaatika',title:'Harjutus 4',dueDate:'2026-10-02',dueTime:null,
  lessonId:null,notes:'',completedAt:null,source:'local',...patch});

test('a manual homework task preserves its subject snapshot, optional link and local identity',()=>{
  assert.deepEqual(model.validateHomework(task({subject:' Matemaatika ',title:' Harjutus 4 ',notes:' vihikusse '})),task({notes:'vihikusse'}));
  assert.equal(model.validateHomework(task({lessonId:'lesson-1'})).subject,'Matemaatika');
});

for (const [name, patch] of [
  ['blank subject', {subject:'  '}], ['blank title', {title:''}], ['wrong student', {studentId:'other'}],
  ['unknown source', {source:'server'}], ['invalid day', {dueDate:'2026-02-30'}], ['non leap day', {dueDate:'2025-02-29'}],
  ['non canonical date', {dueDate:'2026-2-02'}], ['invalid time', {dueTime:'24:00'}],
  ['invalid completion', {completedAt:'yesterday'}], ['normalized invalid completion day', {completedAt:'2026-02-30T10:00:00Z'}],
  ['blank lesson link', {lessonId:''}], ['calendar payload', {entityType:'calendar_event'}],
]) test(`validation refuses ${name}`,()=>assert.throws(()=>model.validateHomework(task(patch))));

test('optional fields normalize to null/empty and future provenance can be read without integration',()=>{
  const {dueTime, lessonId, notes, completedAt, ...minimal}=task();
  assert.deepEqual(model.validateHomework(minimal),task());
  assert.equal(model.validateHomework(task({source:'stuudium',dueDate:'2028-02-29',dueTime:'23:59',completedAt:'2026-10-02T08:20:00.000Z'})).source,'stuudium');
});

const now=new Date(2026,9,1,12,30); // Thursday, local wall clock.
test('overdue uses local dates and optional due time; completed work is excluded',()=>{
  assert.equal(model.isOverdue(task({dueDate:'2026-09-30'}),now),true);
  assert.equal(model.isOverdue(task({dueDate:'2026-10-01',dueTime:'12:29'}),now),true);
  assert.equal(model.isOverdue(task({dueDate:'2026-10-01',dueTime:'12:30'}),now),false);
  assert.equal(model.isOverdue(task({dueDate:'2026-10-01'}),now),false);
  assert.equal(model.isOverdue(task({dueDate:'2026-09-30',completedAt:'2026-10-01T08:00:00Z'}),now),false);
});

test('groups overdue, today, tomorrow, this school week, later and completed without duplicate counts',()=>{
  const monday=new Date(2026,8,28,10);
  const rows=[task({id:'past',dueDate:'2026-09-27'}),task({id:'today',dueDate:'2026-09-28'}),
    task({id:'tomorrow',dueDate:'2026-09-29'}),task({id:'friday',dueDate:'2026-10-02'}),
    task({id:'weekend',dueDate:'2026-10-03'}),task({id:'next-week',dueDate:'2026-10-05'}),
    task({id:'done',dueDate:'2026-09-20',completedAt:'2026-09-21T09:00:00Z'})];
  const grouped=model.groupHomework(rows,monday);
  assert.deepEqual(grouped.groups.map(g=>[g.key,g.items.map(t=>t.id)]),[
    ['overdue',['past']],['today',['today']],['tomorrow',['tomorrow']],['week',['friday']],['later',['weekend','next-week']],
  ]);
  assert.deepEqual(grouped.completed.map(t=>t.id),['done']);
  assert.equal(grouped.groups.flatMap(g=>g.items).length,6);
});

test('today/tomorrow take precedence at Friday, weekend and month boundaries',()=>{
  const friday=new Date(2026,9,2,10);
  const grouped=model.groupHomework([task({id:'sat',dueDate:'2026-10-03'}),task({id:'sun',dueDate:'2026-10-04'})],friday);
  assert.deepEqual(grouped.groups.find(g=>g.key==='tomorrow').items.map(t=>t.id),['sat']);
  assert.deepEqual(grouped.groups.find(g=>g.key==='later').items.map(t=>t.id),['sun']);
  assert.equal(model.groupHomework([task({dueDate:'2026-11-01'})],new Date(2026,9,31,10)).groups.find(g=>g.key==='tomorrow').items.length,1);
});

test('sort is stable by date, timed before untimed, subject, title and finally id',()=>{
  const rows=[task({id:'untimed'}),task({id:'b',dueTime:'09:00',subject:'A',title:'A'}),
    task({id:'a',dueTime:'09:00',subject:'A',title:'A'}),task({id:'title',dueTime:'09:00',subject:'A',title:'B'}),
    task({id:'subject',dueTime:'09:00',subject:'B',title:'A'}),task({id:'later-time',dueTime:'10:00'}),
    task({id:'earlier-date',dueDate:'2026-10-01'})];
  assert.deepEqual(model.sortHomework(rows).map(t=>t.id),['earlier-date','a','b','title','subject','later-time','untimed']);
  assert.equal(rows[0].id,'untimed'); // Pure helper does not reorder storage.
});

test('lesson/date relevance uses the persisted link or unlinked subject snapshot',()=>{
  const lesson={id:'lesson-1',subject:'Uus aine nimi'};
  const rows=[task({id:'linked',lessonId:'lesson-1'}),task({id:'manual',subject:' uus aine nimi '}),
    task({id:'wrong-date',lessonId:'lesson-1',dueDate:'2026-10-03'}),task({id:'other-link',lessonId:'lesson-2',subject:'Uus aine nimi'})];
  assert.deepEqual(model.lessonHomework(rows,lesson,'2026-10-02').map(t=>t.id).sort(),['linked','manual']);
  assert.equal(rows[0].subject,'Matemaatika');
});

test('home priority is overdue then today then tomorrow and excludes completed/later work',()=>{
  const overdue=task({id:'past',dueDate:'2026-09-30',title:'Vana ülesanne'});
  const today=task({id:'today',dueDate:'2026-10-01'}),tomorrow=task({id:'tomorrow'});
  const done=task({id:'done',dueDate:'2026-09-20',completedAt:'2026-10-01T09:00:00Z'});
  assert.equal(model.homeworkHomeSummary([tomorrow,today,done,overdue],now).kind,'overdue');
  assert.equal(model.homeworkHomeSummary([tomorrow,today,done,overdue],now).title,'Vana ülesanne');
  assert.equal(model.homeworkHomeSummary([tomorrow,today,done],now).kind,'today');
  assert.equal(model.homeworkHomeSummary([tomorrow,done],now).kind,'tomorrow');
  assert.equal(model.homeworkHomeSummary([done,task({dueDate:'2026-10-10'})],now),null);
});
