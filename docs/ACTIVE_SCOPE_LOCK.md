# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**LOCK01 - MINIMAL_SCOPE_REFRESH (docs-only).**

Accepted committed runtime baseline: `c1e84693256f0492048bdf4962e7fa295db1441d`.
Current accepted implementation is summarized in `docs/CURRENT_STATE.md`;
LIVE / FIELD SMOKE of this baseline is the next action, not a completed result.

Historical bus UX checkpoints (included in the current baseline):
- `2bf9830`: simplified bus UX
- `9e6e142`: route-row key fix
- `5a27600`: nearby departures

LOCK01 supersedes older next-pass declarations in `docs/SESSION_BOOT.md`,
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
- **LIVE / FIELD SMOKE**.
- Runtime feature development is **PAUSED until live smoke result**.

## Selles passis lubatud

- LOCK01: minimal stale-guidance updates to `docs/ACTIVE_SCOPE_LOCK.md`, `docs/CURRENT_STATE.md` and, where needed, `docs/BUS_LOGIC_LOCK.md`.
- No runtime changes in LOCK01; this does not revoke the accepted runtime baseline.
- No new documentation artifacts or wider documentation refresh.

## Selles passis mitte lubatud

- no bus engine rewrite
- no new runtime features, including map changes, pending live smoke result
- no external geocoding
- no unrelated runtime/provider refactors
- no Trends
- no redesign
- no broad refactor
- no secrets in repo
- no deploy settings changes

## Decision gate

LOCK01 completion requires:
1. Concrete stop identity, transitional APIs and the implemented shared `busReach` read-model are consistent with `docs/BUS_LOGIC_LOCK.md`.
2. `git diff --check` passes and active guidance is checked for superseded rules.
3. Only the allowed existing docs change; no runtime changes or new artifacts.
4. LIVE / FIELD SMOKE is next; runtime feature development remains paused until its result.

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
