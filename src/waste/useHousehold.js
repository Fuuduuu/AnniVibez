import { useCallback, useMemo, useSyncExternalStore } from 'react';

const SAVE_FAILED = 'Salvestamine ebaõnnestus. Proovi uuesti.';
const EMPTY_PROFILE = { name: '', address: '' };

// Dual-mode adapter over the runtime session's household store: LEGACY runs the accepted
// createHouseholdRepository over localStorage, READY the accepted C5 IndexedDB household repository.
export function useHousehold(session) {
  const store = session.stores.household;
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const save = useCallback(patch => store.mutate(repository => repository.save(patch), SAVE_FAILED), [store]);
  return useMemo(() => ({
    ...view.data, profile: view.data?.profile ?? EMPTY_PROFILE, loading: view.loading, writable: view.writable, error: view.error, save,
  }), [view, save]);
}
