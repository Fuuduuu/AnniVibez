# ROUTE_GEOMETRY_SOURCE_DISCOVERY

Generated: 2026-05-04T23:26:59.017Z

## Checked GTFS source/cache path

- Recommended source: https://eu-gtfs.remix.com/estonia_unified_gtfs.zip
- Cache ZIP used: `.artifacts/gtfs/estonia_unified_gtfs.zip`
- Downloaded in this pass: no
- Extract dir: `.artifacts/gtfs`

## GTFS file presence

- shapes.txt exists: yes
- trips.txt exists: yes
- routes.txt exists: yes
- stop_times.txt exists: yes

## shapes.txt summary

- total shape points: 2306859
- relevant shape IDs (Rakvere-assigned trips): 68
- relevant shape IDs with geometry rows: 68

## Line-by-line shape availability (Rakvere-assigned)

| Line | Route IDs | Assigned trips | Trips with shape_id | Unique shape_ids | Pattern coverage | Confidence |
|---|---:|---:|---:|---:|---:|---|
| 1 | 20 | 710 | 710 | 41 | 1/1 | high |
| 2 | 2 | 270 | 270 | 3 | 1/1 | high |
| 3 | 3 | 148 | 148 | 4 | 2/2 | high |
| 5 | 12 | 265 | 265 | 20 | 2/2 | high |

## Direction/pattern matching confidence

- Line 5 distinguishable direction geometry: yes
- Line 3 circular patterns distinguishable: yes

## Recommendation for PASS 28J

- Result: **GTFS shapes usable**
- Reason: Rakvere-matched trips for lines 1/2/3/5 are shape-backed and line 5 direction geometry is distinguishable.
- Explicit note: **no straight stop-to-stop polyline MVP**; user chose real geometry.
- Next pass: `PASS 28J — MAP_ROUTE_HIGHLIGHT_BY_DIRECTION`
