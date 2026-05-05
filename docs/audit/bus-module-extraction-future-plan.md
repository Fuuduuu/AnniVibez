# BUS_MODULE_EXTRACTION_FUTURE_PLAN

Status: future product/architecture direction only, not active implementation.

## Direction

Once the Rakvere bus feature is stable inside AnniVibe, the bus feature may be extracted into a standalone dedicated bus app.

## Why extraction may make sense

- bus feature has grown into a full product surface
- destination-first UX, map picker, GTFS coordinates, line filters, and route highlight are now app-like features
- standalone app could focus only on bus usage without AnniVibe’s broader content features
- easier future expansion to other Estonian cities with messy local line logic

## Must be stable before extraction

- direct-route candidate search
- map destination picker
- GTFS stop-point coordinate layer
- line badges and filters
- route highlight by direction
- field-tested Rakvere scenarios
- clear protected data boundaries
- no hidden dependency on Üllata/LooTab

## Reuse/preserve

- `busData` / GTFS coordinate layer
- route-pattern audit data
- routeShapes layer
- BusMapPicker logic
- destination-first UX principles
- protected-surface rules
- sniper workflow

## Do not do yet

- do not split repo now
- do not duplicate data manually
- do not rewrite routing engine during extraction planning
- do not mix extraction with current map/route fixes
- do not start multi-city expansion before Rakvere is stable

## Future pass

- `PASS 30A — BUS_MODULE_EXTRACTION_ARCHITECTURE_PLAN`
