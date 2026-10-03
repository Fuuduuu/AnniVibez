import { isCustomCategory, validateCustomCategory } from './categoryModel.js';

export const CATEGORY_STORAGE_KEY = 'majamajandus_calendar_categories_v1';
const empty = () => ({ version: 1, categories: [], hiddenIds: [] });

// Device-local picker preferences. Event snapshots, calendar storage and the outbox are never modified here.
export function createCategoryRepository(storage, newId = () => crypto.randomUUID()) {
  function load() {
    try {
      if (!storage) throw new Error('Salvestusruum pole saadaval.');
      const raw = storage.getItem(CATEGORY_STORAGE_KEY);
      const data = raw === null ? empty() : JSON.parse(raw);
      if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.hiddenIds)
        || !data.hiddenIds.every(isCustomCategory)) throw new Error('Vigane kategooriate salvestus.');
      const categories = data.categories.map(validateCustomCategory);
      const hiddenIds = [...new Set(data.hiddenIds.map(id => id.toLowerCase()))];
      if (new Set(categories.map(value => value.id)).size !== categories.length
        || categories.some(value => hiddenIds.includes(value.id))) throw new Error('Korduv kategooria.');
      return { version: 1, categories, hiddenIds, writable: true, error: null };
    } catch {
      return { ...empty(), writable: false, error: 'Kohandatud kategooriaid ei saanud lugeda. Salvestust ei kirjutata üle.' };
    }
  }
  function commit(change) {
    const current = load();
    if (!current.writable) throw new Error(current.error);
    const { writable, error, ...data } = current;
    const next = change(data);
    try { storage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new Error('Kategooria salvestamine ebaõnnestus. Proovi uuesti.'); }
    return { ...next, writable: true, error: null };
  }
  return {
    load,
    create: input => commit(data => {
      const category = validateCustomCategory({ ...input, id: `custom:${newId()}` });
      if (data.categories.some(value => value.id === category.id) || data.hiddenIds.includes(category.id)) throw new Error('Kategooria ID on juba kasutusel.');
      return { ...data, categories: [...data.categories, category] };
    }),
    remove: id => commit(data => {
      if (!isCustomCategory(id)) throw new Error('Valmiskategooriat ei saa kustutada.');
      const categoryId = id.toLowerCase();
      return { ...data, categories: data.categories.filter(value => value.id !== categoryId),
        hiddenIds: [...new Set([...data.hiddenIds, categoryId])] };
    }),
  };
}
