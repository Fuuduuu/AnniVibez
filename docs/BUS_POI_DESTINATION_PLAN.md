# BUS_POI_DESTINATION_PLAN.md

Status: PASS 25B docs-only place destination model planning.

## 1. Product decision

- stop-name search is demoted to fallback/advanced input
- primary destination input is local POI/place
- map pin is a later input method
- stop dropdown remains fallback
- no paid/external geocoding in MVP
- do not build a Peatus.ee clone

## 2. DestinationTarget model

`DestinationTarget`:

- `id`
- `label`
- `aliases`
- `category`
- `lat`
- `lon`
- `preferredStopGroups`
- `source` (`poi` | `mapPin` | `stop` | `saved`)
- `coordVerified`
- `enabled`
- `notes`

Rules:

- `coordVerified=false` means coordinates are not runtime-safe yet
- `enabled=false` means hidden until verification
- do not invent final coordinates
- coordinates must be verified before runtime use unless directly derived from trusted project `busData`

## 3. Destination types

- local POI/place (primary)
- category quick choices
- map pin (later)
- saved place (later)
- bus stop fallback (advanced/manual path)

## 4. Initial Rakvere POI candidates (planning table)

| id | label | aliases | category | preferredStopGroups | coordinate source/status | enabled recommendation | notes |
|---|---|---|---|---|---|---|---|
| poi_kesklinn | Kesklinn | Keskväljak, center | center | Kesk, Kivi | needs verification | false | likely multi-stop target area, not one exact point |
| poi_bussijaam | Bussijaam | bus station | transport | Bussijaam | busData-derived candidate (stop-group aligned) | true | safe as early POI entry if group mapping is confirmed in runtime dataset |
| poi_raudteejaam | Raudteejaam | rongijaam, train station | transport | Raudteejaam | busData-derived candidate (stop-group aligned) | true | verify aliases and group spelling before runtime |
| poi_haigla | Rakvere haigla | haigla | health | Haigla | needs verification | false | POI label likely differs from stop naming; requires mapping confirmation |
| poi_polikliinik | Polikliinik | kliinik | health | Polikliinik | needs verification | false | mapping needs explicit confirmation |
| poi_pohjakeskus | Põhjakeskus | Pohjakeskus | shopping | Põhjakeskus | busData-derived candidate (stop-group aligned) | true | currently frequently used as directional destination |
| poi_kauba | Kauba | Kaubakeskus | shopping | Kauba | busData-derived candidate (stop-group aligned) | true | already appears in known routing examples |
| poi_teater | Rakvere teater | Teater | culture | Teater | needs verification | false | verify stop-group linkage first |
| poi_aqva | Aqva | Aqua Spa | leisure | Aqva (candidate) | needs verification | false | must not be enabled before coordinates + stop mapping are verified |
| poi_vaala | Vaala keskus | Vaala | shopping | Vaala (candidate) | needs verification | false | must not be enabled before coordinates + stop mapping are verified |
| poi_linnus | Rakvere linnus | linnus, castle | culture | Linnus (candidate) | needs verification | false | likely not exact stop name; requires resolver mapping |

## 5. Resolution algorithm

1. user searches/selects POI
2. resolve POI by `id`/`aliases`
3. if `preferredStopGroups` exists:
   - use preferred stop group as destination input for current route logic
4. if coordinates exist and are verified:
   - use `nearest(lat, lon)` to resolve destination-side stop candidates
5. if map pin later:
   - `nearest(pinLat, pinLon)` resolves destination candidates
6. if no POI match:
   - fall back to stop-name search
7. if still no match:
   - show `Kohta ei leitud. Proovi nimekirjast või vali kaardilt.`

## 6. Route recommendation algorithm

- origin comes from GPS/current/manual override
- destination comes from POI/map/stop resolver
- wrapper calls existing `depsWithMeta(...)`
- route card shows:
  - `Mine peatusesse ...`
  - `Sõida liiniga ...`
  - `Välju peatuses ...`
  - later: `Kõnni sihtkohta X m` when `destinationPoint` exists

## 7. Scoring

MVP scoring:

- soonest departure first
- tiebreak by closer origin stop

Future scoring when `destinationPoint` exists:

- walk to origin stop
- wait for departure
- walk from get-off stop to actual target

No scoring implementation in this pass.

## 8. UI direction (Estonian copy)

- `Kuhu soovid minna?`
- `Otsi kohta või vali kaardilt`
- `Populaarsed kohad`
- `Kesklinn`
- `Vaala keskus`
- `Põhjakeskus`
- `Mine peatusesse...`
- `Sõida liiniga...`
- `Välju peatuses...`
- `Kõnni sihtkohta...`
- `GPS puudub — vali lähtekoht käsitsi`
- `Kohta ei leitud`

## 9. Edge cases

- destination already nearby
- no GPS permission
- GPS inaccurate
- user between two stops
- wrong side of road
- destination has no close bus stop
- closest destination stop not reachable
- bus takes user farther away
- multiple similar POIs
- map pin outside Rakvere
- no buses today
- ring lines
- Kivi/Kesk sibling codes
- Õie/Tulika pair
- offline/PWA
- privacy/GPS one-shot behavior

## 10. Future passes (updated order)

- PASS 25B — PLACE_DESTINATION_MODEL_DOCS
- PASS 25C — LOCAL_POI_DATASET_RAKVERE
- PASS 25D — PLACE_SEARCH_UI_NO_MAP
- PASS 25E — ROUTE_RECOMMENDATION_SCORING_NO_MAP
- PASS 25F — MAP_PICKER_SKELETON
- PASS 25G — MAP_PIN_TO_DESTINATION_CANDIDATES
- PASS 25H — LIVE_FIELD_TEST

Typed stop search note:

- stop-name search remains fallback/advanced path
- it is no longer the primary UX direction

