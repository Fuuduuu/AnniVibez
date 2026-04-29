# ACCEPTED_CHECKPOINTS.md

## Accepted checkpointid

### 1. Initial governance baseline
**Staatus:** accepted

Sisu:
- 4-failine minimaalne truth-layer on defineeritud
- canonical docs mudel on valitud
- Pass 1 on docs-only

### 2. Current app baseline (target direction)
**Staatus:** accepted

Sisu:
- AnniVibe v1 scope on fikseeritud:
  - Kodu
  - Buss
  - Loo
  - Päevik
  - Tugi
  - Seaded
- Trendid ja Loo oma trend on v1-st väljas
- `src/` on canonical app baseline
- `/api/ullata` route on oodatud arhitektuurne suund
- saved places shape on `{ name, address, lat, lon }`

### 3. Clean repo integrity verification (blocked baseline)
**Staatus:** accepted

Sisu:
- `npm install` succeeded
- `npm run build` failed with:
  - `[vite-plugin-pwa:build] Could not resolve entry module "index.html"`
- `index.html` is missing
- `functions/api/ullata.js` is missing
- `public/manifest.webmanifest` exists but references missing `/screenshots/kodu.png`
- repo is **not build-ready yet**

### 4. Pass 2 docs-only integrity mapping
**Staatus:** accepted

Sisu:
- `docs/CODEBASE_MAP.md` created
- `docs/CHANGE_SURFACES.md` created
- blocker state documented without code changes

### 5. Pass 3 restore build runtime baseline
**Staatus:** accepted

Sisu:
- `index.html` restored
- `functions/api/ullata.js` restored
- `npm run build` succeeded
- `git status --short` clean
- `main` is synced with `origin/main` (`0 0`)

### 6. Pass 4 manifest screenshot cleanup
**Staatus:** accepted

Sisu:
- `public/manifest.webmanifest` `screenshots` section removed
- `/screenshots/kodu.png` manifest blocker closed
- `npm run build` succeeded after change

### 7. Pass 5 mobile QA / pre-deploy smoke test
**Staatus:** accepted

Sisu:
- `npm run build` succeeded
- local dev server smoke test passed
- bottom nav passed
- `Kodu` / `Buss` / `Loo` / `Päevik` / `Tugi` / `Seaded` passed
- `Loo -> Joonistamise nipid` count `17` passed
- `Loo -> Üllata` returned idea/fallback passed
- console runtime critical errors/warnings = `0`
- GO decision recorded
- limitation: real Android Chrome same-Wi-Fi physical device smoke test was not completed in this Codex session

### 8. Pass 7 Cloudflare Pages deploy
**Staatus:** accepted

Sisu:
- Cloudflare auth worked
- Pages project `annivibe` exists
- GitHub source connected: `Fuuduuu/AnniVibez`, branch `main`
- build command: `npm run build`
- output dir: `dist`
- root dir: repo root (`/`)
- functions directory: `functions`
- production deploy succeeded
- live URL: `https://annivibe.pages.dev`
- deployment URL: `https://3a1eeec4.annivibe.pages.dev`
- live smoke test passed in mobile viewport `390x844`
- app opens
- bottom nav works
- `Kodu` / `Buss` / `Loo` / `Päevik` / `Tugi` / `Seaded` pass
- `Loo -> Joonistamise nipid` count `17` pass
- `Loo -> Üllata` returned idea/fallback pass
- `/api/ullata` POST returned JSON with `idea` and `source`
- `/api/ullata` source currently = `local`
- console errors/warnings/page errors = `0/0/0`
- GO decision recorded
- no critical deploy blockers remain

### 9. Pass 8 Mermaid docs mapping pass
**Staatus:** accepted

Sisu:
- Mermaid project mapping pass accepted
- `docs/PROJECT_MAP.md` added
- `docs/PROJECT_MINI_MAP.md` added
- commit: `825af77` (`Add Mermaid project maps`)
- scope did not change
- no code/runtime/deploy settings changed
- post-commit `git status --short` was clean

### 10. Pass 9 deploy verification + manual Wrangler deploy checkpoint
**Staatus:** accepted

Sisu:
- verification workdir: `C:\Users\Kasutaja\Desktop\AnniVibez_clean`
- `git status --short` clean
- `npm run build` succeeded
- manual Wrangler deployment URL verified:
  - `https://b9e6bc21.annivibe.pages.dev`
- production alias verified:
  - `https://annivibe.pages.dev`
