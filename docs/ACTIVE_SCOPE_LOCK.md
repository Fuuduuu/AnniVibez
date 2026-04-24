# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**Pass 10 (Cloudflare Git-backed deploy verification/fix) on tehtud ja accepted.**

Pass 10 tulemus:
- GitHub latest `main` commit:
  - `121a8e2fb1f3299f9b6046d6669a5c0c36e29ab1`
- Cloudflare source verified:
  - GitHub `Fuuduuu/AnniVibez`, branch `main`
- latest production deployment:
  - `238aef14`
  - trigger `github:push`
  - status `success`
- deployment used latest `main` commit
- future automatic deploys: `GO`
- manual Wrangler deploy: fallback only
- old `165d23e` drift is downgraded to monitor-only history note

## Järgmine lukustatud töö

Praegune lukustatud järgmine faas:
- **PASS 11 — BUS_LOGIC_PASS**
- destination/upcoming sequence logic only
- hoia pass kitsas ja kontrollitav

## Selles passis lubatud

- ainult bussi destination/upcoming sequence loogika
- failid:
  - `src/utils/bus.js`
  - `src/components/BussTab.jsx`
- vajalik säilitada:
  - nearest stop-point logic
  - `BUS_DATA.patterns`
  - Õie/Tulika stopId distinction
  - `docs/BUS_LOGIC_LOCK.md` rules

## Selles passis mitte lubatud

- no feature work
- no Trends
- no redesign
- no broad refactor
- no secrets in repo
- no deploy settings changes

## Decision gate

Pass 11 loetakse lõpetatuks ainult siis, kui:
1. destination logic kasutab pattern/stopId suuna reeglit
2. no-destination käitumine jääb alles
3. build/verification tulemus on kirjas
4. docs-checkpoint on uuendatud
5. feature/redesign/Trends/broad-refactor scope ei avane

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
