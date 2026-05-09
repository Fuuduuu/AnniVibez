# Full Codebase Audit

## Executive summary
- Overall health: stable production baseline with clear protected surfaces and successful build, but there are still notable risks in API abuse hardening, mobile performance, and maintainability.
- Biggest risks:
  - public `/api/ullata` endpoint can be abused for provider-cost burn (no auth/rate-limit guard)
  - large initial JS payload for mobile (map/route layers loaded in main app bundle)
  - duplicated settings/place/geocoding logic across hooks/components increases drift risk
- Recommended next 5 passes:
  1. `PASS 31B — ULLATA_API_ABUSE_GUARDS`
  2. `PASS 31C — MAP_CODE_SPLIT_AND_DATA_LAZY_LOAD`
  3. `PASS 31D — ULLATA_PROMPT_INPUT_GUARDRAILS`
  4. `PASS 31E — MAP_RECENTER_BEHAVIOR_GUARD`
  5. `PASS 31F — CI_LINT_TEST_BASELINE`

## Severity scale
- CRITICAL: immediate production break or severe exploit path.
- HIGH: high likelihood/high-impact risk that should be prioritized next.
- MEDIUM: meaningful risk or regression vector; fix in near-term.
- LOW: polish/hardening and maintainability improvements.
- INFO: non-blocking architectural observations.

## Findings

### AUDIT-001
- Severity: HIGH
- Category: security
- Affected files: `functions/api/ullata.js`
- Evidence:
  - `functions/api/ullata.js:267` (`onRequestPost`) accepts request and directly attempts provider calls.
  - `functions/api/ullata.js:278` and `:289` call Gemini/OpenAI when keys exist.
  - No auth token check, no per-IP/user throttling, no abuse/rate guard.
- Why it matters:
  - Endpoint can be hit repeatedly and drive provider usage/cost spikes.
- Recommended fix:
  - Add lightweight abuse controls (rate limiting by IP/user fingerprint, minimal bot guard, and request budget caps).
- Suggested pass: `PASS 31B — ULLATA_API_ABUSE_GUARDS`
- Estimated fix risk: medium
- Fix now or later: now

### AUDIT-002
- Severity: HIGH
- Category: performance
- Affected files: `src/components/BusMapPicker.jsx`, `src/data/routeShapes.js`, `src/data/stopLineMap.js`, bundle output
- Evidence:
  - `src/components/BusMapPicker.jsx:6-7` imports large map data layers directly.
  - Build output: `dist/assets/index-3TiLcKUs.js` is `498.81 kB` (gzip `135.77 kB`).
- Why it matters:
  - Larger initial payload hurts mobile cold-start and increases map-tab jank risk on lower-end devices.
- Recommended fix:
  - Lazy-load map module/data (`BusMapPicker`, `routeShapes`, `stopLineMap`) only when bus map opens.
- Suggested pass: `PASS 31C — MAP_CODE_SPLIT_AND_DATA_LAZY_LOAD`
- Estimated fix risk: medium
- Fix now or later: now

### AUDIT-003
- Severity: MEDIUM
- Category: security
- Affected files: `functions/api/ullata.js`
- Evidence:
  - `functions/api/ullata.js:69-70` accepts client-provided `prompt` and `systemPrompt`.
  - Values are forwarded into provider requests at `:199`, `:204`, `:240-241`.
  - No explicit character/token length caps for these fields.
- Why it matters:
  - Enables expensive prompt payloads and weakens server-side control over generation policy.
- Recommended fix:
  - Enforce strict max lengths and optionally ignore/whitelist client `systemPrompt`.
- Suggested pass: `PASS 31D — ULLATA_PROMPT_INPUT_GUARDRAILS`
- Estimated fix risk: low/medium
- Fix now or later: now

### AUDIT-004
- Severity: MEDIUM
- Category: privacy
- Affected files: `src/components/BussCard.jsx`
- Evidence:
  - `src/components/BussCard.jsx:32-33` requests geolocation immediately in `useEffect` on render.
- Why it matters:
  - Triggers location permission prompt before explicit user action, which is a privacy/UX friction point.
- Recommended fix:
  - Move home-card GPS lookup behind explicit tap action (same model as BussTab GPS button).
- Suggested pass: `PASS 31E — HOME_CARD_GPS_CONSENT_TRIGGER`
- Estimated fix risk: low
- Fix now or later: near-term

### AUDIT-005
- Severity: MEDIUM
- Category: correctness
- Affected files: `src/components/BusMapPicker.jsx`
- Evidence:
  - `src/components/BusMapPicker.jsx:545` runs `mapRef.current.setView(initialCenter)` whenever `initialCenter` changes.
- Why it matters:
  - Can unexpectedly re-center map while user is panning/zooming if origin state updates.
- Recommended fix:
  - Add one-time initial-center guard or only recenter on explicit user command.
- Suggested pass: `PASS 31F — MAP_RECENTER_BEHAVIOR_GUARD`
- Estimated fix risk: low
- Fix now or later: near-term

### AUDIT-006
- Severity: MEDIUM
- Category: deployment/runtime
- Affected files: `package.json`
- Evidence:
  - `package.json:6-9` contains only `dev`, `build`, `preview`; no `lint` or `test` scripts.
- Why it matters:
  - Regressions rely on manual review/build only; no standard CI quality gate.
- Recommended fix:
  - Add minimal lint/test baseline and wire into CI.
- Suggested pass: `PASS 31G — CI_LINT_TEST_BASELINE`
- Estimated fix risk: low/medium
- Fix now or later: near-term

