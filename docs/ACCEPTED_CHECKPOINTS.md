# ACCEPTED_CHECKPOINTS.md

## Accepted checkpointid

### 1. Initial governance baseline
**Staatus:** accepted

Sisu:
- 4-failine minimaalne truth-layer on defineeritud
- canonical docs mudel on valitud
- Pass 1 on docs-only

### 2. Current app baseline (target direction)
**Staatus:** accepted

Sisu:
- AnniVibe v1 scope on fikseeritud:
  - Kodu
  - Buss
  - Loo
  - Päevik
  - Tugi
  - Seaded
- Trendid ja Loo oma trend on v1-st väljas
- `src/` on canonical app baseline
- `/api/ullata` route on oodatud arhitektuurne suund
- saved places shape on `{ name, address, lat, lon }`

### 3. Clean repo integrity verification (blocked baseline)
**Staatus:** accepted

Sisu:
- `npm install` succeeded
- `npm run build` failed with:
  - `[vite-plugin-pwa:build] Could not resolve entry module "index.html"`
- `index.html` is missing
- `functions/api/ullata.js` is missing
- `public/manifest.webmanifest` exists but references missing `/screenshots/kodu.png`
- repo is **not build-ready yet**

### 4. Pass 2 docs-only integrity mapping
**Staatus:** accepted

Sisu:
- `docs/CODEBASE_MAP.md` created
- `docs/CHANGE_SURFACES.md` created
- blocker state documented without code changes

### 5. Pass 3 restore build runtime baseline
**Staatus:** accepted

Sisu:
- `index.html` restored
- `functions/api/ullata.js` restored
- `npm run build` succeeded
- `git status --short` clean
- `main` is synced with `origin/main` (`0 0`)

### 6. Pass 4 manifest screenshot cleanup
**Staatus:** accepted

Sisu:
- `public/manifest.webmanifest` `screenshots` section removed
- `/screenshots/kodu.png` manifest blocker closed
- `npm run build` succeeded after change

### 7. Pass 5 mobile QA / pre-deploy smoke test
**Staatus:** accepted

Sisu:
- `npm run build` succeeded
- local dev server smoke test passed
- bottom nav passed
- `Kodu` / `Buss` / `Loo` / `Päevik` / `Tugi` / `Seaded` passed
- `Loo -> Joonistamise nipid` count `17` passed
- `Loo -> Üllata` returned idea/fallback passed
- console runtime critical errors/warnings = `0`
- GO decision recorded
- limitation: real Android Chrome same-Wi-Fi physical device smoke test was not completed in this Codex session

### 8. Pass 7 Cloudflare Pages deploy
**Staatus:** accepted

Sisu:
- Cloudflare auth worked
- Pages project `annivibe` exists
- GitHub source connected: `Fuuduuu/AnniVibez`, branch `main`
- build command: `npm run build`
- output dir: `dist`
- root dir: repo root (`/`)
- functions directory: `functions`
- production deploy succeeded
- live URL: `https://annivibe.pages.dev`
- deployment URL: `https://3a1eeec4.annivibe.pages.dev`
- live smoke test passed in mobile viewport `390x844`
- app opens
- bottom nav works
- `Kodu` / `Buss` / `Loo` / `Päevik` / `Tugi` / `Seaded` pass
- `Loo -> Joonistamise nipid` count `17` pass
- `Loo -> Üllata` returned idea/fallback pass
- `/api/ullata` POST returned JSON with `idea` and `source`
- `/api/ullata` source currently = `local`
- console errors/warnings/page errors = `0/0/0`
- GO decision recorded
- no critical deploy blockers remain

### 9. Pass 8 Mermaid docs mapping pass
**Staatus:** accepted

Sisu:
- Mermaid project mapping pass accepted
- `docs/PROJECT_MAP.md` added
- `docs/PROJECT_MINI_MAP.md` added
- commit: `825af77` (`Add Mermaid project maps`)
- scope did not change
- no code/runtime/deploy settings changed
- post-commit `git status --short` was clean

### 10. Pass 9 deploy verification + manual Wrangler deploy checkpoint
**Staatus:** accepted

Sisu:
- verification workdir: `C:\Users\Kasutaja\Desktop\AnniVibez_clean`
- `git status --short` clean
- `npm run build` succeeded
- manual Wrangler deployment URL verified:
  - `https://b9e6bc21.annivibe.pages.dev`
- production alias verified:
  - `https://annivibe.pages.dev`
- both URLs returned `200` and same frontend asset hash:
  - `assets/index-DuNsa792.js`
- `/api/ullata` POST returned JSON with:
  - `idea` (object)
  - `source` (`local`)
- current validation baseline is manual deployment `b9e6bc21`
- GO for deploy validation on manual deployment
- follow-up remains open:
  - Cloudflare Git-backed deploy path previously built old commit `165d23e`

## Accepted not-yet-done areas

Need on teadaolevad puuduvad või lõpetamata osad, aga ei ava automaatselt uut scope’i:

- `OPENAI_API_KEY` not yet configured in Pages runtime; current `source=local` fallback is expected
- optional real Android Chrome same-Wi-Fi physical-device smoke remains recommended
- optional docs-only setup note for server-side secret handling
- Cloudflare Git-backed deploy path must be re-verified/fixed (old commit `165d23e` issue)

## Rejected / quarantine

### 1. Trends in v1
**Staatus:** rejected current scope jaoks

Põhjus:
- teadlikult v1-st väljas
- scope drift risk

### 2. Broad refactor / backend direction rewrite
**Staatus:** quarantine

Põhjus:
- vastuolus kitsa-passilise töökorraldusega
- nõuab eraldi locki

## Praegune aktiivne faas

- Pass 9 manual deploy verification checkpoint completed (docs-only)
- järgmine on PASS 10 narrow follow-up selection

## Järgmine lubatud samm

- PASS 10: vali üks kitsas järgmistest
  - Cloudflare Git integration verification/fix (preferred)
  - või Buss destination/upcoming sequence logic jätk
- mõlemat ei tohi teha korraga samas passis
- no feature work
- no Trends
- no redesign
- no broad refactor
- no secrets in repo

## Implementation pass status

- Pass 9 docs-checkpoint pass accepted and closed
- broad implementation pass ilma kitsa lockita: keelatud
