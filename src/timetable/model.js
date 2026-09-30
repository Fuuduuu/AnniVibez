import { addDays, dayNumber, localDate, localTime, weekStart } from '../calendar/dates.js';

export const STUDENT_ID = 'anni';
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const WEEKDAYS = [
  { value: 1, short: 'E', label: 'Esmaspäev', color: '#c9982a' }, { value: 2, short: 'T', label: 'Teisipäev', color: '#d0588d' },
  { value: 3, short: 'K', label: 'Kolmapäev', color: '#2f9e80' }, { value: 4, short: 'N', label: 'Neljapäev', color: '#dc6a55' },
  { value: 5, short: 'R', label: 'Reede', color: '#4f8fcc' },
];
const fields = ['studentId', 'source', 'id', 'weekday', 'period', 'subject', 'start', 'end', 'room', 'teacher'];
const text = (value, max, required = false) => {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) {
    throw new Error('Kontrolli tunniplaani tekstivälju.');
  }
  return value.trim();
};

export function validateLesson(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !fields.includes(key))) throw new Error('Vigane tunni kirje.');
  if (input.studentId !== STUDENT_ID || !['local', 'stuudium'].includes(input.source)) throw new Error('Tundmatu õpilane või tunni allikas.');
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 5) {
    throw new Error('Vali päev esmaspäevast reedeni.');
  }
  if (!Number.isSafeInteger(input.period) || input.period < 1) {
    throw new Error('Tunni number peab olema positiivne täisarv.');
  }
  if (typeof input.start !== 'string' || typeof input.end !== 'string'
    || !TIME.test(input.start) || !TIME.test(input.end) || input.end <= input.start) {
    throw new Error('Sisesta algus ja lõpp kujul HH:MM. Lõpp peab olema algusest hiljem.');
  }
  return { id: text(input.id, 100, true), studentId: input.studentId, source: input.source, weekday: input.weekday, period: input.period,
    subject: text(input.subject, 200, true), start: input.start, end: input.end,
    room: text(input.room ?? '', 100), teacher: text(input.teacher ?? '', 200) };
}

export function emptyTimetable() {
  return { version: 1, source: 'manual', student: { id: STUDENT_ID, name: 'Anni', className: '' }, lessons: [] };
}

