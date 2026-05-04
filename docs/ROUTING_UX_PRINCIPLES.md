# ROUTING_UX_PRINCIPLES

Status: product/UX guidance for bus-routing behavior and UI decisions.

## 1. Destination-first UX

- User chooses a place, POI, map point, or fallback stop.
- App resolves useful stops internally.
- Stop names are implementation detail unless they help explain the route.

## 2. Do not fail early

- Never show `busse pole` before trying relevant origin x destination candidate pairs.
- `Busse pole` means direct-route candidates were actually checked.

## 3. Show the next useful action

Route card must answer:
- where to walk
- which line to take
- when it departs
- where to get off

## 4. One best route first

- Show the best route first.
- Show alternatives second.
- Keep the first view focused.

## 5. Keep cognitive load low

- Avoid raw stop IDs, raw coordinates, and internal routing terms in primary UX.
- Use simple Estonian copy.
- Prefer clear vertical route cards over hidden/swipe-heavy interaction.

## 6. GTFS coordinates are physical truth layer

- Stop-point accuracy directly affects nearest-stop quality.
- Incorrect coordinates produce incorrect nearby results.
- GTFS stop-point coordinate layer is used for nearest/map lookup.

## 7. Direct-route first, transfers later

- Next routing improvement target is direct viable-route candidate search.
- Transfer logic is separate future scope.
- Map visuals can support explanation but do not replace routing logic.

## 8. Map is an input aid

- Map picker helps choose destination input.
- It is not yet a full route-line display engine.
- Route polylines are future scope.
