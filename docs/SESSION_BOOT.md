# SESSION_BOOT.md

Status: operational session entrypoint for AnniVibe.

## Project

AnniVibe is a live Android-first / PWA creative app for a 10-13-year-old user.

Live:
https://annivibe.pages.dev

## Current state

Latest accepted baseline:
- Cloudflare Git-backed deploy verified working
- Cloudflare manual Wrangler deploy fallback verified
- app live and smoke-tested
- pattern-aware Rakvere bus data added
- nearest bus stop now uses stop-points, not group centroid
- destination/upcoming sequence logic completed
- PASS 12 QA_PASS live bus smoke completed and accepted
- PASS 14B GEMINI_RUNTIME_PROVIDER completed and accepted
- PASS 14C PROVIDER_RUNTIME_VERIFY completed and accepted
- PASS 16 OIE_TULIKA_NEARBY_DIRECTION completed and accepted
- PASS 17 BUS_DISPLAYCODES_AND_DESTINATION_RESET completed and accepted
- PASS 18 BUS_DISPLAYCODES_SMOKE_AND_CHECKPOINT completed and accepted
- PASS 19_MAIN ULLATA_SAVE_LOCALSTORAGE_ON_MAIN_REPO completed and accepted
- PASS 20 ULLATA_PROVIDER_TIMEOUT completed and accepted
- PASS 21 ULLATA_LOCAL_VARIATION_NONCE completed and accepted
- PASS 22 PROVIDER_FALLBACK_CHAIN completed and accepted
- PASS 23A BUS_DESTINATION_FIRST_UX_PLAN completed and accepted (docs-only)
- PASS 23B BUS_DESTINATION_FIRST_MVP_NO_MAP completed and accepted
- PASS 23C DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP completed (validation/docs/commit-prep)
- PASS 23D BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY completed and accepted (docs-only)
- PASS 25A ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP completed and accepted
- PASS 25B PLACE_DESTINATION_MODEL_DOCS completed and accepted (docs-only)
- PASS 26A PROMPT_SYSTEM_AND_MERMAID_DOCS_SYNC completed and accepted (docs-only)
- PASS 24 DEPLOY_ENV_DOCS completed and accepted (docs-only)
- current verified provider deploy: `https://b0876d63.annivibe.pages.dev`
- current verified destination-first bus deploy: `https://968d08cb.annivibe.pages.dev`
- canonical URL `https://annivibe.pages.dev` verified with `source=gemini`
- Üllata is no longer locked to deterministic `source=local` fallback in production
- Õie/Tulika nearby-stop UX now surfaces alternatives, not one blind stop only
- PASS 16 changed files:
  - `src/utils/bus.js`
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
- route filtering was not changed (`depsWithMeta(...)` unchanged)
- `npm run build` passed after PASS 16
- PASS 17 changed files:
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
- PASS 17 fix summary:
  - departure calls now use `displayCodes || codes || [code]`
  - manual origin change resets destination
- PASS 18 validation confirmed:
  - `depsWithMeta(...)` unchanged
  - busData unchanged
  - Üllata/API/provider code untouched
- PASS 19_MAIN changed files:
  - `src/components/LooTab.jsx`
- PASS 19_MAIN fix summary:
  - Üllata `Salvesta` now persists to localStorage key `annivibe_saved_ideas`
  - duplicate save of the same idea is prevented
  - new generation/obsolete current idea resets saved-state affordance
  - provider/runtime and bus logic files stayed untouched in this pass
- PASS 20 changed files:
  - `functions/api/ullata.js`
- PASS 20 fix summary:
  - added `fetchWithTimeout(...)` helper using `AbortController`
  - provider timeout value: `8000ms`
  - Gemini/OpenAI provider calls now use timeout-protected fetch
  - fallback policy/priority was not changed in this pass
- PASS 21 changed files:
  - `src/components/LooTab.jsx`
  - `functions/api/ullata.js`
- PASS 21 fix summary:
  - Üllata generation now sends `variationNonce` with each request
  - local fallback seed now includes `variationNonce`
  - same input + same nonce remains deterministic
  - `Uus idee` now changes nonce so local fallback can vary
  - PASS 19 save flow preserved and PASS 20 timeout logic preserved
- PASS 22 changed files:
  - `functions/api/ullata.js`
- PASS 22 fix summary:
  - provider fallback chain is explicit: `Gemini -> OpenAI -> local`
  - Gemini failure/timeout now falls through to OpenAI when key exists
  - timeout helper remains active (`8000ms`)
  - `variationNonce` remains active in local fallback seed
- PASS 23A docs-only summary:
  - Bus UX direction is now locked to destination-first
  - primary UX question: `Kuhu soovid minna?`
  - MVP sequence locked:
    1) docs direction lock
    2) destination-first MVP without map
    3) BussTab destination-first state flow implementation
    4) Rakvere validation
    5) map destination picker later
  - `depsWithMeta(...)` may remain routing engine initially
- PASS 23B changed files:
  - `src/components/BussTab.jsx`
