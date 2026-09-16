// Saved-place defaults and normalization shared by the saved-place hooks.
// Pure: no React, no storage foundation, no browser globals.

export const SAVED_PLACE_DEFAULTS = [
  { name: 'Kodu',  address: '', lat: null, lon: null },
  { name: 'Kool',  address: '', lat: null, lon: null },
  { name: 'Trenn', address: '', lat: null, lon: null },
];

export function normalizePlace(place, idx = 0) {
  const fallback = SAVED_PLACE_DEFAULTS[idx] ?? { name: 'Koht', address: '', lat: null, lon: null };
  const lat = Number.parseFloat(place?.lat);
  const lon = Number.parseFloat(place?.lon);

  return {
    name: typeof place?.name === 'string' && place.name.trim() ? place.name.trim() : fallback.name,
    address: typeof place?.address === 'string' ? place.address : '',
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

export function normalizePlaces(places) {
  const raw = Array.isArray(places) ? places : [];
  const normalized = raw.map((p, i) => normalizePlace(p, i));
  if (normalized.length >= SAVED_PLACE_DEFAULTS.length) return normalized;
  return [...normalized, ...SAVED_PLACE_DEFAULTS.slice(normalized.length).map(p => ({ ...p }))];
}
