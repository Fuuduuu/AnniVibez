# AUDIT_FINDINGS_BACKLOG.md

Status: pending/planned findings backlog from Claude audit.  
This file is planning only. No fixes are marked as done here.

## Scope rules for future fixes

- Fix one narrow pass at a time.
- Do not mix bus logic and provider/runtime refactors in one pass.
- Do not rewrite `depsWithMeta(...)` unless explicitly unlocked.
- Do not turn AnniVibe into a generic Peatus.ee clone.
- Keep focus on small-city Estonian bus UX:
  - direction clarity
  - nearby/opposite-side pairing
  - ring-line handling
  - county-lines-as-city-lines mapping
  - city-specific normalisation

## Confirmed positives

- `depsWithMeta` core logic is mostly correct:
  - sequence-based direction check
  - service filtering
  - deduplication
- `nearest()` Haversine logic works.
- Õie↔Tulika nearby pairing exists.
- GPS -> candidate UI flow in `BussTab` is logical.
- `emptyReason` provides distinguishable reasons.
- Üllata 4-step flow works (navigation/loading/back).
- Cloudflare Pages Functions routing shape is correct.
- API responses use `Cache-Control: no-store`.
- PWA manifest and VitePWA config are usable.
- `useSavedPlaces` normalisation/localStorage handling is robust.
- Estonian UI wording is mostly clear.

## Pending findings

### HIGH - Bus logic - sibling/displayCodes ignored in some paths

Status: resolved in PASS 17 / validated in PASS 18  
Impact: near Kivi/Kesk users may see only one direction.

Details:
- some calls still use only `stop.code` or one code
- sibling pairs:
  - Kivi: `5900286-1`, `5900287-1`
  - Kesk: `5900229-1`, `5900230-1`

Implemented:
- departures origin codes now use `displayCodes || codes || [code]` in target UI paths
- manual origin change now resets destination in `BussTab`
- `depsWithMeta(...)` rewrite was not done
- destination sequence logic was not changed

### HIGH - Üllata/API - Gemini/OpenAI fallback policy ambiguity

Status: resolved in PASS 22  
Impact: provider strategy is unclear; resilience assumptions may be wrong.

Implemented:
- provider fallback policy is explicit:
  - `Gemini -> OpenAI -> local`
- if Gemini fails/timeouts and OpenAI key exists, OpenAI is now attempted
- if both providers fail/missing, local fallback is returned
- timeout helper (`8000ms`) preserved
- `variationNonce` in local fallback preserved

Completed pass: `PASS 22 — PROVIDER_FALLBACK_CHAIN`

### HIGH - Üllata UX - "Salvesta" false affordance

Status: resolved in PASS 19_MAIN  
Impact: user sees saved state, but idea is not persisted.

Implemented:
- persist saved ideas to localStorage key `annivibe_saved_ideas`
- prevent duplicate save append for same current idea
- recover safely from corrupt saved-ideas JSON with `[]`
- reset saved affordance when a new/obsolete idea state appears

Completed pass: `PASS 19_MAIN — ULLATA_SAVE_LOCALSTORAGE_ON_MAIN_REPO`

### MEDIUM - Üllata/API - provider fetch timeout missing

Status: resolved in PASS 20  
Impact: long hangs/spinners if provider stalls.

Implemented:
- added timeout-protected provider helper with `AbortController`
- timeout value: `8000ms`
- wired timeout protection into both:
  - Gemini provider fetch
  - OpenAI provider fetch
- fallback policy/priority unchanged in this pass (no chain rewrite)
- local fallback behavior preserved

Completed pass: `PASS 20 — ULLATA_PROVIDER_TIMEOUT`

### MEDIUM - Bus UX - destination not reset when origin changes

Status: resolved in PASS 17 / validated in PASS 18  
Impact: stale destination can show confusing "no valid direction" message.

Implemented:
- on manual origin change in `BussTab`, `setDestination('')` is called

### HIGH - Bus UX direction - destination-first flow

Status: PASS 23B MVP validated in PASS 23C; PASS 23D planning completed  
Impact: current origin-first flow adds friction; primary user intent is destination.

Locked direction:
- primary UX question:
  - `Kuhu soovid minna?`
- flow target:
  - destination first -> auto/current/manual origin -> show how to get there
- recommendation target output:
  - best nearby origin stop
  - line
  - direction
  - departure time
  - nearby alternative stops when useful
- routing engine note:
  - keep `depsWithMeta(...)` as initial routing engine
- map note:
  - no map in MVP
  - map destination picker is later phase only

Implemented in PASS 23B:
- destination-first render order in `BussTab`
- destination chooser promoted to primary prompt (`Kuhu soovid minna?`)
- effective origin model: `manualOriginOverride ?? currentOrigin`
- manual origin override toggle added
- route wrapper added in `BussTab`:
  - reuses `depsWithMeta(...)` as-is
  - keeps `displayCodes || codes || [code]` origin-code handling
  - tries up to 2 nearby origins if primary origin has no departures