- both URLs returned `200` and same frontend asset hash:
  - `assets/index-DuNsa792.js`
- `/api/ullata` POST returned JSON with:
  - `idea` (object)
  - `source` (`local`)
- current validation baseline is manual deployment `b9e6bc21`
- GO for deploy validation on manual deployment
- follow-up remains open:
  - Cloudflare Git-backed deploy path previously built old commit `165d23e`

### 11. Pass 10 Cloudflare Git-backed deploy path verification/fix
**Staatus:** accepted

Sisu:
- GitHub latest `main` commit verified:
  - `121a8e2fb1f3299f9b6046d6669a5c0c36e29ab1`
- Cloudflare Pages source verified:
  - GitHub repo `Fuuduuu/AnniVibez`
  - branch `main`
- latest production deployment verified:
  - short id `238aef14`
  - trigger `github:push`
  - status `success`
- production deployment used latest `main` commit:
  - `121a8e2fb1f3299f9b6046d6669a5c0c36e29ab1`
- future automatic deploys: `GO`
- manual Wrangler deploy remains fallback only
- old commit drift issue (`165d23e`) is downgraded from active blocker to monitor-only history note

### 12. Pass 11 BUS_LOGIC_PASS destination/upcoming sequence logic
**Staatus:** accepted

Sisu:
- files changed:
  - `src/utils/bus.js`
  - `src/components/BussTab.jsx`
- `depsWithMeta` added
- `deps` remains backward-compatible
- destination can resolve from group/name/stopId to stopIds
- valid route rule:
  - origin and destination in same pattern/context AND destination `seq >` origin `seq`
- clear empty reason added
- manual stop selection preserves stopId-based origin
- `npm run build` succeeded
- validation cases passed:
  - no destination selected preserved
  - Piira -> Näpi departures shown
  - Kauba -> Bussijaam gives clear invalid direction reason
  - Õie/Tulika stopIds remain distinct
- untouched:
  - App
  - Loo
  - Päevik
  - Tugi
  - Seaded
  - `/api/ullata`
  - deploy config
  - design tokens
  - Trends
- pass is accepted/checkpointable

### 13. Pass 12 QA_PASS live bus smoke after Cloudflare auto-deploy
**Staatus:** accepted

Sisu:
- deploy/commit check:
  - latest `main` commit: `00f7ab1a61ee9b6fc393cca63a7355425140dd5d`
  - production deploy: `d7b76b63`
  - deployment URL: `https://d7b76b63.annivibe.pages.dev`
  - trigger: `github:push`
  - status: `success`
  - deploy commit matched latest `main`
- live URLs:
  - `https://annivibe.pages.dev` -> `200`
  - `https://d7b76b63.annivibe.pages.dev` -> `200`
- both URLs served same asset bundle:
  - `assets/index-wD-CtbNR.js`
- buss smoke cases passed:
  - no destination selected preserved
  - valid origin -> destination by group/name (Piira -> Näpi) returned departures
  - destination by stopId (Piira -> `5900508-1`) returned departures
  - invalid direction (Kauba -> Bussijaam) returned `count=0` + clear reason
  - manual origin stopId case passed
  - no valid upcoming destination case passed with clear time-based reason
  - Õie/Tulika stopIds remained distinct
- empty/invalid state message confirmed clear:
  - `Valitud suunas sobivat liini ei leitud`
- `npm run build` succeeded
- no runtime/code files changed in PASS 12
- pass accepted/checkpointable

### 14. Pass 14B GEMINI_RUNTIME_PROVIDER
**Staatus:** accepted

Sisu:
- minimal Gemini provider support added in:
  - `functions/api/ullata.js`
- endpoint remained POST-only
- `Cache-Control: no-store` preserved
- local deterministic fallback preserved
- provider priority:
  - `GEMINI_API_KEY` present -> `source=gemini`
  - else `OPENAI_API_KEY` present -> `source=openai`
  - else -> `source=local`
- no Üllata UI redesign/refactor
- bus files untouched:
  - `src/utils/bus.js`
  - `src/components/BussTab.jsx`
- `npm run build` succeeded
- runtime/code diff stayed narrow (`functions/api/ullata.js` only)

### 15. Pass 14C PROVIDER_RUNTIME_VERIFY
**Staatus:** accepted

Sisu:
- Cloudflare production secrets include:
  - `GEMINI_API_KEY` (encrypted)
  - `OPENAI_API_KEY` (encrypted)
