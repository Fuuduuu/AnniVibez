# BUS_MAP_PICKER_PLAN.md

Status: PASS 23D recovery/final planning (docs-only, no runtime implementation).

## User mental model

`Kuhu tahan minna? Naita, kuidas sinna koige moistlikumalt bussiga saan.`

## Locked architectural principle

Map and typed destination search are input surfaces, not a new routing engine.

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
- stop/group name
- typed stop search
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

### Mode B - typed stop search
- search only `BUS_DATA.groups` names in MVP
- match order: exact, then startsWith, then includes
- show top 5 results
- no external geocoding in MVP
- no match copy: `Peatust ei leitud. Vali nimekirjast.`

### Mode C - map pin
- user opens `Vali sihtkoht kaardilt`
- user taps pin
- `nearest(pinLat, pinLon)` resolves destination candidates (1-3)
- selected candidate becomes destination input for existing flow

Future optional:
- small hardcoded Rakvere POI list (no paid APIs)

## Critical verification note before implementation

Before map/typed integration code work:
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

### PASS 25B - TYPED_STOP_SEARCH
Goal:
- add typed search over known stop/group names
- dropdown remains fallback

Likely touched:
- `src/components/BussTab.jsx`

### PASS 25C - DESTINATION_POINT_AND_CANDIDATE_STATE_PREP
Goal:
- add `destinationMode`, `destinationPoint`, `destinationCandidates` state
- prepare pin-based destination path without rendering map yet
- include destination array support verification step

Likely touched:
- `src/components/BussTab.jsx`

### PASS 25D - LEAFLET_MAP_PICKER_SKELETON
Goal:
- add Leaflet dependency and isolated `BusMapPicker` skeleton
- no BussTab integration yet unless explicitly unlocked

Likely touched:
- `package.json`
- lockfile
- `src/components/BusMapPicker.jsx`

### PASS 25E - MAP_PICKER_INTEGRATION
Goal:
- add `Vali kaardilt` trigger + modal
- pin -> destination candidates -> selected destination
- feed existing destination-first routing

Likely touched:
- `src/components/BussTab.jsx`
- `src/components/BusMapPicker.jsx`

### PASS 25F - MAP_ROUTE_LIVE_SMOKE
Goal:
- deploy and validate Rakvere scenarios:
  - pin near Pohjakeskus
  - pin near Bussijaam
  - pin near Oie/Tulika area
  - pin with no nearby stops
  - mobile GPS/location permission behavior

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