- route cards now include origin context (line/direction/time + origin stop context)
- no map UI added in this pass
- `src/utils/bus.js` was not changed in this pass

Validated in PASS 23C:
- `npm run build` passed
- live smoke deploy:
  - `https://968d08cb.annivibe.pages.dev`
- canonical URL served destination-first bundle:
  - `assets/index-DjBNfPlr.js`
- `/api/ullata` smoke returned `source=gemini`
- checkpoint-ready status recorded

Planned in PASS 23D:
- map picker architecture is documented in:
  - `docs/BUS_MAP_PICKER_PLAN.md`
- map picker remains a destination-input wrapper for existing destination-first flow
- no separate routing engine is allowed
- no runtime map implementation added in this pass
- next implementation chain is locked in that plan:
  - `PASS 25A` ... `PASS 25F`

Locked implementation order:
1. `PASS 23A — BUS_DESTINATION_FIRST_UX_PLAN` (docs-only)
2. `PASS 23B — BUS_DESTINATION_FIRST_MVP_NO_MAP` (implemented)
3. `PASS 23C — DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP` (validated)
4. `PASS 23D — BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY` (completed, docs-only)
5. then continue deferred non-bus pending items

### MEDIUM - Code quality - duplicated local fallback idea generator

Status: pending  
Impact: frontend/backend fallback generators can drift.

Future review:
- deduplicate only if low risk
- or keep backend authoritative and remove duplicate frontend fallback

Planned pass: `PASS 23 — ULLATA_FALLBACK_DEDUP_REVIEW`

### MEDIUM - Üllata local fallback variation

Status: resolved in PASS 21  
Impact: `Uus idee` can repeat deterministic fallback for same input.

Implemented:
- frontend now sends `variationNonce` in Üllata generation payload
- backend local fallback seed now includes `variationNonce`
- frontend local fallback seed also includes `variationNonce`
- same nonce is deterministic; different nonce can vary output
- avoided backend-only `Date.now()` randomness

Completed pass: `PASS 21 — ULLATA_LOCAL_VARIATION_NONCE`

### MEDIUM/LOW - OpenAI Responses API stability note

Status: pending  
Impact: revisit only if OpenAI becomes required active fallback.

### LOW - Bus data quality - Aiand coordinates missing

Status: pending  
Impact: data inconsistency (likely non-crashing).

Future action:
- hide from selectable groups until coordinates exist, or mark as coordinate-missing

### LOW - Naming/readability - `hav(a,b,c,e)`

Status: pending  
Future action:
- rename helper params to `lat1, lon1, lat2, lon2`

### LOW - BussCard `useEffect` dependency fragility

Status: pending  
Future action:
- revisit only if repeated refresh loops are observed

### LOW - Deployment docs env var section missing

Status: resolved in PASS 24  
Implemented:
- added deploy/env guide: `docs/DEPLOYMENT.md`
- added safe env sample: `.env.example`
- documented Cloudflare Pages/Wrangler build+deploy+recovery workflow
- documented provider env var names from `functions/api/ullata.js`

## Completed in this backlog line

1. `PASS 17 — BUS_DISPLAYCODES_AND_DESTINATION_RESET`
2. `PASS 18 — BUS_DISPLAYCODES_SMOKE_AND_CHECKPOINT`
3. `PASS 19_MAIN — ULLATA_SAVE_LOCALSTORAGE_ON_MAIN_REPO`
4. `PASS 20 — ULLATA_PROVIDER_TIMEOUT`
5. `PASS 21 — ULLATA_LOCAL_VARIATION_NONCE`
6. `PASS 22 — PROVIDER_FALLBACK_CHAIN`
7. `PASS 23A — BUS_DESTINATION_FIRST_UX_PLAN` (docs-only)
8. `PASS 23B — BUS_DESTINATION_FIRST_MVP_NO_MAP`
9. `PASS 23C — DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP`
10. `PASS 23D — BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY`
11. `PASS 25A — ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP`
12. `PASS 26A — PROMPT_SYSTEM_AND_MERMAID_DOCS_SYNC` (docs-only)
13. `PASS 24 — DEPLOY_ENV_DOCS` (docs-only)
14. `PASS 25B — PLACE_DESTINATION_MODEL_DOCS` (docs-only)

## Remaining implementation order

1. `PASS 26B — MERMAID_DIAGRAMS_RENDER_REVIEW` (docs-only)
2. `PASS 25C — LOCAL_POI_DATASET_RAKVERE`
3. `PASS 25D — PLACE_SEARCH_UI_NO_MAP`
4. `PASS 25E — ROUTE_RECOMMENDATION_SCORING_NO_MAP`
5. `PASS 25F — MAP_PICKER_SKELETON`
6. `PASS 25G — MAP_PIN_TO_DESTINATION_CANDIDATES`
7. `PASS 25H — LIVE_FIELD_TEST`
8. optional real mobile/GPS field testing

## This prep pass

`PASS 17_PREP — AUDIT_FINDINGS_BACKLOG_SYNC` is docs/planning only.  
No app logic fixes are included here.