- production deploy verified:
  - `https://b0876d63.annivibe.pages.dev`
- canonical URL verified:
  - `https://annivibe.pages.dev`
- `/api/ullata` on both URLs returned `source=gemini`
- repeated same payload produced different Gemini ideas:
  - `Loo oma maagiline amuletti`
  - `Maagiline unenäopüüdja`
  - `Maagiline taskuraamat`
- endpoint no longer stuck in deterministic `source=local` fallback in production
- repeated curl port parse error treated as shell parsing artifact, not API failure
- LF/CRLF warnings treated as line-ending warnings only
- pass accepted/checkpointable

### 16. Pass 16 OIE_TULIKA_NEARBY_DIRECTION
**Staatus:** accepted

Sisu:
- root cause was nearest-stop selection UX, not route filtering
- previous behavior selected one best stop-point and surfaced only that stop in UI
- changed files:
  - `src/utils/bus.js`
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
- implemented:
  - `nearest()` now returns primary stop + nearby `candidates`
  - small local Õie↔Tulika pair-rule to surface this confusing nearby/opposite-side pair
  - `BussTab` shows `Lähedal ka` options with distance and allows direct stop choice
  - `BussCard` shows `Lähedal ka` context row
- deterministic validation confirmed shared nearby context:
  - `OIE: Õie ... | Tulika ...`
  - `TULIKA: Tulika ... | Õie ...`
  - `MID: Tulika ... | Õie ...`
- `npm run build` succeeded
- untouched:
  - `functions/api/ullata.js` (Üllata/Gemini/provider code)
- `depsWithMeta(...)` logic
- destination sequence rule (`destination seq > origin seq`)
- pass accepted/checkpointable

### 17. Pass 17_PREP AUDIT_FINDINGS_BACKLOG_SYNC
**Staatus:** accepted

Sisu:
- docs/planning pass only
- Claude audit findings synced as pending backlog
- new planning doc:
  - `docs/AUDIT_FINDINGS_BACKLOG.md`
- findings were marked pending/planned, not fixed
- future fixes constrained to one narrow pass at a time
- no runtime/app logic changes in this prep pass
- pass accepted/checkpointable

### 18. Pass 17 BUS_DISPLAYCODES_AND_DESTINATION_RESET
**Staatus:** accepted

Sisu:
- changed files:
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
- fixed sibling/display code usage in departures calls:
  - origin code priority now uses `displayCodes || codes || [code]`
- destination is reset on manual origin change in `BussTab`
- preserved behavior:
  - no route sequence/filter rewrite
  - `depsWithMeta(...)` unchanged
  - `src/utils/bus.js` unchanged in this pass
  - `src/data/busData.js` unchanged in this pass
  - `functions/api/ullata.js` untouched in this pass
  - `src/components/LooTab.jsx` untouched in this pass
- pass implementation was validated in PASS 18

### 19. Pass 18 BUS_DISPLAYCODES_SMOKE_AND_CHECKPOINT
**Staatus:** accepted

Sisu:
- validation/checkpoint pass only (no new implementation)
- `npm run build` succeeded
- source/manual checks passed:
  - Kivi sibling codes present and usable:
    - `5900286-1`
    - `5900287-1`
  - Kesk sibling codes present and usable:
    - `5900229-1`
    - `5900230-1`
  - no-destination flow still returns departures
  - invalid direction still returns clear `emptyReason`
  - Õie/Tulika nearby UX remains intact
- confirmed unchanged:
  - `depsWithMeta(...)` sequence logic
  - bus data
  - Üllata/API/provider surfaces
- PASS 17 is safe to checkpoint

### 20. PASS 19_MAIN ULLATA_SAVE_LOCALSTORAGE_ON_MAIN_REPO
**Staatus:** accepted

Sisu:
- changed file:
  - `src/components/LooTab.jsx`
- Üllata `Salvesta` now persists generated idea entries to localStorage key:
  - `annivibe_saved_ideas`
- saved entry shape includes:
  - `id`
  - `createdAt`
  - `title`
  - `text`
  - `type`
  - `meta: { with, time, mood, material, source }`
- duplicate save of same idea is prevented
- corrupt JSON in saved ideas localStorage is recovered safely as `[]`
- `Uus idee` / obsolete current idea resets `savedIdea` UI state
- `npm run build` succeeded
- untouched in this pass:
  - `functions/api/ullata.js`
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
  - `src/utils/bus.js`
  - `src/data/busData.js`
