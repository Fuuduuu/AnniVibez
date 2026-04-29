# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**PASS 26B (TOKEN_BUDGET_AND_WORKFLOW_OPTIMIZATION) on tehtud (docs-only).**

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
- **PASS 26C — WORKFLOW_AND_BUS_LOGIC_DIAGRAMS**
- add workflow and bus-logic Mermaid docs in a narrow docs-only pass
- hoia pass kitsas ja kontrollitav

## Selles passis lubatud

- docs-only workflow/diagram planning updates
- no runtime/source changes
- checkpoint docs sync

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

Pass 26C loetakse lõpetatuks ainult siis, kui:
1. workflow/bus-logic diagram scope on dokumenteeritud kitsalt
2. runtime/source faile ei muudeta
3. checkpoint docs on sünkroonitud
4. broad scope does not reopen

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
