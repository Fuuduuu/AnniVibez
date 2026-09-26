# POST_DEPLOY_FOLLOWUPS.md

Status: R0 post-deployment documentation safety repair, pending independent review. This document records historical observations and future gate boundaries; it does not authorize a Cloudflare read, configuration change, deployment, or live smoke test.

## Current authority

Read `docs/SESSION_BOOT.md`, `docs/CURRENT_STATE.md`, and `docs/ACTIVE_SCOPE_LOCK.md` before using any release or post-release guidance. At this checkpoint, the confirmed Pages **project** is `majandus`; `annivibe.pages.dev` is its production **hostname**. The former `annivibe` project label below is historical, not a target to select. Do not infer a project from a hostname or old deployment URL.

Current governance records automatic production deployments as disabled/paused. Pushing to `main` is **not** production deployment authorization and must not be described as a reliable trigger. A future configuration may differ; checking it requires a separately authorized read-only gate. Phase 10 step 4 remains IN PROGRESS, with the current production/relevant preview configuration review BLOCKED PENDING EXPLICIT HUMAN AUTHORIZATION. Step 5 pre-bind snapshot, binding-preservation/rollback proof, binding, deployment/activation, client/runtime integration, and real-user readiness remain separately locked or ungranted. The remote Majandus D1 is CREATED / MIGRATED / VERIFIED / UNBOUND / UNDEPLOYED, and the application is not using it.

## Historical 2026-04-24 evidence — SUPERSEDED / NOT A CURRENT RELEASE BASELINE

An earlier manual Wrangler deployment was observed at `https://b9e6bc21.annivibe.pages.dev`; at that time the production hostname matched it, and a `/api/ullata` check returned `idea` with `source=local`. The old Git-backed deployment investigation observed source drift to commit `165d23e`. These are dated observations, not current production verification, a target-selection rule, or a reason to rerun a deployment. The old advice to use that manual deployment as the primary baseline is superseded by the accepted C8 production record in current governance.

The previous optional environment-variable setup, dashboard redeploy, main-push redeploy, and live API example were historical instructions and are **DO NOT EXECUTE** from this document. In particular, no push, secret change, or manual upload substitutes for the current target, configuration, preservation, binding, and deployment gates.

## Later follow-ups require separate scope

If provider configuration is separately authorized in the future, establish the required environment-variable **names and presence** under that pass; do not print or paste secret values into terminals, logs, tickets, or chat. The historical guide mentioned `OPENAI_API_KEY` and `OPENAI_MODEL`, but this is not a current remote inventory or authorization to add or change them. A live `/api/ullata` check and physical-device smoke also need a bounded, approved release/verification pass. Their results cannot be assumed from the historical 2026-04-24 response.

For a stale page or installed PWA, use the data-preserving cache guidance in `docs/DEPLOYMENT.md`. Clearing all site data, IndexedDB, or localStorage is destructive to potentially durable user data, not routine cache cleanup. Restrict such deletion to an explicitly disposable test profile or a separately approved data-preservation/recovery procedure. Do not claim the unbound remote D1 can restore local user data.