- PASS 19_MAIN applied on real `main` repo baseline

### 21. PASS 20 ULLATA_PROVIDER_TIMEOUT
**Staatus:** accepted

Sisu:
- changed file:
  - `functions/api/ullata.js`
- provider fetch timeout hardening added with helper:
  - `fetchWithTimeout(url, options, timeoutMs = 8000)`
- timeout mechanism:
  - `AbortController` signal passed into provider fetch
  - timeout timer cleared in `finally`
- wired in both provider calls:
  - `generateWithGemini(...)`
  - `generateWithOpenAI(...)`
- preserved behavior:
  - same request body/headers/json parsing/normalization
  - same provider priority/policy (`GEMINI -> local`, else `OPENAI -> local`)
  - no Gemini -> OpenAI chain added in this pass
  - local fallback path remains
- `npm run build` succeeded
- untouched in this pass:
  - `src/components/LooTab.jsx`
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
  - `src/utils/bus.js`
  - `src/data/busData.js`

### 22. PASS 21 ULLATA_LOCAL_VARIATION_NONCE
**Staatus:** accepted

Sisu:
- changed files:
  - `src/components/LooTab.jsx`
  - `functions/api/ullata.js`
- frontend now sends `variationNonce` with Üllata generation request
- `Uus idee` now increments nonce each generation request
- backend payload normalization now includes `variationNonce`
- backend local fallback seed now includes `variationNonce`
- behavior validation:
  - same input + same nonce => deterministic same fallback output
  - same input + different nonce => fallback can vary when template space allows
- preserved behavior:
  - PASS 19 save localStorage logic remains intact
  - PASS 20 timeout helper remains intact (`PROVIDER_TIMEOUT_MS = 8000`, `fetchWithTimeout(...)`)
  - provider priority/policy unchanged (no Gemini -> OpenAI chain in this pass)
- `npm run build` succeeded
- untouched in this pass:
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
  - `src/utils/bus.js`
  - `src/data/busData.js`

### 23. PASS 22 PROVIDER_FALLBACK_CHAIN
**Staatus:** accepted

Sisu:
- changed file:
  - `functions/api/ullata.js`
- provider fallback policy is now explicit:
  - `Gemini -> OpenAI -> local`
- behavior:
  - if Gemini succeeds -> `source=gemini`
  - if Gemini fails/timeouts and OpenAI key exists -> OpenAI is attempted
  - if OpenAI succeeds -> `source=openai`
  - if both providers fail/missing -> local fallback `source=local`
- preserved behavior:
  - PASS 20 timeout helper unchanged (`PROVIDER_TIMEOUT_MS = 8000`, `fetchWithTimeout(...)` on both providers)
  - PASS 21 variationNonce unchanged (normalized + included in local fallback seed)
  - response shape unchanged
  - no raw provider errors exposed to user
- `npm run build` succeeded
- lightweight mock/provider-order validation passed:
  - `both_keys_gemini_fail_openai_ok -> source=openai`
  - `both_keys_gemini_ok -> source=gemini`
  - `gemini_missing_openai_ok -> source=openai`
  - `both_missing_or_fail -> source=local`
- untouched in this pass:
  - `src/components/LooTab.jsx`
  - `src/components/BussTab.jsx`
  - `src/components/BussCard.jsx`
  - `src/utils/bus.js`
  - `src/data/busData.js`

### 24. PASS 23A BUS_DESTINATION_FIRST_UX_PLAN
**Staatus:** accepted (docs-only)

Sisu:
- docs-only pass; code changes were not made
- destination-first Bus UX direction locked:
  - primary question: `Kuhu soovid minna?`
  - flow target: destination first -> auto/current/manual origin -> route recommendation
- MVP constraints locked:
  - keep existing `depsWithMeta(...)` as initial routing engine
  - no map in MVP
- locked future order:
  1. destination-first MVP without map
  2. destination-first `BussTab` state flow implementation
  3. Rakvere validation
  4. map destination picker later
- pass is checkpointable as docs-direction lock

### 25. PASS 23B BUS_DESTINATION_FIRST_MVP_NO_MAP
**Staatus:** accepted

Sisu:
- changed file:
  - `src/components/BussTab.jsx`
- destination-first Bus MVP implemented:
  - destination chooser is primary (`Kuhu soovid minna?`)
  - effective origin is `manualOriginOverride ?? currentOrigin`
  - manual origin override is toggleable (`Muuda lähtekoht`)
