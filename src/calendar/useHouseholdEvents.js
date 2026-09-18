import { useCallback, useMemo, useSyncExternalStore } from 'react';

const SAVE_FAILED = 'Salvestamine ebaõnnestus. Kontrolli seadme salvestusruumi ja proovi uuesti.';
const NO_EVENTS = [];

// Dual-mode adapter over the runtime session's calendar store: LEGACY runs the accepted
// createEventRepository over localStorage, READY the accepted C5 IndexedDB calendar repository.
// Domain semantics live in those repositories; every mutator returns a promise that rejects on failure.
export function useHouseholdEvents(session) {
  const store = session.stores.calendar;
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const mutate = useCallback((method, args) => store.mutate(repository => repository[method](...args), SAVE_FAILED), [store]);
  const create = useCallback(input => mutate('create', [input]), [mutate]);
  const importWaste = useCallback((...args) => mutate('importWaste', args), [mutate]);
  const update = useCallback((...args) => mutate('update', args), [mutate]);
  const remove = useCallback((...args) => mutate('remove', args), [mutate]);
  return useMemo(() => ({
    ...view.data, events: view.data?.events ?? NO_EVENTS, loading: view.loading, writable: view.writable, error: view.error,
    create, importWaste, update, remove,
  }), [view, create, importWaste, update, remove]);
}
