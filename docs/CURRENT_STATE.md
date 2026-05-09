# CURRENT_STATE

Status: compact low-token state snapshot for future Codex passes.

## Repo

- branch: `main`
- canonical app URL: `https://annivibe.pages.dev`
- Cloudflare Pages project: `annivibe`
- build command: `npm run build`
- deploy command: `npx wrangler pages deploy dist --project-name annivibe`

## Accepted runtime features

- destination-first bus flow is active in `BussTab`
- route cards include:
  - `Mine peatusesse`
  - `Sõida liiniga`
  - `Välju peatuses`
- POI/place-first destination search is wired in `BussTab`
- popular place chips are active in bus destination UI
- map destination picker is integrated in `BussTab` via `BusMapPicker`
- GTFS stop-point coordinate layer exists in `src/data/gtfsStopCoords.js`
- `nearest(...)` and `BusMapPicker` prefer GTFS stop-point coords by stopId
- `src/data/busData.js` was not overwritten during GTFS coordinate wiring
- PASS `27F2` is accepted/live
- PASS `28A` direct-route candidate-search planning is completed (docs-only)
- PASS `28B` direct-route candidate-search MVP is deployed/smoked
- map picker UX design spec saved: `docs/audit/map-picker-ux-design-spec.md`
- PASS `28C_UI_MAP_PICKER_LAYOUT` is implemented, committed, and deployed/smoked
- PASS `28D_MAP_MARKER_VISUALS` is implemented, committed, and deployed/smoked
- PASS `28E_MAP_CONTEXT_MARKERS` is implemented, committed, and deployed/smoked
- PASS `28F_MAP_LINE_COLOR_DATA_LAYER` is live (`src/data/stopLineMap.js`)
- PASS `28G_MAP_LINE_BADGE_MARKERS` is live
- PASS `28H_MAP_LINE_FILTER` is live
- PASS `28I_ROUTE_GEOMETRY_SOURCE_DISCOVERY` is completed
- PASS `28J_MAP_ROUTE_HIGHLIGHT_BY_DIRECTION` is live
- PASS `MAP_SMOOTHNESS` + `MAP_VISUAL_LOAD_TUNING` are live
- map picker now opens as full-screen modal/overlay with bottom-sheet decision UI
- map decision states include:
  - `Lähim peatus sihtkohale`
  - `Mitu peatust on lähedal`
- map confirm action is:
  - `Kasuta seda sihtkohta`
- raw coordinate UX copy is removed from normal flow
- map context markers are active:
  - `Minu asukoht` (currentPosition)
  - `Lähim peatus` (effectiveOrigin context)
- map line filter control is active:
  - `Kõik | 1 | 2 | 3 | 5`
  - default: `Kõik`
  - selected line highlights relevant stops
  - unrelated stops fade, not disappear
  - multi-line stops remain visible if they serve selected line
- direct-route candidate matrix search is active in `BussTab` (origin x destination)
- transfer routing is not implemented yet
- map line color data layer is implemented (`STOP_TO_LINES`, `LINE_COLORS`, `LINE_PATTERNS`)
- line badges are implemented in `BusMapPicker`
- route highlight by direction is live in `BusMapPicker`
- route line uses GTFS shape points (`src/data/routeShapes.js`), not synthetic stop-to-stop lines
- line 3 and line 5 expose direction selector in map UI
- line 1 and line 2 auto-select their single available pattern
- map smoothness tuning is live:
  - `preferCanvas` enabled
  - marker style updates are batched via `requestAnimationFrame`
  - line-badge threshold is `LINE_BADGE_MIN_ZOOM = 17`
  - when a line filter is active, unrelated stops stay faded but do not render badges
  - route polyline visual load reduced with lower weight/opacity and `smoothFactor`
  - performance is improved, but additional tuning may still be needed if jank returns on target devices