- wrapper behavior added in `BussTab`:
  - uses `depsWithMeta(...)` as routing engine
  - preserves origin code handling: `displayCodes || codes || [code]`
  - tries up to 2 nearby origin candidates if primary origin has no departures
  - merges/sorts/deduplicates route options with origin context
- empty states added/kept for destination-first flow:
  - `Vali sihtkoht, et näha marsruute`
  - `Vali lähtekoht, et näha marsruute`
  - `Vali erinev sihtkoht`
- `npm run build` succeeded
- untouched in this pass:
  - `src/utils/bus.js`
  - `src/data/busData.js`
  - `src/components/BussCard.jsx`
  - `src/components/LooTab.jsx`
  - `functions/api/ullata.js`
- no map implementation was added in this pass

### 26. PASS 23C DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP
**Staatus:** accepted

Sisu:
- validation/docs/commit-prep pass (no new runtime implementation)
- `npm run build` succeeded
- live smoke deploy verified:
  - `https://968d08cb.annivibe.pages.dev`
- canonical URL verified:
  - `https://annivibe.pages.dev`
  - served bundle `assets/index-DjBNfPlr.js`
- `/api/ullata` POST returned `source=gemini`
- destination-first checks confirmed in `BussTab`:
  - primary destination prompt `Kuhu soovid minna?`
  - `manualOriginOverride ?? currentOrigin`
  - `displayCodes || codes || [code]`
  - nearby fallback capped to 2 candidates
- unchanged/guarded surfaces:
  - `depsWithMeta(...)` remained unchanged
  - `src/data/busData.js` remained unchanged
- no map implementation added
- PASS 23B is checkpoint-ready for commit

### 27. PASS 23D BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY
**Staatus:** accepted (docs-only)

Sisu:
- docs/planning pass only; runtime code was not changed
- map picker architecture direction documented in:
  - `docs/BUS_MAP_PICKER_PLAN.md`
- locked rule:
  - map picker must feed existing destination-first flow
  - no separate routing engine is allowed
- locked phased plan:
  - `PASS 25A — ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP`
  - `PASS 25B — TYPED_STOP_SEARCH`
  - `PASS 25C — DESTINATION_POINT_AND_CANDIDATE_STATE_PREP`
  - `PASS 25D — LEAFLET_MAP_PICKER_SKELETON`
  - `PASS 25E — MAP_PICKER_INTEGRATION`
  - `PASS 25F — MAP_ROUTE_LIVE_SMOKE`
- guardrails preserved:
  - `depsWithMeta(...)` unchanged
  - `src/utils/bus.js` unchanged
- `src/data/busData.js` unchanged
- no map UI implementation added

### 28. PASS 25A ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP
**Staatus:** accepted

Sisu:
- narrow runtime enrichment in `src/components/BussTab.jsx`
- route cards now include destination/get-off context:
  - `Mine peatusesse: [origin]`
  - `Sõida liiniga: [line]`
  - `Välju peatuses: [selected destination]`
- destination label uses selected destination group/name (no fake destination walking distance)
- accepted destination-first behavior stayed intact:
  - `manualOriginOverride ?? currentOrigin`
  - destination-first render order and empty states
  - nearby-origin fallback up to 2 candidates
  - sibling-code handling via `displayCodes || codes || [code]`
- guardrails preserved:
  - `depsWithMeta(...)` unchanged
  - `src/utils/bus.js` unchanged
  - `src/data/busData.js` unchanged
  - no map implementation added
- validation:
  - `npm run build` passed
  - no `dist/*` git noise remained

### 29. PASS 26A PROMPT_SYSTEM_AND_MERMAID_DOCS_SYNC
**Staatus:** accepted (docs-only)

Sisu:
- Tehnika-style prompt governance dokumenteeriti:
  - `docs/PROMPT_SYSTEM.md`
- prompt mallid sünkrooniti PASS-põhiste placeholder-mallidega:
  - `docs/PROMPT_TEMPLATES.md`
- Mermaid diagram opportunity + starter diagram docs lisati:
  - `docs/MERMAID_DIAGRAMS.md`
- minimal docs index sync:
  - `docs/TRUTH_INDEX.md`
- runtime/source/deploy loogikat ei muudetud
- map implementationit ei lisatud

## Accepted not-yet-done areas

