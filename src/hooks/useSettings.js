import { useState, useCallback } from 'react';

const PROFILE_KEY = 'sade_profile';
const PLACES_KEY  = 'sade_saved_places';

export const DEFAULT_PLACES = [
  { name: 'Kodu',  address: '', lat: null, lon: null },
  { name: 'Kool',  address: '', lat: null, lon: null },
  { name: 'Trenn', address: '', lat: null, lon: null },
];

function normalizePlace(place, idx = 0) {
  const fallback = DEFAULT_PLACES[idx] ?? { name: 'Koht', address: '', lat: null, lon: null };
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
  if (normalized.length >= DEFAULT_PLACES.length) return normalized;
  return [...normalized, ...DEFAULT_PLACES.slice(normalized.length).map(p => ({ ...p }))];
}

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export function useSettings() {
  const [profile, setProfile] = useState(() => read(PROFILE_KEY, { name: '' }));
  const [places,  setPlaces]  = useState(() => normalizePlaces(read(PLACES_KEY, DEFAULT_PLACES)));

  const saveName = useCallback((name) => {
    const next = { name: name.trim() };
    setProfile(next);
    write(PROFILE_KEY, next);
  }, []);

  const updatePlace = useCallback((idx, patch) => {
    setPlaces(prev => {
      const next = normalizePlaces(prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
      write(PLACES_KEY, next);
      return next;
    });
  }, []);

  const resolvePlaceAddress = useCallback(async ({ address }) => {
    // Integration point: connect real geocoding provider here.
    if (!address || !address.trim()) {
      return { ok: false, message: 'Lisa kõigepealt aadress.' };
    }
    return { ok: false, message: 'Aadressi otsing pole veel ühendatud. Salvesta nimi ja aadress, koordinaadid lisame järgmisena.' };
  }, []);

  return { profile, places, saveName, updatePlace, resolvePlaceAddress };
}