### AUDIT-007
- Severity: MEDIUM
- Category: code-cleanup
- Affected files: `src/hooks/useSettings.js`, `src/hooks/useSavedPlaces.js`, `src/components/SeadedTab.jsx`
- Evidence:
  - Duplicate normalization/storage logic in `useSettings.js` (`normalizePlace`, `normalizePlaces`) and `useSavedPlaces.js`.
  - Duplicate unresolved geocoding stubs in both hooks (`resolvePlaceAddress` message path).
  - `SeadedTab` keeps fallback hook plumbing (`useSettings`) despite top-level props flow.
- Why it matters:
  - Increases drift risk and future bug surface during bus/place updates.
- Recommended fix:
  - Consolidate place storage + geocoding contract into one hook/service.
- Suggested pass: `PASS 31H — SAVED_PLACE_HOOK_CONSOLIDATION`
- Estimated fix risk: medium
- Fix now or later: later (after security/perf)

### AUDIT-008
- Severity: LOW
- Category: security/privacy
- Affected files: `src/hooks/useDiary.js`, `src/components/SeadedTab.jsx`
- Evidence:
  - `useDiary.js:13` uses `atob` and `:16` uses `btoa` for PIN.
  - Diary entries and PIN metadata are stored in plain localStorage.
- Why it matters:
  - Local device access can trivially recover PIN and diary content.
- Recommended fix:
  - Consider Web Crypto-based local encryption or explicit “device-only, not secure” disclosure.
- Suggested pass: `PASS 31I — DIARY_LOCAL_PRIVACY_HARDENING`
- Estimated fix risk: medium
- Fix now or later: later

### AUDIT-009
- Severity: LOW
- Category: UX
- Affected files: `src/components/SeadedTab.jsx`, `src/hooks/useSettings.js`, `src/hooks/useSavedPlaces.js`
- Evidence:
  - `SeadedTab.jsx:145` CTA `Leia asukoht` suggests active geocoding.
  - Hooks currently return static not-connected response (`Aadressi otsing pole veel ühendatud`).
- Why it matters:
  - Misleading action flow and repeated failed attempts for users.
- Recommended fix:
  - Either hide/disable CTA until geocoding is active or implement real provider.
- Suggested pass: `PASS 31J — PLACE_GEOCODE_UI_STATE_FIX`
- Estimated fix risk: low
- Fix now or later: near-term

### AUDIT-010
- Severity: LOW
- Category: data-integrity
- Affected files: `src/data/busData.js`
- Evidence:
  - `src/data/busData.js:9645-9654` embeds absolute local source paths in `meta` (`C:/Users/Kasutaja/Desktop/...`).
- Why it matters:
  - Leaks developer workstation path metadata into runtime bundle/source artifact.
- Recommended fix:
  - Strip or sanitize path metadata during data-generation export.
- Suggested pass: `PASS 31K — BUSDATA_META_SANITIZE`
- Estimated fix risk: low
- Fix now or later: later

### AUDIT-011
- Severity: INFO
- Category: data-integrity
- Affected files: `src/data/busData.js`, `src/data/gtfsStopCoords.js`, `src/data/stopLineMap.js`, `src/data/routeShapes.js`
- Evidence:
  - Scripted checks show consistent references: no missing stop IDs across these layers in current build snapshot.
- Why it matters:
  - Confirms current GTFS + line + shape layers are internally coherent.
- Recommended fix:
  - Keep consistency check script in future data passes.
- Suggested pass: `PASS 31L — DATA_LAYER_CONSISTENCY_CHECK_AUTOMATION`
- Estimated fix risk: low
- Fix now or later: later

## Positive findings
- Protected bus-engine boundary is respected: `depsWithMeta` and `nearest` remain centralized in `src/utils/bus.js`.
- GTFS stop-point coordinate layer is wired and used for map/nearest behavior.
- Map rendering lifecycle includes cleanup (`map.remove()`, layer refs reset, RAF cancel) and avoids full map reinit on transient UI state.
- Provider fallback chain in Üllata is resilient (`Gemini -> OpenAI -> local`) with timeout protection.
- Build passes successfully on current HEAD.

## Recommended patch queue

### Security
1. `PASS 31B — ULLATA_API_ABUSE_GUARDS`
2. `PASS 31D — ULLATA_PROMPT_INPUT_GUARDRAILS`
3. `PASS 31I — DIARY_LOCAL_PRIVACY_HARDENING`

### Correctness
1. `PASS 31F — MAP_RECENTER_BEHAVIOR_GUARD`
2. `PASS 31J — PLACE_GEOCODE_UI_STATE_FIX`

### Performance
1. `PASS 31C — MAP_CODE_SPLIT_AND_DATA_LAZY_LOAD`
2. optional follow-up: additional mobile map profiling if jank persists after code-split

### UX polish
1. `PASS 31E — HOME_CARD_GPS_CONSENT_TRIGGER`
2. `PASS 31J — PLACE_GEOCODE_UI_STATE_FIX`

### Cleanup
1. `PASS 31H — SAVED_PLACE_HOOK_CONSOLIDATION`
2. `PASS 31K — BUSDATA_META_SANITIZE`

### Docs/update
1. after fixes are accepted, do one docs refresh pass only (state + impact map + truth index)

## What NOT to do
- Do not do a broad refactor of bus routing while addressing these findings.
- Do not rewrite `depsWithMeta` unless a dedicated locked pass explicitly targets route-engine logic.
- Do not overwrite `src/data/busData.js` timetable content as part of perf/security fixes.
- Do not mix Üllata API security hardening with map rendering refactors in one pass.
- Do not combine runtime fixes and docs refresh in the same implementation pass unless strictly required.
