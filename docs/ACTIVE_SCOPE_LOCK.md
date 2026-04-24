# ACTIVE_SCOPE_LOCK.md

## Active truth layer

Loe ja järgi selles järjekorras:
1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

## Praegune faas

**Pass 7 (Cloudflare Pages deploy) on tehtud ja accepted.**

Pass 7 tulemus:
- Cloudflare auth töötas
- Pages projekt `annivibe` olemas
- GitHub source ühendatud: `Fuuduuu/AnniVibez`, branch `main`
- build command: `npm run build`
- output dir: `dist`
- root dir: repo root (`/`)
- functions directory: `functions`
- production deploy õnnestus
- live URL: `https://annivibe.pages.dev`
- deployment URL: `https://3a1eeec4.annivibe.pages.dev`
- mobile viewport smoke (`390x844`) läbis
- app opens, bottom nav works
- `Kodu` / `Buss` / `Loo` / `Päevik` / `Tugi` / `Seaded` passed
- `Loo -> Joonistamise nipid` count `17` passed
- `Loo -> Üllata` returned idea/fallback passed
- `/api/ullata` POST returned JSON with `idea` and `source`
- `/api/ullata` source currently = `local`
- console errors/warnings/page errors = `0/0/0`
- GO otsus on fikseeritud

## Järgmine lukustatud töö

Praegune lukustatud järgmine faas:
- **PASS 8 — post-deploy hardening / optional follow-up planning**
- docs-only planning
- optional OPENAI_API_KEY setup documentation
- optional real-device smoke documentation

## Selles passis lubatud

- docs-only planning
- optional OPENAI_API_KEY setup documentation (server-side only)
- optional real Android Chrome same-Wi-Fi smoke documentation
- kitsas follow-up/riski dokumenteerimine

## Selles passis mitte lubatud

- no Trends
- no redesign
- no broad refactor
- no new feature scope
- no code changes unless explicitly unlocked
- no secret committed to repo

## Decision gate

Pass 8 loetakse lõpetatuks ainult siis, kui:
1. post-deploy follow-up plaan on kitsalt dokumenteeritud
2. OPENAI_API_KEY puudumine on märgitud non-blocking seisuna
3. optional real-device smoke staatus on dokumenteeritud
4. no critical deploy blockers remain
5. feature/redesign/Trends/broad-refactor scope ei avane

## Hooldusreegel

Uuenda seda faili ainult siis, kui:
- aktiivne pass muutub
- uus implementation pass avatakse
- midagi varem future/later kihis olnud tõstetakse aktiivseks
