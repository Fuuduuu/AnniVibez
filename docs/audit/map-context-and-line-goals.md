# MAP_CONTEXT_AND_LINE_GOALS

Status: PASS 28E follow-up planning lock (docs-only).

## 1. Current accepted map state

- full-screen map picker modal is active
- bottom-sheet destination decision UI is active
- GTFS stop-point coordinates are active for nearest/map stop points
- direct-route candidate matrix search is active in `BussTab`
- marker visuals were improved in prior map-marker pass
- `Minu asukoht` marker is implemented
- `Lähim peatus` marker is implemented
- line color data layer is implemented (`src/data/stopLineMap.js`)
- line badges are implemented
- line filter is implemented (`Kõik | 1 | 2 | 3 | 5`, default `Kõik`)
- route highlight by direction is implemented using GTFS shapes (`src/data/routeShapes.js`)
- line 3 and line 5 expose direction selector
- line 1 and line 2 auto-select their single available pattern
- map smoothness tuning is live:
  - `preferCanvas` enabled
  - marker style updates batched via `requestAnimationFrame`
  - `LINE_BADGE_MIN_ZOOM = 17`
  - unrelated stops do not render badges while active line filter is selected
  - route polyline visual load reduced (`weight`/`opacity`/`smoothFactor`)

## 2. Locked next goal order

Completed:
- `PASS 28F — MAP_LINE_COLOR_DATA_LAYER`
- `PASS 28G — MAP_LINE_BADGE_MARKERS`
- `PASS 28H — MAP_LINE_FILTER`
- `PASS 28I — ROUTE_GEOMETRY_SOURCE_DISCOVERY`
- `PASS 28J — MAP_ROUTE_HIGHLIGHT_BY_DIRECTION`
- `PASS MAP_SMOOTHNESS_COMMIT`
- `PASS MAP_VISUAL_LOAD_TUNING_COMMIT`

Next:
1. field testing / on-device smoothness validation
2. `MAP_VISUAL_LOAD_TUNING_2` only if jank returns

## 3. Locked marker rules

- stop names are not shown on map by default
- marker label shows line-number badge, not stop name
- line badges are visible only when sufficiently zoomed in
- single-line stop marker: white fill + colored border + line number
- multi-line stop marker: neutral base + multiple badges
- if too many badges: show first 3 + `+`
- stop name appears only in bottom sheet / popup after tap

## 4. Locked colors

- Liin 1 = blue
- Liin 2 = green
- Liin 3 = yellow
- Liin 5 = orange
- `Minu asukoht` = red
- red is reserved for user/current location, not a bus line

## 5. Line filter

- control: `Kõik | 1 | 2 | 3 | 5`
- location: compact map-corner control
- selected line highlights relevant stops
- unrelated stops fade, not disappear
- multi-line stops remain visible if they serve selected line
- selected destination candidate must remain visually strongest

## 6. Route highlight

- user chooses line and direction/pattern
- route highlight must use real road/shape geometry, not straight stop-to-stop lines
- route polyline is blocked until geometry source is decided
- prefer GTFS `shapes.txt` if reliable; otherwise evaluate OSM road geometry
- circular routes must use pattern names for direction choice

## 7. Boundaries

- no `depsWithMeta` changes
- no `nearest` changes
- no `src/data/busData.js` changes
- no transfer routing
- no geocoding
- no live tracking
- no raw coordinates in primary UX
- no stop IDs in primary UX
- no Üllata/API surface changes
