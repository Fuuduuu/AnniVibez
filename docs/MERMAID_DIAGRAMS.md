# MERMAID_DIAGRAMS.md

Status: PASS 26A docs-only diagram planning.

Purpose:
- define where Mermaid diagrams add real clarity
- separate source-backed diagrams from future conceptual flows
- avoid mixing planning diagrams with runtime implementation changes

## Diagram opportunities

### 1) Destination-first bus route flow
- Type: `flowchart`
- Source/data: `src/components/BussTab.jsx` (`destination`, `currentOrigin`, `manualOriginOverride`, `effectiveOrigin`, `routeOptions`, `nearest`, `depsWithMeta`)
- Value now: high
- Purpose: show how destination + origin selection becomes route cards

### 2) Bus routing engine flow
- Type: `flowchart`
- Source/data: `src/utils/bus.js` (`resolveStopIds`, `depsWithMeta`, `emptyReason`, service/day and sequence filtering)
- Value now: high
- Purpose: show how origin/destination resolve into departures

### 3) Stop/group/sibling-code model
- Type: `graph` (or `erDiagram` later)
- Source/data: `BUS_DATA.groups`, `BUS_DATA.by_code`, `displayCodes`, `codes`, stop code pairs
- Value now: medium
- Purpose: explain one visible stop name vs multiple direction-specific stop codes

### 4) BussTab UI state machine
- Type: `stateDiagram-v2`
- Source/data: `destination`, `effectiveOrigin`, `gpsState`, `emptyReason`, `routeOptions`
- Value now: high
- Purpose: make empty/error/found states explicit

### 5) Future GPS/map route recommendation flow
- Type: `flowchart`
- Source/data: `docs/BUS_MAP_PICKER_PLAN.md`, `nearest(pinLat, pinLon)`, `destinationCandidates`, `originCandidates`, scoring notes
- Value now: planning-only
- Purpose: map/typed input -> candidate resolution -> existing routing wrapper

### 6) Üllata provider chain
- Type: `sequenceDiagram`
- Source/data: `functions/api/ullata.js` (Gemini, OpenAI, local fallback, timeout, `variationNonce`)
- Value now: high
- Purpose: make Gemini -> OpenAI -> local behavior explicit

### 7) Deploy/checkpoint workflow
- Type: `flowchart`
- Source/data: build, deploy, canonical/live smoke, API smoke, checkpoint, commit/push
- Value now: high
- Purpose: enforce release discipline

## Initial Mermaid diagrams

### A) Destination-first bus flow (source-backed)

```mermaid
flowchart TD
    A["Kasutaja valib sihtkoha"] --> B{"GPS/current origin olemas?"}
    B -->|Jah| C["Kasuta currentOrigin"]
    B -->|Ei| D["Kasutaja valib lähtekoha käsitsi"]
    C --> E["effectiveOrigin = manualOriginOverride ?? currentOrigin"]
    D --> E
    E --> F["originCodesFrom: displayCodes/codes/code"]
    A --> G["selected destination"]
    F --> H["findRouteOptions"]
    G --> H
    H --> I["depsWithMeta(...)"]
    I --> J{"Leiti väljumisi?"}
    J -->|Jah| K["Route cards"]
    J -->|Ei| L["emptyReason"]
    K --> M["Mine peatusesse"]
    K --> N["Sõida liiniga"]
    K --> O["Välju peatuses"]
```

### A2) Current destination/routing flow (PASS 28B + 28C)

```mermaid
flowchart TD
    A["Sihtkoha sisend"] --> A1{"POI / Map / Dropdown?"}
    A1 -->|POI| B1["POI preferredStopGroups (+ nearest only if coordVerified)"]
    A1 -->|Map| B2["Map nearestStops candidates"]
    A1 -->|Dropdown| B3["Single selected group"]
    B1 --> C["Destination candidates (max 3)"]
    B2 --> C
    B3 --> C
    D["effectiveOrigin"] --> E["Origin candidates (max 5)"]
    C --> F["Origin x Destination matrix test"]
    E --> F
    F --> G["depsWithMeta(...)"]
    G --> H{"Direct routes found?"}
    H -->|Yes| I["Sort + dedupe + show best first"]
    H -->|No| J["Direct-route empty state"]
    I --> K["Route cards"]
```

### B) BussTab UI state machine (source-backed)

```mermaid
stateDiagram-v2
    [*] --> NeedDestination
    NeedDestination --> NeedOrigin: destination selected
    NeedOrigin --> Searching: origin selected / GPS ok
    Searching --> RouteFound: departures found
    Searching --> NoRoute: no valid departures
    Searching --> SameOriginDestination: origin == destination
    Searching --> GpsError: GPS denied/error
    RouteFound --> Searching: origin or destination changed
    NoRoute --> Searching: origin or destination changed
    SameOriginDestination --> Searching: origin or destination changed
    GpsError --> NeedOrigin: manual origin selected
```

### C) Üllata provider chain (source-backed)

```mermaid
sequenceDiagram
    participant UI as LooTab
    participant API as /api/ullata
    participant Gemini
    participant OpenAI
    participant Local as Local fallback

    UI->>API: POST form + variationNonce
    API->>Gemini: try Gemini (8000ms timeout)
    alt Gemini succeeds
        Gemini-->>API: idea
        API-->>UI: source=gemini
    else Gemini fails/timeouts
        API->>OpenAI: try OpenAI (8000ms timeout)
        alt OpenAI succeeds
            OpenAI-->>API: idea
            API-->>UI: source=openai
        else OpenAI fails/timeouts
            API->>Local: buildLocalIdea(variationNonce)
            API-->>UI: source=local
        end
    end
```

