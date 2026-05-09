# PASS 31C — MAP_CODE_SPLIT_AND_DATA_LAZY_LOAD Plan

## Status
- Type: planning only
- Runtime changes in this pass: none
- Goal: reduce initial JS payload and first-load mobile jank by delaying map-specific code/data until needed.

## Baseline (current import graph)

### Static imports that force map/data into main bundle
1. `src/components/BussTab.jsx`
- static import: `import { BusMapPicker } from './BusMapPicker';`
- `BusMapPicker` is rendered only when `mapPickerOpen === true`, but static import still pulls module into initial graph.

2. `src/components/BusMapPicker.jsx`
- static import: `GTFS_STOP_COORDS_BY_ID` from `src/data/gtfsStopCoords.js`
- static import: `LINE_COLORS`, `STOP_TO_LINES` from `src/data/stopLineMap.js`
- static import: `ROUTE_SHAPES_BY_LINE` from `src/data/routeShapes.js`
- static import: `nearest` from `src/utils/bus.js`

3. `src/utils/bus.js`
- static import: `GTFS_STOP_COORDS_BY_ID`.
- `bus.js` is already needed by `BussTab` routing flow (`depsWithMeta`, `nearest`), so this part stays eager in MVP.

### Payload context (file size level)
- `src/components/BusMapPicker.jsx` ~ 21 KB
- `src/data/routeShapes.js` ~ 75 KB (largest map data file)
- `src/data/stopLineMap.js` ~ 6 KB
- `src/data/gtfsStopCoords.js` ~ 6 KB

## Safest implementation sequence

### PASS 31C1 — LAZY_LOAD_BUS_MAP_PICKER (recommended first)
- In `BussTab`, replace static `BusMapPicker` import with `React.lazy(...)`.
- Keep modal/state logic unchanged.
- Wrap map area with `Suspense` fallback (small loading card/spinner text inside modal body).
- Result: map module and its nested dependencies are deferred until user opens map picker.

Why first:
- highest impact with smallest surface change
- no data contract changes
- preserves current map behavior after load

### PASS 31C2 — LAZY_LOAD_ROUTE_SHAPES
- In `BusMapPicker`, remove static `ROUTE_SHAPES_BY_LINE` import.
- Dynamically load `../data/routeShapes` only when `activeLineFilter !== 'all'`.
- Cache loaded module in component state/ref to avoid repeated imports.
- While loading:
  - keep map usable
  - keep markers/badges/filter visible
  - temporarily hide route polyline and direction selector, or show compact "Laen suundi..." indicator.
- On load success:
  - re-enable direction selector and GTFS polyline rendering.

### PASS 31C3 — OPTIONAL_LAZY_LOAD_STOP_LINE_MAP
- Optional because benefit is smaller than `routeShapes` and complexity is higher.
- If implemented:
  - dynamically load `stopLineMap` after map open
  - until loaded, render calm stop markers without badges/filter coloring
  - enable line badges/filter state only after map line data arrives.
- Keep currentPosition/origin/destination candidate markers functional regardless of line-data load state.

## Risks and mitigations

1. First map open delay
- Risk: user sees blank moment before map appears.
- Mitigation: explicit in-modal loading fallback and reserved map container height.

2. PWA cache/chunk behavior
- Risk: additional chunk fetch on first map open after deploy.
- Mitigation: accept one-time fetch; verify service worker update path and subsequent opens from cache.

3. Marker badges break if `stopLineMap` delayed
- Risk: missing `STOP_TO_LINES` during first render causes badge/filter mismatch.
- Mitigation: do `31C3` only after `31C1` + `31C2` are stable; add guarded defaults and loading state.

4. Route highlight unavailable while `routeShapes` loads
- Risk: line selected but no immediate polyline.
- Mitigation: loading indicator + auto-draw immediately after module resolves.

5. Regressions in current bus UX
- Risk: map lazy-loading accidentally impacts POI/dropdown/route logic.
- Mitigation: BussTab route logic remains untouched in all 31C passes.

## Validation plan

### Build and bundle checks
1. `npm run build`
2. Compare before/after build output:
- main `index-*.js` size should decrease after `31C1`
- new split chunk(s) should appear for map/data modules

### Runtime smoke checks
1. BussTab loads and works without opening map:
- POI search works
- dropdown fallback works
- direct-route matrix still works

2. Open map picker:
- fallback loader appears briefly (if chunk not cached)
- map opens fully
- currentPosition/origin/destination markers still render

3. Line badges/filter:
- badges still visible at configured zoom threshold
- filter `Kõik | 1 | 2 | 3 | 5` still works

4. Route highlight:
- line `3` and `5` direction selector still appears
- line `1` and `2` single-pattern behavior preserved
- GTFS polyline still renders; no synthetic fallback introduced

### Regression guard
- no changes to:
  - `src/utils/bus.js`
  - `src/data/busData.js`
  - `src/data/poiData.js`
  - `functions/api/ullata.js`

## Implementation split summary
- `PASS 31C1 — LAZY_LOAD_BUS_MAP_PICKER`
- `PASS 31C2 — LAZY_LOAD_ROUTE_SHAPES`
- `PASS 31C3 — OPTIONAL_LAZY_LOAD_STOP_LINE_MAP`

## Recommendation
Start with `PASS 31C1 — LAZY_LOAD_BUS_MAP_PICKER`.
- It delivers the safest early win and creates a clean boundary for later lazy data-loading passes.
