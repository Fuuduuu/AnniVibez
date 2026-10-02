import { addDays, dayNumber, localDate, localTime, weekStart } from '../calendar/dates.js';

const fields = ['id', 'studentId', 'subject', 'title', 'dueDate', 'dueTime', 'lessonId', 'notes', 'completedAt', 'source'];
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const text = (value, max, required = false) => {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) {
    throw new Error('Kontrolli kodutöö tekstivälju. Aine ja ülesanne on kohustuslikud.');
  }
  return value.trim();
};

export function validateHomework(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !fields.includes(key))) throw new Error('Vigane kodutöö kirje.');
  if (input.studentId !== 'anni' || !['local', 'stuudium'].includes(input.source)) {
    throw new Error('Tundmatu õpilane või kodutöö allikas.');
  }
  dayNumber(input.dueDate);
  const dueTime = input.dueTime ?? null;
  if (dueTime !== null && (typeof dueTime !== 'string' || !TIME.test(dueTime))) throw new Error('Sisesta kellaaeg kujul HH:MM.');
  const completedAt = input.completedAt ?? null;
  if (completedAt !== null) {
    if (typeof completedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(completedAt)
      || !Number.isFinite(Date.parse(completedAt))) throw new Error('Vigane lõpetamise aeg.');
    dayNumber(completedAt.slice(0, 10));
  }
  return { id: text(input.id, 100, true), studentId: 'anni', subject: text(input.subject, 200, true),
    title: text(input.title, 500, true), dueDate: input.dueDate, dueTime,
    lessonId: input.lessonId == null ? null : text(input.lessonId, 100, true), notes: text(input.notes ?? '', 5000),
    completedAt, source: input.source };
}

export function emptyHomework() { return { version: 1, items: [] }; }

export function validateHomeworkStore(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.items)
    || Object.keys(input).some(key => !['version', 'items'].includes(key))) throw new Error('Vigane kodutööde salvestus.');
  const items = input.items.map(validateHomework);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Korduv kodutöö ID.');
  return { version: 1, items: sortHomework(items) };
}

export function sortHomework(items) {
  return [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate)
    || (a.dueTime ?? '24:00').localeCompare(b.dueTime ?? '24:00')
    || a.subject.localeCompare(b.subject, 'et') || a.title.localeCompare(b.title, 'et') || a.id.localeCompare(b.id));
}

export function isOverdue(item, now = new Date()) {
  const today = localDate(now);
  return item.completedAt === null && (item.dueDate < today
    || item.dueDate === today && item.dueTime !== null && item.dueTime < localTime(now));
}

export function groupHomework(items, now = new Date()) {
  const today = localDate(now), tomorrow = addDays(today, 1), friday = addDays(weekStart(today), 4);
  const groups = [['overdue', 'Üle tähtaja'], ['today', 'Täna'], ['tomorrow', 'Homme'], ['week', 'Sel nädalal'], ['later', 'Hiljem']]
    .map(([key, label]) => ({ key, label, items: [] }));
  const completed = [];
  for (const item of sortHomework(items)) {
    if (item.completedAt !== null) { completed.push(item); continue; }
    const index = isOverdue(item, now) ? 0 : item.dueDate === today ? 1 : item.dueDate === tomorrow ? 2
      : item.dueDate <= friday ? 3 : 4;
    groups[index].items.push(item);
  }
  return { groups, completed };
}

export function lessonHomework(items, lesson, date) {
  const subject = lesson.subject.trim().toLocaleLowerCase('et');
  return sortHomework(items.filter(item => item.dueDate === date && (item.lessonId !== null
    ? item.lessonId === lesson.id : item.subject.trim().toLocaleLowerCase('et') === subject)));
}

export function homeworkHomeSummary(items, now = new Date()) {
  const group = groupHomework(items, now).groups.slice(0, 3).find(entry => entry.items.length);
  if (!group) return null;
  const count = group.items.length;
  const label = group.key === 'overdue' ? `${count} ${count === 1 ? 'töö' : 'tööd'} üle tähtaja`
    : `${count} ${count === 1 ? 'kodune töö' : 'kodust tööd'} ${group.key === 'today' ? 'täna' : 'homme'}`;
  return { kind: group.key, count, label, title: group.items[0].title };
}
