# DEPLOYMENT.md

Status: R0 deployment/recovery documentation safety repair, pending independent review. This document is not deployment authorization. Earlier direct-deploy and recovery recipes are superseded.

## Current authority and target

Before any deployment, post-deployment check, credential change, or recovery action, read `docs/SESSION_BOOT.md`, `docs/CURRENT_STATE.md`, and `docs/ACTIVE_SCOPE_LOCK.md`. Follow the separately authorized gate for that action; this guide does not open one.

At this checkpoint, current governance confirms the Cloudflare Pages **project** as `majandus`. `https://annivibe.pages.dev` is the production **hostname**, not the project name. The older `annivibe` project reference in historical instructions is not a current target and must not be inferred from the hostname. Confirm the target through current governance, not an old command or example.

Phase 10 step 4 remains IN PROGRESS: its remaining production/relevant preview configuration review is read-only and BLOCKED PENDING EXPLICIT HUMAN AUTHORIZATION. Step 5's pre-bind configuration snapshot, binding-preservation/rollback proof, D1 binding, and deployment/activation are later separate locked gates. The dedicated Majandus D1 is CREATED / MIGRATED / VERIFIED / UNBOUND / UNDEPLOYED; the application is not using it. Real-user readiness is NOT GRANTED. A Git push is not production deployment authorization. Current governance records automatic production deployments as disabled; do not infer future Cloudflare behavior from that historical configuration record.

## Local preparation is not a remote action

The following are local checks only; they do not authorize a deploy or prove production state:

```powershell
git status --short --untracked-files=all
npm run build
```

Use only the tooling and version fixed by the separately accepted release procedure for an authorized release. Do not upgrade to a mutable `wrangler@latest` as a deployment recovery step. This R0 pass selects no Wrangler version and runs no build or remote command.

Remote account/project reads, Pages configuration or secret changes, D1 access, binding, deployment, and live API smoke each require the applicable explicit authorization. Do not turn a local build, an old deployment URL, an API failure, or a temporary authentication error into a retry, manual upload, or another remote operation without that gate. An ambiguous deployment result requires stopping and separately authorized verification, not an automatic retry.

## Credential-safe environment guidance

The earlier guide listed `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENAI_API_KEY`, and `OPENAI_MODEL` for `/api/ullata`; that list is historical context, not a current remote configuration inventory or permission to change it. If a later authorized pass needs an environment check, verify only the required variable **names and presence** under its approved procedure. Never print credential values to a terminal, log, transcript, ticket, or chat; never commit them to the repository. Do not use broad environment listings that display values. Secret creation or modification is a separate remote gate.

## Stale bundle or installed-PWA recovery

Browser storage is not disposable cache. This local-first app can hold household, calendar, and saved-place state in IndexedDB and localStorage, along with device-local diary/preferences and rollback material. Remote D1 is not currently connected to the app and must not be presented as a restore source for local user data.

For an already authorized release verification, first identify the intended release and observed asset version using only checks permitted by that pass. On an existing user profile, try a normal page reload or browser refresh, or close and reopen the installed PWA. If cache-specific troubleshooting is needed, limit it to HTTP or service-worker cache/update behavior that preserves IndexedDB and localStorage. A disposable test profile with no user data can help distinguish a stale cache from a release problem. Do not treat an old-looking page as permission to deploy again.

**Destructive, not routine recovery:** clearing all site data, deleting IndexedDB, deleting localStorage, or removing durable application state can erase unsynchronized user data and rollback evidence. Never recommend those actions as cache cleanup on an existing installation. They belong only in an explicitly disposable test profile or a separately approved data-preservation/recovery procedure. No general remote restore mechanism is established here; if durable data may be at risk, stop and seek that separate procedure rather than deleting it.

## Historical instructions — SUPERSEDED / DO NOT EXECUTE

Earlier versions of this guide named `annivibe` as the Pages project and supplied direct Wrangler deploy, `wrangler@latest` retry, login/logout, project-list, environment-value listing, manual dashboard upload, and live `/api/ullata` smoke recipes. They reflected an older deploy context, including temporary Cloudflare API/authentication failures and a stale mobile bundle. None is an active procedure or authorization. Consult the current authority and obtain the specific gate before any equivalent remote action; do not copy an old recipe into a new release.

