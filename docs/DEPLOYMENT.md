# DEPLOYMENT.md

Status: PASS 24 docs-only deploy/env documentation.

## 1. Current production target

- Project: `AnniVibe`
- Cloudflare Pages project name: `annivibe`
- Canonical URL: `https://annivibe.pages.dev`
- Build output: `dist`
- Build command: `npm run build`
- Deploy command:
  - `npx wrangler pages deploy dist --project-name annivibe`

## 2. Required local tools

- Node.js + npm installed
- Wrangler via `npx` (project does not require global install)

Recommended command sequence:

```powershell
npm install
npm run build
npx wrangler whoami
npx wrangler pages project list
npx wrangler pages deploy dist --project-name annivibe
```

## 3. Cloudflare Pages secrets / env vars

`functions/api/ullata.js` currently uses:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Where to configure:

- Cloudflare Dashboard -> Pages -> `annivibe` -> Settings -> Environment variables (Production)

Rules:

- do not commit real secrets
- local `.env*` files are local-only and must not be committed
- provider chain is `Gemini -> OpenAI -> local`
- if provider keys are missing/failing, `/api/ullata` returns `source=local`

## 4. Deploy verification checklist

Before deploy:

- `git status --short`
- `npm run build`

Deploy:

- `npx wrangler pages deploy dist --project-name annivibe`

After deploy:

- check deploy URL returns HTTP `200`
- check canonical `https://annivibe.pages.dev` returns HTTP `200`
- confirm canonical HTML references current generated bundle asset
- run `/api/ullata` POST smoke test and confirm HTTP `200` + `source` (`gemini` / `openai` / `local`)
- check `git status` is clean or contains only intentional changes

PowerShell-friendly API smoke example:

```powershell
$body = @{
  with = "sõbraga"
  time = "30 min"
  mood = @("rahulik")
  material = @("paber")
  variationNonce = 1
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://annivibe.pages.dev/api/ullata" -Method Post -ContentType "application/json" -Body $body
```

## 5. Known Wrangler/Cloudflare recovery notes

Possible temporary Cloudflare/Wrangler auth/API issue symptoms seen before:

- `wrangler pages deploy` failed with Cloudflare API `code: 10500`
- `Internal authentication error`
- `wrangler@latest` failed once with `503` while fetching auth token
- canonical URL stayed on older bundle until retry succeeded

Recovery steps:

1. Check auth:
   - `npx wrangler whoami`
2. Check project access:
   - `npx wrangler pages project list`
3. Retry with latest Wrangler:
   - `npx wrangler@latest pages deploy dist --project-name annivibe`
4. If auth appears broken:
   - `npx wrangler logout`
   - `npx wrangler login`
5. Check environment token conflicts:
   - `Get-ChildItem Env:CLOUDFLARE*`
   - `Get-ChildItem Env:CF_*`
6. Retry deploy later if API/auth issue appears temporary.
7. Manual dashboard upload of `dist` is temporary live-smoke fallback only.

## 6. PWA/cache note

- Canonical may still briefly look stale on mobile/PWA after deploy.
- If test result seems old:
  - open deploy URL first
  - clear site data if needed
  - verify bundle asset name in served HTML

## 7. Git workflow

- commit/push only after validation
- do not commit `dist` unless explicitly required
- start new passes from a clean working tree
- dirty deploys are acceptable for smoke only; accepted work should be committed

