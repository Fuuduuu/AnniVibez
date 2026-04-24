# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**Pass 8 (Mermaid docs mapping) on tehtud ja accepted.**

Pass 8 tulemus:
- Mermaid project mapping pass accepted
- `docs/PROJECT_MAP.md` added
- `docs/PROJECT_MINI_MAP.md` added
- commit: `825af77` (`Add Mermaid project maps`)
- scope did not change
- no code/runtime/deploy settings changed
- post-commit `git status --short` was clean

## Järgmine lukustatud töö

Praegune lukustatud järgmine faas:
- **PASS 9 — optional post-deploy follow-up only**
- optional real Android Chrome physical-device smoke documentation
- optional OPENAI_API_KEY Cloudflare setup documentation/check
- docs-only updates

## Selles passis lubatud

- optional real Android Chrome physical-device smoke documentation
- optional OPENAI_API_KEY Cloudflare setup documentation/check
- docs-only updates

## Selles passis mitte lubatud

- no feature work
- no Trends
- no redesign
- no broad refactor
- no secrets in repo

## Decision gate

Pass 9 loetakse lõpetatuks ainult siis, kui:
1. optional follow-up docs on uuendatud kitsalt
2. optional real-device smoke staatus on dokumenteeritud (kui tehtud)
3. OPENAI_API_KEY Cloudflare setup/check staatus on dokumenteeritud (kui tehtud)
4. feature/redesign/Trends/broad-refactor scope ei avane

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
