# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**Pass 2 (docs-only integrity) on tehtud.**

Pass 2 tulemus:
- clean repo buildability on kontrollitud
- blockerid on dokumenteeritud
- `docs/CODEBASE_MAP.md` ja `docs/CHANGE_SURFACES.md` on loodud

Praegune lukustatud järgmine faas:
- **Pass 3 — narrow restore pass (implementation)**
- kitsas taastamispass
- mitte redesign
- mitte broad refactor

## Järgmine lukustatud töö

Täita ainult:
- taasta `index.html`
- taasta `functions/api/ullata.js`
- käivita build verifikatsioon

## Selles passis lubatud

- kitsad taastused puuduvale runtime/build-kriitilisele pinnale
- build kontroll
- minimaalne vajalik muudatus

## Selles passis mitte lubatud

- redesign
- broad refactor
- backendisuuna laiendamine
- Trendid v1-sse
- deploy töö
- production-hardening laias mõttes
- mitu implementation-passi järjest

## Decision gate

Pass 3 loetakse lõpetatuks ainult siis, kui:
1. `index.html` on taastatud
2. `functions/api/ullata.js` on taastatud
3. `npm run build` läheb läbi

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
