import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { SAVED_PLACE_DEFAULTS as DEFAULTS, normalizePlace, normalizePlaces } from '../places/savedPlaces.js';

export const PLACES_KEY = 'sade_saved_places';
const SAVE_FAILED = 'Salvestamine ebaõnnestus. Kontrolli seadme salvestusruumi ja proovi uuesti.';

// LEGACY repository: the accepted localStorage saved-places behavior over an injected storage. The
// storage the runtime injects applies the LEGACY hint write guard, so this module never guards itself.
// Unlike the pre-C6 hooks a failed write is no longer swallowed: it rejects and the previous state stays.
export function createLegacyPlacesRepository(storage) {
  function load() {
    try {
      const raw = storage.getItem(PLACES_KEY);
      if (raw) return { places: normalizePlaces(JSON.parse(raw)), writable: true, error: null };
    }
    catch {}
    return { places: DEFAULTS.map(p => ({ ...p })), writable: true, error: null };
  }
  function persist(places) {
    const next = normalizePlaces(places);
    try { storage.setItem(PLACES_KEY, JSON.stringify(next)); }
    catch { throw new Error(SAVE_FAILED); }
    return { places: next, writable: true, error: null };
  }
  return {
    load,
    update: (idx, patch) => persist(load().places.map((p, i) => (i === idx ? { ...p, ...patch } : p))),
    add: place => { const current = load().places; return persist([...current, normalizePlace(place, current.length)]); },
    remove: idx => persist(load().places.filter((_, i) => i !== idx)),
  };
}

// Dual-mode adapter: the runtime session supplies the mode-specific repository behind one domain store.
export function useSavedPlaces(session) {
  const store = session.stores.places;
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const update = useCallback((idx, patch) => store.mutate(repository => repository.update(idx, patch), SAVE_FAILED), [store]);
  const add = useCallback(place => store.mutate(repository => repository.add(place), SAVE_FAILED), [store]);
  const remove = useCallback(idx => store.mutate(repository => repository.remove(idx), SAVE_FAILED), [store]);

  const resolveAddress = useCallback(async ({ address }) => {
    // Integration point: connect real geocoding provider here.
    if (!address || !address.trim()) {
      return { ok: false, message: 'Lisa kõigepealt aadress.' };
    }
    return { ok: false, message: 'Aadressi otsing pole veel ühendatud. Salvesta nimi ja aadress, koordinaadid lisame järgmisena.' };
  }, []);

  return useMemo(() => ({
    places: view.data?.places ?? [], loading: view.loading, writable: view.writable, error: view.error,
    update, add, remove, resolveAddress,
  }), [view, update, add, remove, resolveAddress]);
}
