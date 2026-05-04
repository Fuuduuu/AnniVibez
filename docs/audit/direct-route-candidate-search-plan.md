# DIRECT_ROUTE_CANDIDATE_SEARCH_PLAN (PASS 28A)

Status: planning-only. No runtime code changes in this pass.

## Problem Statement

Current destination-first flow can still return `busse pole` too early when only one narrow origin x destination pair is tested.

This is most visible when:
- origin has nearby viable alternatives (e.g. Õie/Tulika side),
- destination input can map to multiple plausible stop-groups,
- direct route exists, but not for the first tested pair.

Goal for next implementation pass:
- test a bounded set of viable direct-route pairs before returning empty.

## Locked Constraints

- keep `depsWithMeta(...)` unchanged as route engine
- keep `nearest(...)` unchanged as coordinate-to-stop resolver
- no transfer routing in MVP
- no map line colors in MVP
- no `src/data/busData.js` changes in MVP

## Candidate Search Model (Direct Only)

### Origin candidates (max 3-5)

Priority order:
1. effective origin (`manualOriginOverride ?? currentOrigin`)
2. nearby origin candidates already available in BussTab
3. optional extra nearest-origin fallback only if already available from current state (no new engine)

Hard limit:
- evaluate at most 5 origin candidates.

### Destination candidates (max 3)

#### A) POI selection

- start from `poi.preferredStopGroups` (max 2 groups)
- if `coordVerified === true` and POI has numeric `lat/lon`, append `nearest(poi.lat, poi.lon)` group candidates
- dedupe and cap to 3

#### B) Map pin

- use current map destination candidates from picker flow
- cap to 3 candidates
- reject out-of-area picks when nearest-stop distance > 3000 m

#### C) Dropdown fallback

- single selected group name only

## Pair Testing Algorithm

For each destination candidate (priority order), test each origin candidate:
1. resolve origin codes via existing `originCodesFrom` behavior
2. call `depsWithMeta(originCodes, limit, { destination: destinationCandidate, service })`
3. keep only direct departures returned by existing engine
4. attach metadata:
   - tested origin
   - tested destination candidate
   - origin walking distance if known
   - destination walking distance if known

Stop conditions:
- continue until candidate matrix is exhausted or result cap is reached.
- do not fail after first empty candidate pair.

## Result Scoring (MVP)

Sort by:
1. earlier departure time
2. shorter origin walk distance
3. shorter destination walk distance (only when known)
4. candidate priority tie-break:
   - preferred POI group before nearest-derived fallback
   - first map candidate before secondary map candidates

## Empty-State Rules

- No destination input:
  - `Vali sihtkoht, et näha marsruute`
- Destination not resolved to candidates:
  - `Sihtkohta ei leitud. Proovi teist nime või vali peatus nimekirjast.`
- Direct connections missing after full bounded matrix test:
  - `Valitud suunal ei leitud praegu sobivat otseliini.`
- No buses remaining today (engine/time-based):
  - `Täna enam busse pole · <service>`
- Map pin out of Rakvere operating area (`nearest > 3000 m`):
  - `Valitud punkt on teeninduspiirkonnast väljas. Vali lähem sihtkoht.`

## MVP Pass Definition

Next implementation pass:
- **PASS 28B — DIRECT_ROUTE_CANDIDATE_SEARCH_MVP**

In scope for 28B:
- BussTab-local candidate expansion and pair testing wrapper
- bounded origin/destination candidate matrix
- revised direct-route empty-state behavior

Out of scope for 28B:
- transfer routing
- map polyline rendering
- map line color styling
- bus engine rewrite
- bus data rewrite

## Future Follow-up Passes

- **PASS 28C — MAP_LINE_COLOR_PLAN**
- **PASS 28D — MAP_LINE_COLOR_UI_SUPPORT**
- **PASS 29A — ONE_TRANSFER_ROUTING_PLAN**
- **PASS 29B — ONE_TRANSFER_ROUTING_MVP**

## Validation Scenarios for 28B

Core direct-route checks:
- Õie/Tulika -> Haigla
- Õie/Tulika -> Põhjakeskus
- Põhjakeskus -> Rägavere tee
- Haigla -> Kesklinn
- Teater -> Põhjakeskus

Map/POI boundary checks:
- map pin near Aiand
- map pin outside Rakvere area (distance gate)
- POI search: `haigla`, `kesklinn`, `aqva` (disabled POI behavior stays safe)
- dropdown fallback destination selection still works

## Risk Summary

Main risk:
- broader candidate testing can increase UI latency and duplicate results.

Mitigation:
- strict candidate caps (origin <= 5, destination <= 3)
- dedupe by line/variant/time/origin+destination context
- preserve existing engine calls and output contracts
