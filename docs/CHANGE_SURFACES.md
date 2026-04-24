# CHANGE_SURFACES.md

Canonical bus routing logic: `docs/BUS_LOGIC_LOCK.md`

## Purpose

Small impact map for current clean-repo integrity blockers.

## Verified baseline

- `npm install`: succeeded
- `npm run build`: failed because `index.html` is missing
- `/api/ullata` route file expected by app direction is missing

## Surface map (actual state now)

| Surface | Primary files | Current status | Local vs cross-cutting |
|---|---|---|---|
| Frontend bootstrap | `index.html`, `src/main.jsx`, `src/App.jsx` | `index.html` missing | Cross-cutting |
| Loo/Ullata frontend | `src/components/LooTab.jsx` | Present, calls `/api/ullata` | Cross-cutting at API boundary |
| `/api/ullata` backend route | `functions/api/ullata.js` | Missing | Cross-cutting at API boundary |
| PWA manifest screenshot | `public/manifest.webmanifest`, `public/screenshots/kodu.png` | Manifest present, screenshot missing | Local asset consistency |
| Governance docs | `docs/PROJECT_MEMORY.md`, `docs/TRUTH_INDEX.md`, `docs/ACTIVE_SCOPE_LOCK.md`, `docs/ACCEPTED_CHECKPOINTS.md` | Present | Docs-only |

## Confirmed missing runtime/build files

- `index.html`
- `functions/api/ullata.js`
- `public/screenshots/kodu.png`

## Next pass must stay narrow

Recommended next implementation pass:
- **Narrow restore pass only**
- restore `index.html`
- restore `functions/api/ullata.js`
- verify build again

Not allowed in next pass:
- redesign
- broad refactor
- Trends opening
- deploy/startup of wider architecture work
