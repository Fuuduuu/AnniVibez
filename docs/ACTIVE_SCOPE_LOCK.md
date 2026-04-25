# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**PASS 23C (DESTINATION_FIRST_CHECKPOINT_AND_COMMIT_PREP) on tehtud ja checkpoint-ready.**

PASS 23C tulemus:
- PASS 23B destination-first MVP valideeriti source/build/deploy tasemel
- live smoke deploy:
  - `https://968d08cb.annivibe.pages.dev`
- canonical `https://annivibe.pages.dev` teenindas bundle-t:
  - `assets/index-DjBNfPlr.js`
- `/api/ullata` POST vastas `source=gemini`
- `depsWithMeta(...)` jäi muutmata
- `src/data/busData.js` jäi muutmata
- map tuge ei lisatud
- pass on checkpoint/commit-prep valmis

## Järgmine lukustatud töö

Praegune lukustatud järgmine faas:
- **PASS 23D — BUS_MAP_DESTINATION_PICKER_PLANNING_ONLY**
- map picker direction/plan docs-only (no implementation)
- hoia pass kitsas ja kontrollitav

## Selles passis lubatud

- docs-only planning updates for future map picker direction
- checkpoint docs sync
- no runtime logic changes

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

Pass 23D loetakse lõpetatuks ainult siis, kui:
1. map picker töö on kirjas planning-only kujul
2. runtime koodi ei muudeta
3. checkpoint docs on sünkroonitud
4. broad scope does not reopen
5. feature/redesign/Trends/broad-refactor scope ei avane

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
