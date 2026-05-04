# MAP_PICKER_UX_DESIGN_SPEC (PASS 28C extract)

Status: UX/design guidance extracted from `docs/audit/bus map picker design.zip` and aligned with current app boundaries.

## Source artifact note

- Input artifact: `docs/audit/bus map picker design.zip`
- Source-of-truth for implementation remains repo code + this spec (not ZIP snapshot itself).

## UX direction (MVP-aligned)

1. User chooses destination, not stop.
2. Stops are supportive context only:
   - `Lähim peatus sihtkohale`
3. Hide raw technical data in normal UX:
   - no raw coordinates
   - no stop IDs
4. Keep routing simple:
   - no route polylines yet
   - no transfer routing
   - no geocoding

## Layout recommendation

### Full-screen map modal

- Open map picker as full-screen modal on mobile.
- Header question:
  - `Kuhu soovid minna?`
- Supporting hint:
  - `Puuduta kaardil kohta, kuhu soovid jõuda.`
- Close affordance remains explicit (`Sulge`).

### Bottom-sheet decision UI

- After pin drop, show destination decision in bottom sheet:
  - status: `Koht valitud ✓`
  - title (1 candidate): `Lähim peatus sihtkohale`
  - title (multi candidate): `Mitu peatust on lähedal — vali sobivam`
- Primary action:
  - `Kasuta seda sihtkohta`
- Do not expose coordinates in this sheet.

## Marker roles

- Pin marker:
  - chosen destination point (user action)
- Stop markers:
  - nearby known stop-points for context
- Selected candidate state:
  - visually distinct active candidate in bottom-sheet choices

## Estonian copy set (locked for this UX)

- `Kuhu soovid minna?`
- `Puuduta kaardil kohta, kuhu soovid jõuda.`
- `Koht valitud ✓`
- `Lähim peatus sihtkohale`
- `Mitu peatust on lähedal — vali sobivam`
- `Kasuta seda sihtkohta`
- `Valitud punkt on teeninduspiirkonnast väljas. Vali lähem sihtkoht.`
- `Valitud kohale ei leitud sobivat peatust. Proovi kaardil teist kohta.`
- `Sulge`

## Accessibility notes

- Keep tap targets >= 44px for chips/buttons.
- Maintain visible focus style for keyboard users.
- Ensure map buttons and candidate chips have readable contrast.
- Provide explicit text status (not color-only state).
- Preserve screen-reader-friendly button labels for confirm/close actions.

## Implementation split

- `PASS 28C_UI_MAP_PICKER_LAYOUT`
  - full-screen modal + bottom-sheet structure and copy
  - no route logic rewrite
- `PASS 28D_MAP_MARKER_VISUALS`
  - marker hierarchy and visual states
  - no routing-engine changes
- `PASS 28E_MAP_LINE_COLOR_MVP`
  - optional line color support in route presentation only
  - still no transfer routing in this stage

## Strict boundaries

Do not change in these UX passes:
- `depsWithMeta(...)`
- `nearest(...)`
- `src/data/busData.js`
- Üllata surfaces (`src/components/LooTab.jsx`, `functions/api/ullata.js`)

## Out of scope in this spec

- transfer routing logic
- geocoding / address search
- map polylines
- backend/provider changes
