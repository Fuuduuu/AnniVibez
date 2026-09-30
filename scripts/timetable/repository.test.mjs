import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimetableRepository, TIMETABLE_KEY } from '../../src/timetable/repository.js';

function storage(seed = []) {
  const values = new Map(seed);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
const input = patch => ({ weekday: 1, period: 1, subject: 'Matemaatika', start: '08:15', end: '09:00',
  room: '', teacher: '', ...patch });

test('manual add, edit and delete survive a new repository instance', () => {
  const disk = storage();
  const repo = createTimetableRepository(disk, () => 'manual-1');
  assert.deepEqual(repo.load().lessons, []);
  repo.create(input());
  assert.equal(createTimetableRepository(disk).load().lessons[0].subject, 'Matemaatika');
  repo.update('manual-1', { subject: 'Eesti keel', room: '201' });
  assert.equal(createTimetableRepository(disk).load().lessons[0].subject, 'Eesti keel');
  repo.remove('manual-1');
  assert.deepEqual(createTimetableRepository(disk).load().lessons, []);
});

test('class metadata survives reload, while the student remains Anni', () => {
  const disk = storage();
  createTimetableRepository(disk).saveStudent({ className: '6A' });
  assert.deepEqual(createTimetableRepository(disk).load().student, { id: 'anni', name: 'Anni', className: '6A' });
});

test('duplicate create and edit are refused without overwriting existing lessons', () => {
  const disk = storage();let id = 0;
  const repo = createTimetableRepository(disk, () => `id-${++id}`);
  repo.create(input());
  assert.throws(() => repo.create(input({ subject: 'Keemia' })), /sama/i);
  repo.create(input({ weekday: 2 }));
  assert.throws(() => repo.update('id-3', { weekday: 1 }), /sama/i);
  assert.deepEqual(repo.load().lessons.map(l => l.weekday), [1, 2]);
});

test('an acknowledged change uses the latest saved timetable instead of an old loaded view', () => {
  const disk = storage();const a = createTimetableRepository(disk, () => 'A');const b = createTimetableRepository(disk, () => 'B');
  a.load();b.load();a.create(input());b.create(input({ weekday: 2 }));
  assert.deepEqual(a.load().lessons.map(l => l.id), ['A', 'B']);
});

test('a failed save keeps the previous durable lesson and reports failure', () => {
  const disk = storage();const repo = createTimetableRepository(disk, () => '1');repo.create(input());
  disk.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => repo.update('1', { subject: 'Ajalugu' }), /ebaõnnestus/);
  assert.equal(repo.load().lessons[0].subject, 'Matemaatika');
});

for (const raw of ['{invalid', '{"version":2}', 'null']) {
  test(`unreadable storage stays read-only and preserves its raw bytes: ${raw}`, () => {
    const disk = storage([[TIMETABLE_KEY, raw]]);const repo = createTimetableRepository(disk);
    assert.equal(repo.load().writable, false);
    assert.throws(() => repo.create(input()), /üle/);
    assert.equal(disk.getItem(TIMETABLE_KEY), raw);
  });
}

test('timetable mutations never touch calendar, auth or outbox keys', () => {
  const protectedKeys = [['majamajandus_household_events_v1', 'calendar-original'], ['majandus_sync_auth_v1', 'auth-original'], ['outbox', 'outbox-original']];
  const disk = storage(protectedKeys);const repo = createTimetableRepository(disk, () => '1');
  repo.create(input());repo.update('1', { room: '301' });repo.saveStudent({ className: '6A' });repo.remove('1');
  for (const [key, value] of protectedKeys) assert.equal(disk.getItem(key), value);
  assert.deepEqual([...disk.values.keys()].sort(), [...protectedKeys.map(([key]) => key), TIMETABLE_KEY].sort());
});

test('manual CRUD binds the same student ID and local provenance to each persisted lesson', () => {
  const disk=storage(); const repo=createTimetableRepository(disk,()=> 'one');
  repo.create(input());
  assert.equal(repo.load().lessons[0].studentId,'anni');
  assert.equal(repo.load().lessons[0].source,'local');
  assert.equal(JSON.parse(disk.getItem(TIMETABLE_KEY)).lessons[0].period,1);
});

test('entries from the first uncommitted preview remain readable after the reference model update', () => {
  const raw=JSON.stringify({version:1,source:'manual',student:{name:'Anni',className:'5A'},lessons:[
    {id:'old',weekday:1,lessonNumber:2,subject:'Eesti keel',startTime:'09:00',endTime:'09:45',room:'',teacher:''}]});
  const disk=storage([[TIMETABLE_KEY,raw]]);const repo=createTimetableRepository(disk);
  assert.equal(repo.load().writable,true);assert.equal(repo.load().lessons[0].period,2);
  assert.equal(disk.getItem(TIMETABLE_KEY),raw);
  repo.update('old',{room:'123'});assert.equal(repo.load().lessons[0].room,'123');
  assert.equal(repo.load().lessons[0].studentId,'anni');
});