- PASS 23B summary:
  - Bus tab now renders destination-first UX (`Kuhu soovid minna?`)
  - destination select is primary and shown before origin controls
  - effective origin is `manualOriginOverride ?? currentOrigin`
  - manual origin override is toggleable (`Muuda lähtekoht`)
  - route wrapper now uses `depsWithMeta(...)` with:
    - `displayCodes || codes || [code]`
    - nearby-origin fallback attempts (up to 2 alternatives)
    - sorted/deduped route options with origin context
  - no map implementation was added in this pass
  - bus engine internals (`depsWithMeta`, `nearest`, `emptyReason`) were not changed
- PASS 23C validation summary:
  - `npm run build` passed
  - Cloudflare Pages deploy succeeded:
    - `https://968d08cb.annivibe.pages.dev`
  - canonical URL `https://annivibe.pages.dev` served bundle:
    - `assets/index-DjBNfPlr.js`
  - `/api/ullata` POST responded with `source=gemini`
  - destination-first source checks passed for:
    - `Kuhu soovid minna?` first
    - `manualOriginOverride ?? currentOrigin`
    - `displayCodes || codes || [code]`
    - nearby fallback max 2
  - `depsWithMeta(...)` remained unchanged
  - `src/data/busData.js` remained unchanged
  - PASS 23B is checkpoint-ready
  - map picker remains future work
- PASS 17_PREP audit findings backlog sync completed (docs-only)
- pending findings are tracked in `docs/AUDIT_FINDINGS_BACKLOG.md`
- map picker planning baseline is recorded in:
  - `docs/BUS_MAP_PICKER_PLAN.md`
  - includes GPS/map route recommendation layering and PASS 25A-25F plan
- PASS 25A changed files:
  - `src/components/BussTab.jsx`
- PASS 25A summary:
  - route cards now include explicit destination/get-off context
  - route rows now show:
    - `Mine peatusesse: ...`
    - `Sõida liiniga: ...`
    - `Välju peatuses: [selected destination]`
  - destination label is stop/group based (no fake destination distance added)
  - `depsWithMeta(...)` remained unchanged
  - no map implementation was added in this pass
- PASS 26A docs-only summary:
  - governance doc added: `docs/PROMPT_SYSTEM.md`
  - prompt template doc synced: `docs/PROMPT_TEMPLATES.md`
  - Mermaid plan + starter diagrams added: `docs/MERMAID_DIAGRAMS.md`
  - no runtime/source files changed
- PASS 24 docs-only summary:
  - deployment/env guide added: `docs/DEPLOYMENT.md`
  - safe env sample added: `.env.example` (names/placeholders only)
  - provider env vars documented from `functions/api/ullata.js`
  - no runtime/source/deploy execution changes in this pass
- PASS 25B docs-only summary:
  - new POI/place-first destination model documented in `docs/BUS_POI_DESTINATION_PLAN.md`
  - typed stop-name search was demoted to fallback/advanced path
  - map and POI runtime implementation deferred to future narrow passes
  - no runtime/source files changed
- prompt template system added

## Current active focus

Next likely pass:
PASS 25C — LOCAL_POI_DATASET_RAKVERE (narrow implementation, no map).

Deferred docs-only follow-up:
- PASS 26B — verify/render Mermaid diagrams and refine docs if needed

## Allowed files for next pass

- `src/components/BussTab.jsx`
- docs checkpoint files
- tiny/local change only

## Must preserve

- nearest stop-point logic
- BUS_DATA.patterns
- Õie/Tulika stopId distinction
- docs/BUS_LOGIC_LOCK.md rules

## Forbidden in next pass

- src/App.jsx
- src/components/PaeviikTab.jsx
- src/components/TugiTab.jsx
- src/components/SeadedTab.jsx
- deploy config
- design tokens
- bus logic surfaces
- Trends
- broad redesign/refactor

## Active risks

- Cloudflare Git-backed deploy old commit `165d23e` issue is historical/monitor-only.
- Manual Wrangler deploy remains fallback only.
- PASS 11, PASS 12, PASS 14B, PASS 14C, PASS 16, PASS 17_PREP, PASS 17, PASS 18, PASS 19_MAIN, PASS 20, PASS 21, PASS 22, PASS 23A, PASS 23B, PASS 23C, PASS 23D, PASS 24, PASS 25A, PASS 25B, PASS 26A are closed.
- provider runtime works, but keep fallback behavior monitored.
- stop-point coordinate precision may still be partly generalized by source data.
- Claude audit pending findings are not fixed yet; execute one narrow pass at a time.
- Do not regress busData patterns or nearest stop-point logic.

## Required reads by task

Bus work:
- docs/BUS_LOGIC_LOCK.md

Deploy/API-key work:
- docs/DEPLOYMENT.md
- docs/POST_DEPLOY_FOLLOWUPS.md

Prompt/workflow work:
- docs/PROMPT_SYSTEM.md
- docs/PROMPT_TEMPLATES.md
- docs/MERMAID_DIAGRAMS.md

Historical context only if needed:
- docs/ACCEPTED_CHECKPOINTS.md
- docs/PROJECT_MEMORY.md
- docs/TRUTH_INDEX.md

## Session-end checklist

Before ending a session:

1. Update this file with current state and next pass.
2. Update docs/ACCEPTED_CHECKPOINTS.md if a pass was accepted.
3. Check docs/ACTIVE_SCOPE_LOCK.md and update if the next pass changed.
4. Ensure git status is clean or explicitly reported.
