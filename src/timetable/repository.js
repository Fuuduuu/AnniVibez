import { emptyTimetable, readTimetable, validateTimetable } from './model.js';

export const TIMETABLE_KEY = 'majamajandus_timetable_v1';

// This key is device-local. It is never part of calendar storage, migration or the sync outbox.
export function createTimetableRepository(storage, newId = () => crypto.randomUUID()) {
  function load() {
    try {
      if (!storage) throw new Error('Salvestusruum pole saadaval.');
      const raw = storage.getItem(TIMETABLE_KEY);
      const data = raw === null ? emptyTimetable() : readTimetable(JSON.parse(raw));
      return { ...data, writable: true, error: null };
    } catch {
      return { ...emptyTimetable(), writable: false,
        error: 'Tunniplaani ei saanud lugeda. Olemasolevat salvestust ei kirjutata üle.' };
    }
  }
  function commit(change) {
    const current = load();
    if (!current.writable) throw new Error(current.error);
    const { writable, error, ...data } = current;
    const next = validateTimetable(change(data));
    try { storage.setItem(TIMETABLE_KEY, JSON.stringify(next)); }
    catch { throw new Error('Tunniplaani salvestamine ebaõnnestus. Sinu muudatus jäi vormi; proovi uuesti.'); }
    return { ...next, writable: true, error: null };
  }
  function target(lessons, id) {
    const lesson = lessons.find(l => l.id === id);
    if (!lesson) throw new Error('Tundi ei leitud. Ava tunniplaan uuesti.');
    return lesson;
  }
  return {
    load,
    create: input => commit(data => ({ ...data, lessons: [...data.lessons, { ...input, id: newId(), studentId: data.student.id, source: 'local' }] })),
    update: (id, patch) => commit(data => {
      const next = { ...target(data.lessons, id), ...patch, id, studentId: data.student.id, source: 'local' };
      return { ...data, lessons: data.lessons.map(l => l.id === id ? next : l) };
    }),
    remove: id => commit(data => {
      target(data.lessons, id);
      return { ...data, lessons: data.lessons.filter(l => l.id !== id) };
    }),
    saveStudent: ({ className }) => commit(data => ({ ...data, student: { ...data.student, className } })),
  };
}
