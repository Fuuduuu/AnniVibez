# POST_DEPLOY_FOLLOWUPS.md

## Scope

PASS 8 docs-only follow-up planning.  
No code changes. No secret values in repo.

## Current deploy verification baseline (2026-04-24)

- latest validated manual Wrangler deploy:
  - `https://b9e6bc21.annivibe.pages.dev`
- production alias currently matched this manual deploy during verification:
  - `https://annivibe.pages.dev`
- `/api/ullata` check returned JSON with:
  - `idea`
  - `source=local`
- until Git-backed deployment path is re-verified, use the manual deployment above as the primary validation baseline.

## Known Cloudflare follow-up

- Git-backed Cloudflare Pages deploy flow had an old commit drift issue:
  - build source observed at old commit `165d23e`
- this remains non-closed and must be verified/fixed in a narrow deploy follow-up pass.

## Optional runtime env setup (Cloudflare Pages)

Project: `annivibe`  
Environment: Production

1. Open Cloudflare Dashboard -> Pages -> `annivibe` -> Settings -> Environment variables.
2. Add server-side variable:
   - `OPENAI_API_KEY` = your secret key (do not expose in frontend).
3. Optional variable:
   - `OPENAI_MODEL` = `gpt-4o-mini` (default recommendation).
4. Save changes.

## Redeploy after env changes

Use one of:
- Trigger new production deploy from Cloudflare Pages Deployments UI.
- Push a new commit to `main` to trigger GitHub-connected production deploy.

## Verify `/api/ullata` after setup

Example check:

```powershell
Invoke-RestMethod -Uri "https://annivibe.pages.dev/api/ullata" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"with":"endale","materials":["paber ja pliiatsid"],"time":10,"mood":["joonista"]}'
```

Expected:
- response is JSON
- response contains `idea`
- response contains `source`
- after valid key setup, preferred `source=openai`

Fallback note:
- if `OPENAI_API_KEY` is missing or unavailable, `source=local` is acceptable fallback for v1.

## Optional physical-device smoke

Recommended before wider rollout:
- real Android Chrome test on same Wi-Fi
- verify app opens, bottom nav, core tabs, and `Loo -> Üllata` basic flow
