import { useState, useCallback } from 'react';

const KEY = 'sade_saved_places';

const DEFAULTS = [
  { name: 'Kodu',  address: '', lat: null, lon: null },
  { name: 'Kool',  address: '', lat: null, lon: null },
  { name: 'Trenn', address: '', lat: null, lon: null },
];

function normalizePlace(place, idx = 0) {
  const fallback = DEFAULTS[idx] ?? { name: 'Koht', address: '', lat: null, lon: null };
  const lat = Number.parseFloat(place?.lat);
  const lon = Number.parseFloat(place?.lon);

  return {
    name: typeof place?.name === 'string' && place.name.trim() ? place.name.trim() : fallback.name,
    address: typeof place?.address === 'string' ? place.address : '',
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

function normalizePlaces(places) {
  const raw = Array.isArray(places) ? places : [];
  const normalized = raw.map((p, i) => normalizePlace(p, i));
  if (normalized.length >= DEFAULTS.length) return normalized;
  return [...normalized, ...DEFAULTS.slice(normalized.length).map(p => ({ ...p }))];
}

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