### D) Deploy/checkpoint workflow (conceptual, process diagram)

```mermaid
flowchart TD
    A["Implementation pass"] --> B["npm run build"]
    B -->|PASS| C["wrangler pages deploy dist"]
    B -->|FAIL| X["Stop; open narrow fix pass"]
    C --> D["Check deploy URL"]
    D --> E["Check canonical URL"]
    E --> F["/api/ullata smoke"]
    F --> G{"Manual/live smoke OK?"}
    G -->|Yes| H["Update checkpoint docs"]
    H --> I["git add intended files"]
    I --> J["git commit"]
    J --> K["git push origin main"]
    G -->|No| Y["Open narrow fix pass"]
```

### E) Map picker UI/data flow (PASS 28C/28D/28E/28H state)

```mermaid
flowchart TD
    A["Vali kaardilt"] --> B["Full-screen modal/overlay"]
    B --> B1["Liinifilter: Kõik | 1 | 2 | 3 | 5"]
    B1 --> B2["Selected line highlights stops"]
    B1 --> B3["Unrelated stops fade"]
    B --> C["Render context markers"]
    C --> C1["Minu asukoht (currentPosition)"]
    C --> C2["Lähim peatus (effectiveOrigin context)"]
    B --> D["Map tap"]
    D --> E["Destination pin"]
    E --> F["onPick(lat, lon, nearestStops)"]
    F --> G["Bottom-sheet candidates"]
    G -->|1 candidate| H["Lähim peatus sihtkohale"]
    G -->|>1 candidates| I["Mitu peatust on lähedal"]
    G --> J["Kasuta seda sihtkohta"]
    J --> K["Set destination + recalculate routes"]
```

### F) Coordinate flow (GTFS layer -> nearest/map)

```mermaid
flowchart TD
    A["GTFS audit outputs"] --> B["src/data/gtfsStopCoords.js"]
    B --> C["src/utils/bus.js nearest()"]
    B --> D["src/components/BusMapPicker.jsx markers"]
    C --> E["Destination/origin candidate resolution"]
    D --> E
```

### G) Map visual roadmap (locked order)

```mermaid
flowchart LR
    A["Context markers"] --> B["Line color data layer"]
    B --> C["Line badge markers"]
    C --> D["Line filter"]
    D --> E["Geometry source discovery"]
    E --> F["Route highlight by direction"]
```

### H) Live map line visual flow (PASS 28J + smoothness)

```mermaid
flowchart LR
    A["Line filter: Kõik | 1 | 2 | 3 | 5"] --> B{"Selected line is Kõik?"}
    B -->|Yes| C["No route polyline"]
    B -->|No| D["Direction selector (line 3/5)<br/>line 1/2 auto-select"]
    D --> E["ROUTE_SHAPES_BY_LINE (GTFS geometry)"]
    E --> F["Leaflet polyline in routeShapePane"]
    F --> G["Markers remain above route line"]
```

## Notes

- Diagrams A/B/C are source-backed by current files.
- Diagram D is intentionally conceptual (process governance).
- Future map diagrams remain planning-only until PASS 25C/25D/25E work is explicitly unlocked.
- `docs/CODEBASE_IMPACT_MAP.md` remains the source-of-truth for codebase impact/surface diagrams.
- Figma/FigJam visuals are visual aids only.
- Current map visual state includes:
  - line color data layer (`src/data/stopLineMap.js`)
  - line badges
  - line filter (`Kõik | 1 | 2 | 3 | 5`, default `Kõik`)
  - route highlight by direction from GTFS shape points (`src/data/routeShapes.js`)
  - map smoothness tuning (`preferCanvas`, RAF-batched marker updates, `LINE_BADGE_MIN_ZOOM = 17`)
  - tuning improved smoothness, but additional tuning may still be needed after field testing
- Future architecture note (not active runtime scope):
  - AnniVibe bus module may later be extracted into a standalone bus app

## Codebase impact / sniper maps

- Mermaid source-of-truth for impact/surface diagrams lives in:
  - `docs/CODEBASE_IMPACT_MAP.md`
- Any future Figma/FigJam export should be generated from this Mermaid source, not freehand memory.
- Figma/FigJam input scope should include only:
  - Mermaid diagram content
  - legend
  - color rules

## Figma/FigJam visual

- A Figma/FigJam visual exists for the AnniVibe Sniper Matrix / codebase impact map.
- Visual asset path:
  - `docs/assets/annivibe-sniper-matrix.png`
- Figma/FigJam link:
  - `https://www.figma.com/make/NLhNtsH62eXlt3XLtqZ2wM/Create-Engineering-Diagram?t=cXNGGnLW3YYQ6KIt-20&fullscreen=1`
- Purpose:
  - developer-facing quick reference for Codex pass type -> read/touch/never-touch/validate
- The image is a visual aid only.
- Source of truth remains:
  - `docs/CODEBASE_IMPACT_MAP.md`
- Future Figma/FigJam updates must be generated from repo Mermaid/docs, not freehand memory.

![AnniVibe Sniper Matrix](./assets/annivibe-sniper-matrix.png)
