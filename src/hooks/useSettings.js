import { useState, useCallback } from 'react';
import { SAVED_PLACE_DEFAULTS } from '../places/savedPlaces.js';

const PROFILE_KEY = 'sade_profile';

export const DEFAULT_PLACES = SAVED_PLACE_DEFAULTS;

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// Device-local profile only. Shared saved places have exactly one runtime path: useSavedPlaces.
export function useSettings() {
  const [profile, setProfile] = useState(() => read(PROFILE_KEY, { name: '' }));

  const saveName = useCallback((name) => {
    const next = { name: name.trim() };
    setProfile(next);
    write(PROFILE_KEY, next);
  }, []);

  const resolvePlaceAddress = useCallback(async ({ address }) => {
    // Integration point: connect real geocoding provider here.
    if (!address || !address.trim()) {
      return { ok: false, message: 'Lisa kõigepealt aadress.' };
    }
    return { ok: false, message: 'Aadressi otsing pole veel ühendatud. Salvesta nimi ja aadress, koordinaadid lisame järgmisena.' };
  }, []);

  return { profile, saveName, resolvePlaceAddress };
}
