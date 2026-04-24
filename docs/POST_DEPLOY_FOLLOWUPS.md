# POST_DEPLOY_FOLLOWUPS.md

## Scope

PASS 8 docs-only follow-up planning.  
No code changes. No secret values in repo.

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
