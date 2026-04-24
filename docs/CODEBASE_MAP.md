# CODEBASE_MAP.md

## Current integrity state (clean repo)

- Status: **incomplete / build-blocked**
- `npm install`: succeeded
- `npm run build`: failed
- Build error: `[vite-plugin-pwa:build] Could not resolve entry module "index.html"`

This document reflects the current real state, not target state.

## Expected canonical runtime shape

- Vite frontend entry: `index.html` -> `src/main.jsx` -> `src/App.jsx`
- Frontend Ullata path expectation in code: `VITE_LOO_API_PATH || /api/ullata`
- Backend route expectation by project direction/docs: `functions/api/ullata.js`

## Confirmed present

- `src/main.jsx`
- `src/App.jsx`
- `src/components/LooTab.jsx`
- `vite.config.js`
- `public/manifest.webmanifest`

## Confirmed missing

- `index.html` (build-critical)
- `functions/api/ullata.js` (expected route missing)
- `public/screenshots/kodu.png` (manifest-referenced screenshot missing)

## Build blockers (confirmed)

- Missing root `index.html` blocks Vite build.
- Missing `functions/api/ullata.js` leaves expected `/api/ullata` route unavailable.

## PWA consistency note

- `public/manifest.webmanifest` exists.
- Manifest references `/screenshots/kodu.png`.
- `public/screenshots/kodu.png` is currently missing.

## Next-pass boundary

Next implementation pass must be a **narrow restore pass**, not redesign:
- restore `index.html`
- restore `functions/api/ullata.js`
- rerun build verification

Out of scope for next pass:
- redesign
- broad refactor
- Trends scope changes
- deploy scope opening
