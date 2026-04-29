# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**PASS 26A (PROMPT_SYSTEM_AND_MERMAID_DOCS_SYNC) on tehtud ja accepted (docs-only).**

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

## Järgmine lukustatud töö

Praegune lukustatud järgmine faas:
- **PASS 25B — TYPED_STOP_SEARCH**
- add typed stop search over existing stop/group names
- hoia pass kitsas ja kontrollitav

## Selles passis lubatud

- typed stop search in existing destination-first flow
- destination dropdown fallback must remain
- no map rendering/UI work
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

Pass 25B loetakse lõpetatuks ainult siis, kui:
1. typed stop search works over existing known stop/group names
2. destination-first flow remains stable
3. destination dropdown fallback remains available
4. checkpoint docs on sünkroonitud
5. broad scope does not reopen

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
