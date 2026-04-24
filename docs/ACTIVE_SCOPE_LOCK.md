# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**Pass 9 (deploy verification + manual Wrangler deploy checkpoint) on tehtud ja accepted.**

Pass 9 tulemus:
- verification workdir: `C:\Users\Kasutaja\Desktop\AnniVibez_clean`
- `git status --short` clean
- `npm run build` succeeded
- manual deploy verified: `https://b9e6bc21.annivibe.pages.dev`
- production alias verified: `https://annivibe.pages.dev`
- `/api/ullata` POST returned JSON with `idea` and `source` (`local`)
- GO for current deploy validation baseline
- known follow-up retained:
  - Git-backed Cloudflare deploy had old commit issue (`165d23e`)

## Järgmine lukustatud töö

Praegune lukustatud järgmine faas:
- **PASS 10 — narrow follow-up selection**
- vali täpselt üks:
  - Cloudflare Git integration verification/fix (preferred)
  - või Buss destination/upcoming sequence logic jätk
- ära ava mõlemat korraga
- hoia pass kitsas ja kontrollitav

## Selles passis lubatud

- kui valik on deploy:
  - Cloudflare Git integration probleemi verifitseerimine/parandus
  - deploy-verification ja docs-checkpoint
- kui valik on buss:
  - ainult destination/upcoming sequence logic kitsal pinnal
  - failid: `src/utils/bus.js`, `src/components/BussTab.jsx`
- optional real Android Chrome physical-device smoke documentation
- optional OPENAI_API_KEY setup/check documentation

## Selles passis mitte lubatud

- no feature work
- no Trends
- no redesign
- no broad refactor
- no secrets in repo

## Decision gate

Pass 10 loetakse lõpetatuks ainult siis, kui:
1. valitud kitsas rada (deploy või buss) on tehtud lõpuni
2. teise raja scope ei avata samas passis
3. build/verification tulemus on kirjas
4. docs-checkpoint on uuendatud
5. feature/redesign/Trends/broad-refactor scope ei avane

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
