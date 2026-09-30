import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as model from '../../src/timetable/model.js';
import { subjectColors } from '../../src/timetable/presentation.js';

const lesson = patch => ({ id: 'lesson-1', studentId: 'anni', source: 'local', weekday: 1, period: 1, subject: 'Matemaatika',
  start: '08:15', end: '09:00', room: '', teacher: '', ...patch });

test('a manual lesson preserves its school slot and trims presentation fields', () => {
  assert.deepEqual(model.validateLesson(lesson({ subject: ' Matemaatika ', room: ' 203 ', teacher: ' Mari ' })),
    lesson({ room: '203', teacher: 'Mari' }));
});

for (const [name, patch] of Object.entries({ weekend: { weekday: 6 }, 'string weekday': { weekday: '1' },
  'zero lesson': { period: 0 }, 'fractional lesson': { period: 1.5 }, 'missing subject': { subject: ' ' },
  'invalid clock': { start: '8:15' }, 'invalid minute': { end: '09:60' },
  'equal times': { end: '08:15' }, 'reverse times': { end: '07:15' } })) {
  test(`rejects ${name}`, () => assert.throws(() => model.validateLesson(lesson(patch))));
}

test('lessons are ordered by weekday, lesson number, then start time without changing the input', () => {
  const input = [lesson({ id: 'wed', weekday: 3 }), lesson({ id: 'late', period: 2, start: '10:15', end: '11:00' }),
    lesson({ id: 'early', period: 2, start: '09:15', end: '10:00' }), lesson({ id: 'first' })];
  assert.deepEqual(model.sortLessons(input).map(l => l.id), ['first', 'early', 'late', 'wed']);
  assert.deepEqual(input.map(l => l.id), ['wed', 'late', 'early', 'first']);
});

test('Anni has one versioned manual timetable with an editable class', () => {
  assert.deepEqual(model.emptyTimetable(), { version: 1, source: 'manual', student: { id: 'anni', name: 'Anni', className: '' }, lessons: [] });
  assert.equal(model.validateTimetable({ ...model.emptyTimetable(), student: { id: 'anni', name: 'Anni', className: ' 6A ' } }).student.className, '6A');
});

test('an exact duplicate weekday, number and time slot is rejected even for a different subject', () => {
  assert.throws(() => model.validateTimetable({ ...model.emptyTimetable(), lessons: [lesson(), lesson({ id: 'other', subject: 'Ajalugu' })] }), /sama/i);
});

test('duplicate IDs and unsupported storage versions fail closed', () => {
  assert.throws(() => model.validateTimetable({ ...model.emptyTimetable(), lessons: [lesson(), lesson({ weekday: 2 })] }));
  assert.throws(() => model.validateTimetable({ ...model.emptyTimetable(), version: 2 }));
  assert.throws(() => model.validateTimetable({ ...model.emptyTimetable(), source: 'stuudium' }));
});

const monday = (hours, minutes = 0) => new Date(2026, 8, 28, hours, minutes);
const day = [lesson(), lesson({ id: 'lesson-2', period: 2, start: '09:10', end: '09:55' })];

test('current lesson uses an inclusive start and exclusive end; breaks select the next lesson', () => {
  assert.deepEqual(model.lessonStates(day, '2026-09-28', monday(8, 15)).map(l => l.status), ['current', 'next']);
  assert.deepEqual(model.lessonStates(day, '2026-09-28', monday(9)).map(l => l.status), ['past', 'next']);
  assert.deepEqual(model.lessonStates(day, '2026-09-28', monday(9, 55)).map(l => l.status), ['past', 'past']);
});

test('a viewed date in a different week cannot show the current lesson from today', () => {
  assert.deepEqual(model.lessonStates(day, '2026-09-21', monday(8, 30)).map(l => l.status), ['past', 'past']);
  assert.deepEqual(model.lessonStates(day, '2026-10-05', monday(8, 30)).map(l => l.status), ['upcoming', 'upcoming']);
  assert.deepEqual(model.lessonStates(day, '2026-09-29', monday(8, 30)), []);
});