- geocoding is not implemented
- Õie/Tulika coordinate smoke improved (Õie now resolves around ~8 m vs earlier large drift)
- Üllata provider chain is `Gemini -> OpenAI -> local`
- PASS `31B` Ullata API abuse guards are accepted/live and deployed/smoked
- `AUDIT-001` (Ullata public abuse/cost guard gap) is addressed in runtime
- Ullata API guardrails now include:
  - max body-size validation (`Content-Length` + actual bytes)
  - prompt/systemPrompt length limits
  - safe `400` on invalid JSON or oversized/invalid request shape
  - safe `429` rate limit with `Retry-After`
  - provider fallback order preserved (`Gemini -> OpenAI -> local`)
  - no raw provider error leakage to client
- Üllata save persistence uses localStorage key `annivibe_saved_ideas`
- build/deploy workflow for Cloudflare Pages is documented and in use

## Current bus architecture

- primary prompt is destination-first: `Kuhu soovid minna?`
- effective origin model:
  - `effectiveOrigin = manualOriginOverride ?? currentOrigin`
- route engine remains:
  - `depsWithMeta(...)`
- coordinate-to-stop resolver remains:
  - `nearest(...)`
- GTFS coordinate precedence for stop points:
  - `GTFS_STOP_COORDS_BY_ID[stopId] -> BUS_DATA.by_code[stopId] -> legacy fallback`
- origin code resolution is protected:
  - `displayCodes || codes || [code]`
- nearby candidate logic remains active
- map pin destination flow remains active and feeds destination candidates
- route-card intent is:
  - walk to origin stop
  - take line
  - get off at destination stop

## POI/place direction

- users should search places, not internal stop names
- stop-name search remains fallback/advanced path
- current implementation state:
  - POI dataset is active input for enabled place search
  - place-search UI is implemented in `BussTab`
  - map picker is implemented as destination input aid
- map is an input aid, not a new routing engine

## Future direction (not active scope)

- future product direction may include extracting the bus module into a standalone dedicated app
- this is not current implementation scope
- current scope remains stabilizing and field-testing the bus module inside AnniVibe first
- future planning reference:
  - `docs/audit/bus-module-extraction-future-plan.md`

## Protected boundaries

- do not rewrite `depsWithMeta(...)` casually
- do not rewrite `nearest(...)` casually
- do not remove `displayCodes || codes || [code]` fallback
- do not remove Õie/Tulika nearby behavior
- do not remove Kivi/Kesk sibling-code behavior
- do not mix bus work with Üllata/API work
- do not add map inside non-map pass
- do not touch runtime in docs-only pass

## Agent workflow

- Human/user: final acceptance, field testing, deploy approval
- ChatGPT: scope controller, prompt writer, reviewer
- Claude: architecture and edge-case planner
- Qwen/Ollama: low-cost reviewer / patch drafter
- Codex: real repo edits, build/deploy/status execution

## Default future Codex read-first rule

For most passes, read only:
- `AGENTS.md`
- `docs/CURRENT_STATE.md`
- pass-specific files listed in the prompt

Expand reads only when the prompt explicitly requires it.

Use these docs to decide read/touch/validate boundaries:
- `docs/CODEBASE_IMPACT_MAP.md`
- `docs/PROTECTED_SURFACES.md`

Sniper Matrix visual asset:
- `docs/assets/annivibe-sniper-matrix.png`
- source of truth remains `docs/CODEBASE_IMPACT_MAP.md`

## Next likely passes

- `PASS 31C — MAP_CODE_SPLIT_AND_DATA_LAZY_LOAD`
- field testing / on-device performance validation
- `MAP_VISUAL_LOAD_TUNING_2` only if jank reappears on target devices

## Known deploy notes

- Wrangler/Cloudflare can occasionally fail with `10500` / `503`
- canonical/PWA cache can briefly show an older bundle
- after deploy, verify canonical HTML bundle asset
- recovery details are in `docs/DEPLOYMENT.md`
