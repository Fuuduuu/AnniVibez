# GTFS Coordinate Patch Plan (PASS 27E)

## Scope

Planning only. No runtime/data patch in this pass.

## Audit Baseline

Source audits:
- `docs/audit/gtfs-rakvere-stop-coords.json`
- `docs/audit/gtfs-rakvere-stop-coords-report.md`
- `docs/audit/route-pattern-busdata-compare-report.md`

Confirmed findings:
- GTFS stopIds checked: **80**
- Missing GTFS IDs: **0**
- Missing busData coord: **1** (`Aiand`, `5900013-1`)
- `BAD_REVIEW` (>75m): **78**
- `REVIEW` (25m..75m): **1**

Interpretation:
- This is not a route-pattern identity problem (stopIds are present and matched).
- This is primarily a coordinate-layer mismatch between `BUS_DATA.by_code` and GTFS `stops.txt` stop-point coordinates.

## Affected App Surfaces

1. `nearest()` in `src/utils/bus.js`
- Uses stop-point coordinates from `BUS_DATA.by_code`.
- Coordinate patch changes nearest-stop ranking and distance output.

2. `BusMapPicker` markers (`src/components/BusMapPicker.jsx`)
- Renders `CircleMarker` from `BUS_DATA.by_code` numeric `lat/lon`.
- Coordinate patch moves visible markers and nearest candidate behavior.

3. POI/place destination resolving (`src/components/BussTab.jsx`)
- Map-picked candidates and some destination paths rely on `nearest(...)` output.
- Coordinate patch may change resolved candidate ordering.

4. Õie/Tulika nearby logic
- Nearby-origin behavior depends on stop-point distances.
- Coordinate patch can change which side/candidate is preferred first.

5. Route cards
- Route engine (`depsWithMeta`) is pattern/stopId-based and should stay stable.
- But origin context and distance-to-stop UX can shift due to nearest changes.

## Approach Comparison

### A) Overwrite `BUS_DATA.by_code` coords with GTFS coords
Pros:
- Fastest runtime effect.
- Single source at runtime.

Cons/Risks:
- Destructive change with weak rollback trace.
- Hard to audit which coordinates were replaced and why.
- Can accidentally alter group-display behavior if mixed updates happen.

Risk level: **High**

### B) Add separate verified GTFS coordinate layer
Pros:
- Non-destructive, auditable, reversible.
- Enables side-by-side diff and staged rollout.
- Safer for protected bus engine/data surfaces.

Cons/Risks:
- Requires routing/UI consumers to choose the new layer.
- Slightly more integration logic.

Risk level: **Low-Medium**

### C) Regenerate group coords/centroids from GTFS stop-level coords
Pros:
- Cleans display-level group metadata.
- Can improve map summaries at group level.

Cons/Risks:
- Group centroid can be misleading for direction-specific stops.
- May conflict with locked rule: nearest must use stop-points, not centroids.

Risk level: **Medium-High**

### D) Hybrid: GTFS stop-level coords + group display coords
Pros:
- Keeps stop-point truth for `nearest()` and map picking.
- Preserves group display layer as separate concern.
- Compatible with direction-specific stopId model.

Cons/Risks:
- Requires clear precedence rules (stop-level over group-level for nearest/map).
- Needs explicit validation for Õie/Tulika and sibling stop pairs.

Risk level: **Low-Medium**

## Recommended MVP

Recommended: **D with B-style implementation discipline**.

Practical recommendation:
- Introduce a verified GTFS stop-point coordinate layer keyed by stopId.
- Use it for stop-point consumers (`nearest`, map marker/candidate resolution).
- Keep group display coordinates separate (do not let centroids drive nearest logic).
- Patch missing stop-point (`Aiand 5900013-1`) through the same verified layer.

Why safest now:
- Preserves protected bus engine behavior and stopId truth.
- Minimizes blast radius to ranking/marker surfaces only.
- Allows rollback and incremental validation before broad data overwrite.

## Proposed Next Implementation Pass

**PASS 27F — GTFS_STOPPOINT_COORD_LAYER_MVP**

Target (narrow):
- Add/prepare verified stop-point coordinate source keyed by stopId.
- Wire nearest/map-stop consumers to use verified stop-point coords.
- Do not rewrite `depsWithMeta` route logic.
- Do not redesign BussTab UX.

Out of scope:
- No broad busData refactor.
- No centroid-driven nearest logic.
- No scoring/geocoding/map-feature expansion.

## Validation Plan After Patch

1. Build:
- `npm run build`

2. Source smoke:
- Confirm stop-point consumers use verified coords (not group centroid fallback) where intended.

3. Scenario checks:
- Map picker candidate behavior near **Õie/Tulika**.
- Candidate/nearest behavior for **Haigla**, **Põhjakeskus**, **Teater**.
- **Aiand (5900013-1)** now has usable stop-point coordinates.
- Destination-first flow and route cards still render normally.

4. Regression guard:
- `depsWithMeta` unchanged.
- Pattern/stopId routing unchanged.

## Risk Summary

Primary risk:
- Coordinate truth correction changes nearest ranking and user-visible stop suggestions.

Mitigation:
- Narrow pass, stop-point-only precedence, focused Rakvere scenario validation, and no route-engine rewrite.