test('week dates cross month boundaries and weekend opens the coming school week', () => {
  assert.deepEqual(model.weekDates('2026-09-28').map(d => d.date), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(model.schoolSelection(new Date(2026, 9, 3, 12)), { monday: '2026-10-05', weekday: 1 });
  assert.deepEqual(model.schoolSelection(new Date(2026, 9, 4, 12)), { monday: '2026-10-05', weekday: 1 });
  assert.deepEqual(model.schoolSelection(new Date(2026, 8, 30, 12)), { monday: '2026-09-28', weekday: 3 });
});

test('Home shows the next chronological lesson, then remaining count, then the end of school', () => {
  const data = { ...model.emptyTimetable(), lessons: day };
  assert.equal(model.homeSchoolSummary(data, monday(8, 30)).lesson.id, 'lesson-2');
  assert.equal(model.homeSchoolSummary(data, monday(9, 20)).kind, 'remaining');
  assert.equal(model.homeSchoolSummary(data, monday(9, 20)).remaining, 1);
  assert.equal(model.homeSchoolSummary(data, monday(10)).text, 'Tänased tunnid on läbi');
  assert.equal(model.homeSchoolSummary(model.emptyTimetable(), monday(8)), null);
});

test('a weekend Home card uses next Monday, without putting lessons into the calendar', () => {
  const result = model.homeSchoolSummary({ ...model.emptyTimetable(), lessons: day }, new Date(2026, 9, 3, 12));
  assert.equal(result.date, '2026-10-05');
  assert.equal(result.lesson.id, 'lesson-1');
  assert.equal(result.kind, 'monday');
});

test('current and next lesson include the real remaining minutes and current progress', () => {
  const states = model.lessonStates(day, '2026-09-28', monday(8, 30));
  assert.equal(states[0].remainingMinutes, 30);
  assert.equal(states[0].progress, 100 / 3);
  assert.equal(states[1].untilMinutes, 40);
  assert.equal(states[1].progress, 0);
});

test('student identity and lesson provenance are separate from household calendar identity', () => {
  assert.equal(model.emptyTimetable().student.id, 'anni');
  assert.equal(model.validateLesson(lesson()).studentId, 'anni');
  assert.equal(model.validateLesson(lesson()).source, 'local');
  assert.equal(model.validateLesson(lesson({source:'stuudium'})).source, 'stuudium');
  assert.throws(() => model.validateLesson(lesson({studentId:'another-child'})));
  assert.throws(() => model.validateLesson(lesson({source:'calendar'})));
});

test('breaks use actual manual times and missing periods, with no persisted break records', () => {
  const input = [lesson({period:3,start:'10:00',end:'10:45'}), lesson({id:'4',period:4,start:'11:15',end:'12:00'}),
    lesson({id:'6',period:6,start:'13:00',end:'13:45'})];
  const before = structuredClone(input);
  const rows = model.dayItems(input, '2026-09-28', monday(11));
  const breaks = rows.filter(r=>r.kind==='break');
  assert.deepEqual(breaks.map(b=>[b.label,b.start,b.end,b.current]), [
    ['söögivahetund','10:45','11:15',true], ['vaba tund','12:00','13:00',false]]);
  assert.deepEqual(input,before);
  assert.equal(rows.filter(r=>r.kind==='lesson').length,3);
});

test('short ordinary gaps and overlapping lessons do not invent free periods or lunch', () => {
  assert.equal(model.dayItems(day,'2026-09-28',monday(9)).filter(r=>r.kind==='break').length,0);
  const overlaps=[lesson(),lesson({id:'2',period:3,start:'08:30',end:'09:15'})];
  assert.equal(model.dayItems(overlaps,'2026-09-28',monday(8,45)).filter(r=>r.kind==='break').length,0);
});

test('Home combines the next lesson, current remaining minutes and today remaining count', () => {
  const summary = model.homeSchoolSummary({...model.emptyTimetable(),lessons:day}, monday(8,30));
  assert.equal(summary.lesson.id,'lesson-2');
  assert.equal(summary.current.id,'lesson-1');
  assert.equal(summary.current.remainingMinutes,30);
  assert.equal(summary.remaining,2);
});

test('Friday after school points to the real coming Monday first lesson without inventing missing days', () => {
  const data={...model.emptyTimetable(),lessons:[...day,lesson({id:'fri',weekday:5})]};
  const summary=model.homeSchoolSummary(data,new Date(2026,9,2,16));
  assert.equal(summary.kind,'monday');assert.equal(summary.date,'2026-10-05');
  assert.equal(summary.lesson.id,'lesson-1');assert.equal(summary.text,'Tänased tunnid on läbi');
  const noMonday=model.homeSchoolSummary({...data,lessons:[lesson({weekday:5})]},new Date(2026,9,3,12));
  assert.equal(noMonday.lesson,null);
});

test('day stepping crosses school-week edges in both directions', () => {
  assert.deepEqual(model.stepSchoolDay({monday:'2026-09-28',weekday:5},1),{monday:'2026-10-05',weekday:1});
  assert.deepEqual(model.stepSchoolDay({monday:'2026-10-05',weekday:1},-1),{monday:'2026-09-28',weekday:5});
});

test('custom subjects, including object property names, get a safe color without breaking the screen', () => {
  for (const subject of ['Klaver','constructor','__proto__']) {
    const colors=subjectColors(model.validateLesson(lesson({subject})).subject);
    assert.equal(typeof colors['--tt-subject-tint'],'string');
    assert.equal(typeof colors['--tt-subject-ink'],'string');
  }
  assert.deepEqual(subjectColors(' Matemaatika '),subjectColors('MATEMAATIKA'));
});
