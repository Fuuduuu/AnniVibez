# BUS_MAP_PICKER_PLAN.md

Status: PASS 23D recovery/final planning (docs-only, no runtime implementation).

## User mental model

`Kuhu tahan minna? Naita, kuidas sinna koige moistlikumalt bussiga saan.`

## Locked architectural principle

Map and destination resolver inputs are surfaces, not a new routing engine.

Destination-first base flow stays canonical:
- destination selection
- effective origin: `manualOriginOverride ?? currentOrigin`
- route calculation via existing wrapper + `depsWithMeta(...)`

## Three-layer model

### Layer 1 - Existing engine (keep as-is)
- `depsWithMeta(origin, lim, { destination })`
- `nearest(lat, lon)`
- `findRouteOptions` wrapper in `BussTab`
- `displayCodes || codes || [code]` origin handling
- existing `emptyReason` handling

### Layer 2 - Destination resolver (new adapter layer)
`resolveDestinationPoint(input)`

Supported modes:
- local POI/place
- stop/group fallback
- map pin
- later optional saved places / POI list

### Layer 3 - Enriched recommendation card (future UI)
Route output should eventually answer:
- Mine peatusesse X
- Sõida liiniga Y
- Välju peatuses Z
- Kõnni sihtkohta W m

## Destination modes

### Mode A - stop/group name
- existing dropdown stays
- resolves via current destination logic
- no coordinate requirement

### Mode B - local POI/place search (primary)
- users should not need internal stop names
- resolve by POI label/aliases first
- map POI to preferred destination stop groups where possible
- no external geocoding in MVP
- no match copy: `Kohta ei leitud. Proovi nimekirjast või vali kaardilt.`

### Mode C - map pin
- user opens `Vali sihtkoht kaardilt`
- user taps pin
- `nearest(pinLat, pinLon)` resolves destination candidates (1-3)
- selected candidate becomes destination input for existing flow

### Mode D - stop-name fallback (advanced/manual)
- stop/group name search remains available as fallback
- this is not the primary UX path

## Critical verification note before implementation

Before map/place integration code work:
1. verify in source whether `depsWithMeta` / `resolveStopIds` accepts destination as an array of stop codes
2. if arrays are supported, map resolver may pass destination code arrays directly
3. if arrays are not supported, resolver must map to accepted destination name/group or add a tiny compatible adapter

Do not assume array support without source verification.

## Map picker architecture direction

Library direction:
- Leaflet preferred for MVP
- reason: low complexity, no WebGL dependency, city-scale pin-drop is sufficient

Tile direction:
- OSM raster tiles are acceptable for prototype/MVP
- caveat: public OSM tile servers are not unlimited production infrastructure
- if usage grows, move to compliant provider plan

UI direction:
- map picker is optional
- destination dropdown remains fallback
- mobile-first modal/fullscreen overlay
- tap to place pin
- show 1-3 nearest destination candidates
- confirm candidate and close overlay
- destination-first route recalculates with existing logic

## Route recommendation scoring direction

MVP scoring:
- primary: soonest departure
- tiebreak: closer origin stop walk distance

Future (when destination point walk distance is available):
- combine walk to origin + bus wait + walk from final stop

Keep scoring simple in early passes.

## Edge cases to cover in docs and later validation

- GPS denied
- GPS inaccurate
- user between two stops
- wrong side of road (Oie/Tulika)
- Kivi/Kesk sibling codes
- destination with no nearby stop
- destination already within walking distance
- no buses today
- final stop still far from destination
- ring lines
- map tiles fail
- offline/PWA mode
- privacy: one-shot `getCurrentPosition`, no `watchPosition` in MVP

## Future pass plan

Update from PASS 25B docs-only decision:
- typed stop-name search is fallback/advanced
- POI/place-first destination model is primary

### PASS 23D - BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY
Docs-only planning. No runtime code.

### PASS 25A - ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP
Goal:
- enrich route cards with get-off / destination-context where feasible
- no map

Likely touched:
- `src/components/BussTab.jsx`

Do not touch:
- `src/utils/bus.js` unless a tiny proven field exposure is strictly required
- `src/data/busData.js`
- Üllata/API/provider files

### PASS 25B - PLACE_DESTINATION_MODEL_DOCS
Goal:
- document POI/place-first destination model
- demote stop-name search to fallback

Likely touched:
- docs only

### PASS 25C - LOCAL_POI_DATASET_RAKVERE
Goal:
- add verified local POI dataset (no external geocoding)
- map POIs to destination resolver inputs

Likely touched:
- `src/data` (new POI dataset file expected)
- `src/components/BussTab.jsx` (minimal wiring only when explicitly unlocked)

### PASS 25D - PLACE_SEARCH_UI_NO_MAP
Goal:
- add place/POI-first destination search UI
- keep stop-name input as fallback path

Likely touched:
- `src/components/BussTab.jsx`

### PASS 25E - ROUTE_RECOMMENDATION_SCORING_NO_MAP
Goal:
- apply scoring for POI-aware recommendations without map
- preserve existing `depsWithMeta(...)` engine

Likely touched:
- `src/components/BussTab.jsx`

### PASS 25F - MAP_PICKER_SKELETON
Goal:
- add map picker component skeleton only (no full integration)

Likely touched:
- `package.json`
- lockfile
- `src/components/BusMapPicker.jsx`

### PASS 25G - MAP_PIN_TO_DESTINATION_CANDIDATES
Goal:
- integrate pin -> nearest destination candidates -> destination resolver

Likely touched:
- `src/components/BussTab.jsx`
- `src/components/BusMapPicker.jsx`

### PASS 25H - LIVE_FIELD_TEST
Goal:
- deploy and live test POI/map destination flows in Rakvere scenarios

## Explicit do-not-implement list (still locked)

- do not rewrite `depsWithMeta`
- do not add paid geocoding in MVP
- do not build a generic Peatus.ee clone
- do not add multi-transfer routing
- do not remove destination dropdown fallback
- do not mix Uullata/API work with bus/map work
- do not add map and advanced scoring in one pass
- do not use `watchPosition` in MVP
- do not add map tile caching in PWA service worker in first map pass
- do not ignore Leaflet marker asset pitfalls; prefer CircleMarker/DivIcon when needed
