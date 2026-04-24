# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**Pass 5 (mobile QA / pre-deploy smoke test) on tehtud ja accepted.**

Pass 5 tulemus:
- `npm run build` läheb läbi
- local dev smoke test läbib
- bottom nav läbib
- `Kodu` / `Buss` / `Loo` / `Päevik` / `Tugi` / `Seaded` läbisid
- `Loo -> Joonistamise nipid` count `17` läbib
- `Loo -> Üllata` tagastas idee/fallbacki
- console runtime critical errors/warnings = `0`
- GO otsus on fikseeritud
- limitation: real Android Chrome same-Wi-Fi physical device test ei olnud selles Codex sessioonis tehtud

Praegune lukustatud järgmine faas:
- **Pass 6 — narrow deploy-prep verification**
- real Android Chrome smoke test kui seade on saadaval
- deploy-prep sanity kontroll
- mitte broad implementation pass

## Järgmine lukustatud töö

Täita ainult:
- real Android Chrome same-Wi-Fi smoke test (optional/recommended before deploy)
- deploy-prep sanity kontroll
- dokumenteeri deploy-eelne otsus

## Selles passis lubatud

- real Android Chrome smoke test, kui füüsiline seade on saadaval
- deploy-prep sanity verifikatsioon
- kitsas riski/blockeri logi

## Selles passis mitte lubatud

- feature work
- redesign
- Trendid
- broad refactor
- backendisuuna laiendamine
- deploy töö
- production-hardening laias mõttes
- mitu implementation-passi järjest

## Decision gate

Pass 6 loetakse lõpetatuks ainult siis, kui:
1. deploy-prep sanity on tehtud ja dokumenteeritud
2. kriitilised blockerid on kas puuduvad või üheselt kirjas
3. optional/recommended real Android smoke staatuse märge on kirjas
4. feature/redesign/Trends/broad-refactor scope ei avane

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
