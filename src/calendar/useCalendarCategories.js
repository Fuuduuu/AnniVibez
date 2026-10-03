import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergeCalendarCategories } from './categoryModel.js';
import { CATEGORY_STORAGE_KEY, createCategoryRepository } from './categoryRepository.js';

export function useCalendarCategories(events) {
  const repository = useMemo(() => {
    let storage;
    try { storage = globalThis.localStorage; } catch { storage = null; }
    return createCategoryRepository(storage);
  }, []);
  const [view, setView] = useState(() => repository.load());
  useEffect(() => {
    const refresh = event => { if (event.key === CATEGORY_STORAGE_KEY || event.key === null) setView(repository.load()); };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [repository]);
  const create = useCallback(input => {
    const next = repository.create(input);
    setView(next);
    return next.categories.at(-1);
  }, [repository]);
  const remove = useCallback(id => { setView(repository.remove(id)); }, [repository]);
  const categories = useMemo(() => mergeCalendarCategories(view, events), [view, events]);
  return { categories, writable: view.writable, error: view.error, create, remove };
}
