import { emptyHomework, validateHomeworkStore } from './model.js';

export const HOMEWORK_KEY = 'majamajandus_homework_v1';
const editable = ['subject', 'title', 'dueDate', 'dueTime', 'lessonId', 'notes'];
function checkPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !editable.includes(key))) throw new Error('Vigane kodutöö muudatus.');
}

// Independent device-local records. There is no calendar, timetable or sync persistence here.
export function createHomeworkRepository(storage, newId = () => crypto.randomUUID(), now = () => new Date()) {
  function load() {
    try {
      if (!storage) throw new Error('Salvestusruum pole saadaval.');
      const raw = storage.getItem(HOMEWORK_KEY);
      const data = raw === null ? emptyHomework() : validateHomeworkStore(JSON.parse(raw));
      return { ...data, writable: true, error: null };
    } catch {
      return { ...emptyHomework(), writable: false,
        error: 'Kodutöid ei saanud lugeda. Olemasolevat salvestust ei kirjutata üle.' };
    }
  }
  function commit(change) {
    const current = load();
    if (!current.writable) throw new Error(current.error);
    const next = validateHomeworkStore({ version: current.version, items: change(current.items) });
    try { storage.setItem(HOMEWORK_KEY, JSON.stringify(next)); }
    catch { throw new Error('Kodutöö salvestamine ebaõnnestus. Sinu muudatus jäi vormi; proovi uuesti.'); }
    return { ...next, writable: true, error: null };
  }
  function target(items, id) {
    const item = items.find(entry => entry.id === id);
    if (!item) throw new Error('Kodutööd ei leitud. Ava kodutööde vaade uuesti.');
    return item;
  }
  return {
    load,
    create: input => {
      checkPatch(input);
      return commit(items => [...items, { ...input, id: newId(), studentId: 'anni', source: 'local', completedAt: null }]);
    },
    update: (id, patch) => {
      checkPatch(patch);
      return commit(items => {
        const next = { ...target(items, id), ...patch };
        return items.map(item => item.id === id ? next : item);
      });
    },
    remove: id => commit(items => { target(items, id); return items.filter(item => item.id !== id); }),
    setCompleted: (id, completed) => {
      if (typeof completed !== 'boolean') throw new Error('Vigane kodutöö olek.');
      return commit(items => {
        const item = target(items, id);
        const completedAt = completed ? item.completedAt ?? now().toISOString() : null;
        return items.map(entry => entry.id === id ? { ...entry, completedAt } : entry);
      });
    },
  };
}
