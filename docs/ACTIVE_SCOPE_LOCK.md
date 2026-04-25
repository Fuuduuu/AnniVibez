# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**PASS 23D (BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY) on tehtud ja accepted (docs-only).**

PASS 23D tulemus:
- map picker arhitektuuriplan dokumenteeriti docs-only passina
- planeeritud dokument:
  - `docs/BUS_MAP_PICKER_PLAN.md`
- lukustatud suund:
  - map picker on destination input wrapper, mitte uus routing engine
- lukustatud phased rollout:
  - PASS 25A: route recommendation enrichment (no map)
  - PASS 25B: typed stop search
  - PASS 25C: destination point/candidate state prep
  - PASS 25D: Leaflet map picker skeleton
  - PASS 25E: map picker integration
  - PASS 25F: map route live smoke
- `depsWithMeta(...)` ja `nearest(...)` jäid muutmata
- runtime/source koodi ei muudetud
- map tuge ei lisatud
- pass on planning/checkpoint valmis

## Järgmine lukustatud töö

Praegune lukustatud järgmine faas:
- **PASS 25A — ROUTE_RECOMMENDATION_ENRICHMENT_NO_MAP**
- enrich route recommendation output without map
- hoia pass kitsas ja kontrollitav

## Selles passis lubatud

- route card enrichment in existing destination-first flow
- no map rendering/UI work
- checkpoint docs sync

## Selles passis mitte lubatud

- no bus engine rewrite
- no map picker implementation
- no unrelated runtime/provider refactors
- no Trends
- no redesign
- no broad refactor
- no secrets in repo
- no deploy settings changes

## Decision gate

Pass 25A loetakse lõpetatuks ainult siis, kui:
1. route recommendation cards annavad selgemat "kuidas kohale saada" infot
2. destination-first flow remains stable
3. runtime map UI ei ole implementeeritud
4. checkpoint docs on sünkroonitud
5. broad scope does not reopen

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
