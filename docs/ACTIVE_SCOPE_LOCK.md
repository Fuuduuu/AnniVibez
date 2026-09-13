# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**LOCK00 — MINIMAL_ROUTING_SCOPE_UPDATE (docs-only).**

Accepted runtime baseline: `5a27600268bce8e9b1b20e05844d4ed3c435a7a1`.
- `2bf9830`: simplified bus UX
- `9e6e142`: route-row key fix
- `5a27600`: nearby departures

LOCK00 supersedes older next-pass declarations in `docs/SESSION_BOOT.md`,
`docs/TRUTH_INDEX.md` and `docs/ACCEPTED_CHECKPOINTS.md`; those declarations
are historical, not current work authority. Routing migration rules live in
`docs/BUS_LOGIC_LOCK.md`; legacy API preservation is not a future architecture mandate.

## Historical pass results (superseded scope, not current authority)

PASS 25A runtime tulemus:
- route recommendation cards said selgema "kuidas kohale saada" konteksti
- lisati destination/get-off kontekst:
  - `Mine peatusesse: ...`
  - `Sõida liiniga: ...`
  - `Välju peatuses: [selected destination]`
- destination-first flow jäi stabiilseks
- route wrapper jäi olemasoleva engine peal:
  - `depsWithMeta(...)` unchanged
  - `displayCodes || codes || [code]` handling unchanged
  - nearby fallback (max 2) unchanged
- map UI/runtime tuge ei lisatud
- `src/utils/bus.js` ja `src/data/busData.js` jäid muutmata

PASS 26A docs-only tulemus:
- lisati `docs/PROMPT_SYSTEM.md`
- uuendati `docs/PROMPT_TEMPLATES.md` kompaktsete PASS-pohiste mallidega
- lisati `docs/MERMAID_DIAGRAMS.md` (diagram opportunities + starter diagrams)
- runtime/source koodi ei muudetud
- map/bus/Üllata loogikat ei muudetud

PASS 24 docs-only tulemus:
- lisati deploy/env dokumentatsioon: `docs/DEPLOYMENT.md`
- lisati turvaline env näidis: `.env.example` (ainult nimed/placeholders)
- runtime/source koodi ei muudetud

PASS 25B docs-only tulemus:
- lisati POI/place-first sihtkoha mudeli plaan:
  - `docs/BUS_POI_DESTINATION_PLAN.md`
- stop-name search alandati fallback/advanced teeks
- destination-first flow ja olemasolev bus engine jäid lukku:
  - `depsWithMeta(...)` unchanged
  - `nearest(...)` unchanged
  - `displayCodes || codes || [code]` handling unchanged
- map/runtime implementatsiooni ei lisatud

PASS 25C data-only tulemus:
- lisati `src/data/poiData.js`
- POI dataset on lisatud ilma UI ühenduseta
- bus engine/runtime käitumist ei muudetud

PASS 26B docs-only tulemus:
- lisati `docs/CURRENT_STATE.md` madala tokenikuluga state-entrypointina
- lisati `docs/TOKEN_BUDGET_RULES.md` prompt/read optimeerimise reeglitega
- prompt docs viitavad nüüd vaikimisi lühikesele read-first mudelile
- runtime/source koodi ei muudetud

## Järgmine lukustatud töö

Praegune lukustatud järgmine faas:
- After LOCK00: **DATA01 — NORMALIZED_TIMETABLE_SOURCE** implementation is authorized.
- DATA01 is limited to normalized timetable source work, not runtime routing/UI changes.

## Selles passis lubatud

- LOCK00: minimal updates to `docs/ACTIVE_SCOPE_LOCK.md` and `docs/BUS_LOGIC_LOCK.md`.
- Update `docs/CURRENT_STATE.md` only to remove conflicting live guidance.
- No runtime changes in LOCK00; this does not revoke the accepted runtime baseline.
- No new documentation artifacts or wider documentation refresh.

## Selles passis mitte lubatud

- no bus engine rewrite
- no map picker implementation
- no external geocoding
- no unrelated runtime/provider refactors
- no Trends
- no redesign
- no broad refactor
- no secrets in repo
- no deploy settings changes

## Decision gate

LOCK00 completion requires:
1. Stop identity, transitional APIs and future routing direction are consistent with `docs/BUS_LOGIC_LOCK.md`.
2. `git diff --check` passes and active guidance is checked for superseded rules.
3. Only the allowed existing docs change; no runtime changes or new artifacts.
4. DATA01 is the next authorized pass; runtime routing/UI changes require later passes.

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
