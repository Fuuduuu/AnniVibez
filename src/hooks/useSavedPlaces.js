import { useState, useCallback } from 'react';
import { SAVED_PLACE_DEFAULTS as DEFAULTS, normalizePlace, normalizePlaces } from '../places/savedPlaces.js';

const KEY = 'sade_saved_places';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizePlaces(JSON.parse(raw));
  }
  catch {}
  return DEFAULTS.map(p => ({ ...p }));
}

function save(places) {
  try { localStorage.setItem(KEY, JSON.stringify(normalizePlaces(places))); } catch {}
}

export function useSavedPlaces() {
  const [places, setPlaces] = useState(load);

  const update = useCallback((idx, patch) => {
    setPlaces(prev => {
      const next = prev.map((p, i) => (i === idx ? { ...p, ...patch } : p));
      save(next);
      return next;
    });
  }, []);

  const add = useCallback((place) => {
    setPlaces(prev => {
      const next = [...prev, normalizePlace(place, prev.length)];
      save(next);
      return next;
    });
  }, []);

  const remove = useCallback((idx) => {
    setPlaces(prev => { const next = prev.filter((_, i) => i !== idx); save(next); return next; });
  }, []);

  const resolveAddress = useCallback(async ({ address }) => {
    // Integration point: connect real geocoding provider here.
    if (!address || !address.trim()) {
      return { ok: false, message: 'Lisa kõigepealt aadress.' };
    }
    return { ok: false, message: 'Aadressi otsing pole veel ühendatud. Salvesta nimi ja aadress, koordinaadid lisame järgmisena.' };
  }, []);

  return { places, update, add, remove, resolveAddress };
}