Need on teadaolevad puuduvad või lõpetamata osad, aga ei ava automaatselt uut scope’i:

- optional real Android Chrome same-Wi-Fi physical-device smoke remains recommended
- optional docs-only setup note for server-side secret handling
- stop-point coordinates may be partly generalized; exact road-side precision depends on source data quality
- Claude audit pending backlog is tracked in `docs/AUDIT_FINDINGS_BACKLOG.md`
- remaining pending audit items:
  - PASS 26B — MERMAID_DIAGRAMS_RENDER_REVIEW
  - PASS 25B — TYPED_STOP_SEARCH
  - PASS 25C — DESTINATION_POINT_AND_CANDIDATE_STATE_PREP
  - PASS 25D — LEAFLET_MAP_PICKER_SKELETON
  - PASS 25E — MAP_PICKER_INTEGRATION
  - PASS 25F — MAP_ROUTE_LIVE_SMOKE
  - PASS 24 — DEPLOY_ENV_DOCS
  - optional real mobile/GPS field testing

## Rejected / quarantine

### 1. Trends in v1
**Staatus:** rejected current scope jaoks

Põhjus:
- teadlikult v1-st väljas
- scope drift risk

### 2. Broad refactor / backend direction rewrite
**Staatus:** quarantine

Põhjus:
- vastuolus kitsa-passilise töökorraldusega
- nõuab eraldi locki

## Praegune aktiivne faas

- Pass 17 BUS_DISPLAYCODES_AND_DESTINATION_RESET completed
- Pass 18 BUS_DISPLAYCODES_SMOKE_AND_CHECKPOINT completed
- Pass 19_MAIN ULLATA_SAVE_LOCALSTORAGE_ON_MAIN_REPO completed
- Pass 20 ULLATA_PROVIDER_TIMEOUT completed
- Pass 21 ULLATA_LOCAL_VARIATION_NONCE completed
- Pass 22 PROVIDER_FALLBACK_CHAIN completed
- Pass 23A BUS_DESTINATION_FIRST_UX_PLAN completed (docs-only)
- Pass 23B BUS_DESTINATION_FIRST_MVP_NO_MAP completed
- Pass 23C DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP completed
- Pass 23D BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY completed (docs-only)
- Pass 25A ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP completed
- Pass 26A PROMPT_SYSTEM_AND_MERMAID_DOCS_SYNC completed (docs-only)
- järgmine on PASS 25B TYPED_STOP_SEARCH

## Järgmine lubatud samm

- PASS 25B: TYPED_STOP_SEARCH
- focus:
  - typed destination/stop search over known stop/group names
  - keep existing routing engine stable (`depsWithMeta(...)` baseline)
- rules:
  - no bus engine rewrite in this pass
  - no map picker implementation in this pass
- no broad runtime refactor
  - no redesign/refactor
  - no new feature scope
- no feature work
- no Trends
- no redesign
- no broad refactor
- no secrets in repo

## Implementation pass status

- Pass 14B GEMINI_RUNTIME_PROVIDER accepted and closed
- Pass 14C PROVIDER_RUNTIME_VERIFY accepted and closed
- Pass 16 OIE_TULIKA_NEARBY_DIRECTION accepted and closed
- Pass 17_PREP AUDIT_FINDINGS_BACKLOG_SYNC accepted and closed
- Pass 17 BUS_DISPLAYCODES_AND_DESTINATION_RESET accepted and closed
- Pass 18 BUS_DISPLAYCODES_SMOKE_AND_CHECKPOINT accepted and closed
- Pass 19_MAIN ULLATA_SAVE_LOCALSTORAGE_ON_MAIN_REPO accepted and closed
- Pass 20 ULLATA_PROVIDER_TIMEOUT accepted and closed
- Pass 21 ULLATA_LOCAL_VARIATION_NONCE accepted and closed
- Pass 22 PROVIDER_FALLBACK_CHAIN accepted and closed
- Pass 23A BUS_DESTINATION_FIRST_UX_PLAN accepted and closed (docs-only)
- Pass 23B BUS_DESTINATION_FIRST_MVP_NO_MAP accepted and closed
- Pass 23C DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP accepted and closed
- Pass 23D BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY accepted and closed (docs-only)
- Pass 25A ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP accepted and closed
- Pass 26A PROMPT_SYSTEM_AND_MERMAID_DOCS_SYNC accepted and closed (docs-only)
- broad implementation pass ilma kitsa lockita: keelatud
