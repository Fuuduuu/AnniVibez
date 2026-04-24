# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**Pass 1 on lõpetamisel / lõpetatud:** governance bootstrap.

Praegune lukustatud järgmine faas:
- **Pass 2 — codebase mapping**
- docs-only
- ilma koodimuudatusteta

## Järgmine lukustatud töö

Täita:
- `docs/CODEBASE_MAP.md`
- vajadusel `docs/CHANGE_SURFACES.md`

See pass peab:
- kaardistama olemasoleva `src/`, `functions/`, `public/` pinna
- märkima high-impact muutuspinnad
- mitte avama refaktorit

## Selles passis lubatud

- docs-only audit
- codebase mapping
- canonical failide viidete korrastus
- open questionite märkimine

## Selles passis mitte lubatud

- koodimuudatused
- refaktor
- backendisuuna laiendamine
- Trendid v1-sse
- deploy töö
- production-hardening
- uus implementation pass ilma checkpointita

## Decision gate

Pärast Pass 2 tohib avada ainult **ühe** väikese implementation passi, näiteks:
- bugfix
- UI polish
- üks lokaalne cleanup
- üks docs-sync

Mitte:
- suur refaktor
- backendi ümberpööre
- mitu implementation-passi järjest

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