export function sortLessons(lessons) {
  return [...lessons].sort((a, b) => a.weekday - b.weekday || a.period - b.period
    || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

export function validateTimetable(input) {
  if (!input || input.version !== 1 || input.source !== 'manual' || !Array.isArray(input.lessons)
    || input.student?.name !== 'Anni' || input.student.id !== STUDENT_ID) throw new Error('Tundmatu või vigane tunniplaani salvestus.');
  const lessons = input.lessons.map(validateLesson);
  if (new Set(lessons.map(l => l.id)).size !== lessons.length) throw new Error('Korduv tunni ID.');
  const slots = lessons.map(l => `${l.weekday}|${l.period}|${l.start}|${l.end}`);
  if (new Set(slots).size !== slots.length) throw new Error('Sama päeva sama tunni ja kellaaegadega tund on juba olemas.');
  return { version: 1, source: 'manual', student: { id: STUDENT_ID, name: 'Anni', className: text(input.student.className, 100) },
    lessons: sortLessons(lessons) };
}

const weekdayOf = date => new Date(dayNumber(date) * 86400000).getUTCDay();
const chronological = lessons => [...lessons].sort((a, b) => a.start.localeCompare(b.start)
  || a.period - b.period || a.id.localeCompare(b.id));

export function schoolSelection(now = new Date()) {
  const today = localDate(now), weekday = now.getDay();
  const weekend = weekday === 0 || weekday === 6;
  return { monday: weekStart(weekend ? addDays(today, 7) : today), weekday: weekend ? 1 : weekday };
}

export function weekDates(monday) {
  if (weekStart(monday) !== monday) throw new Error('Koolinädal algab esmaspäeval.');
  return WEEKDAYS.map(day => ({ ...day, date: addDays(monday, day.value - 1) }));
}

export const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

// Preserve entries made in the initial, uncommitted V1 preview. Reading never writes.
export function readTimetable(input) {
  if (input?.version === 1 && input.student?.id === undefined && Array.isArray(input.lessons)) {
    input = { ...input, student: { ...input.student, id: STUDENT_ID }, lessons: input.lessons.map(l => {
      const { lessonNumber, startTime, endTime, ...other } = l;
      return { ...other, studentId: STUDENT_ID, source: 'local', period: lessonNumber, start: startTime, end: endTime };
    }) };
  }
  return validateTimetable(input);
}

export function stepSchoolDay(selection, delta) {
  const index = selection.weekday - 1 + delta;
  const week = Math.floor(index / 5);
  return { monday: addDays(selection.monday, week * 7), weekday: (index % 5 + 5) % 5 + 1 };
}

export function lessonStates(lessons, date, now = new Date()) {
  const day = sortLessons(lessons.filter(l => l.weekday === weekdayOf(date)));
  const today = localDate(now), time = localTime(now), minutes = toMinutes(time);
  const next = date === today ? chronological(day).find(l => l.start > time) : null;
  return day.map(l => {
    const current = date === today && l.start <= time && l.end > time;
    return { ...l, status: date < today || date === today && l.end <= time ? 'past'
      : current ? 'current' : l.id === next?.id ? 'next' : 'upcoming',
      remainingMinutes: current ? toMinutes(l.end) - minutes : 0,
      untilMinutes: date === today && l.start > time ? toMinutes(l.start) - minutes : 0,
      progress: current ? (minutes - toMinutes(l.start)) * 100 / (toMinutes(l.end) - toMinutes(l.start)) : 0 };
  });
}

export function dayItems(lessons, date, now = new Date()) {
  const states = lessonStates(lessons, date, now), result = [];
  for (const [index, lesson] of states.entries()) {
    const previous = states[index - 1];
    if (previous && lesson.start > previous.end) {
      const gap = toMinutes(lesson.start) - toMinutes(previous.end);
      const free = lesson.period > previous.period + 1;
      const lunch = previous.period === 3 && lesson.period === 4 && gap >= 20;
      if (free || gap >= 20) {
        result.push({ kind: 'break', id: `gap-${previous.id}-${lesson.id}`, start: previous.end, end: lesson.start,
          label: free ? 'vaba tund' : lunch ? 'söögivahetund' : 'vahetund',
          current: date === localDate(now) && localTime(now) >= previous.end && localTime(now) < lesson.start });
      }
    }
    result.push({ kind: 'lesson', ...lesson });
  }
  return result;
}

export function homeSchoolSummary(data, now = new Date()) {
  if (!data?.lessons?.length) return null;
  const today = localDate(now), weekday = now.getDay();
  const states = lessonStates(data.lessons, today, now);
  const current = states.find(l => l.status === 'current') ?? null;
  const remaining = states.filter(l => l.status !== 'past').length;
  const next = states.find(l => l.status === 'next');
  const common = { current, remaining };
  if (next) return { ...common, kind: 'next', date: today, lesson: next, label: 'Järgmine tund', text: 'Järgmine tund' };
  if (current) return { ...common, kind: 'remaining', date: today, lesson: null, label: 'Praegu', text: 'Viimane tund käib' };
  if (weekday === 0 || weekday >= 5) {
    const lesson = chronological(data.lessons.filter(l => l.weekday === 1))[0] ?? null;
    return { ...common, kind: 'monday', date: addDays(weekStart(today), 7), lesson,
      label: 'Esmaspäeval', text: weekday === 5 ? 'Tänased tunnid on läbi' : lesson ? 'Esmaspäeval' : 'Esmaspäevaks pole tunde lisatud.' };
  }
  const tomorrow = chronological(data.lessons.filter(l => l.weekday === weekday + 1))[0] ?? null;
  return { ...common, kind: 'done', date: addDays(today, 1), lesson: tomorrow,
    label: tomorrow ? 'Homme' : 'Tänased tunnid on läbi', text: 'Tänased tunnid on läbi' };
}
