# AnniVibe / Majandus — independent full-application audit and repair roadmap

Status: **audit checkpoint for independent review; no repair implemented or release authorized**. Audit date: 2026-09-25. Frozen application baseline: `7882f1063d5c0f34017a9af67d5b54d4895f537b`. This document records the completed Astra Ultra audit and the subsequently approved work order. It does **not** claim the findings were reverified at the later governance-only repository HEAD `fc44e8ab1cf03248b7f967258e01cde8c52cdb1f`.

**VERDICT: NOT SAFE FOR NEXT PHASE. BLOCKING: 3; MATERIAL: 10; MINOR: 9.** This rules out an unconditional user-data release/rollback sign-off until the blocking integrity findings are closed; it does not block pure UI design work or assert an authentication-foundation bypass.

## Evidence and scope boundary

- Astra audited an isolated snapshot of the immutable baseline; it did not modify the main repository. The later intervening commit changed governance docs only. The original audit recorded 214/214 snapshot source hashes unchanged.
- Cloudflare calls: **0**. No remote Pages/D1 inspection or mutation, deployment, or production-data read/write occurred in this audit; it neither observed nor caused actual production data loss. The remote resource state below is inherited from committed governance, not freshly verified by Astra.
- Browser checks used isolated localhost production builds, fresh Chromium contexts, and synthetic data. A locally served production build is **not** deployed-production verification. No real user profile was touched.
- Source links below are repository-relative translations of the frozen report's snapshot references; line labels, where present, are the audit's frozen-baseline coordinates, not fresh current-HEAD verification. Reproduction commands and artifact names are historical isolated-workspace evidence, not repository test fixtures.
- The report's design-reference HTML was not treated as current application logic or ported; its earlier design-repair review was not rerun.
- **B-STORAGE-01 is limited to explicit revert mode when Web Locks are unavailable.** It is not a demonstrated ordinary forward-startup data-loss path. **B-STORAGE-02** is a distinct recoverable pre-switch divergence: newer legacy bytes survived, but were not adopted into the active replica. Neither finding claims actual production data loss.
- Strong evidence also supports calendar recurrence/import protections, the exact stop-ID/direction routing core, ordinary transactional shared-domain writes, truthful waste/reminder capability boundaries, and the isolated backend authentication/SQL foundation.

## Findings index

| ID | Severity | Confirmed issue |
|---|---|---|
| B-STORAGE-01 | BLOCKING | Concurrent no-lock revert exporters overwrite a post-revert save |
| BSEC-01 | BLOCKING | One diary tab overwrites an already saved entry from another |
| BSEC-02 | BLOCKING | Diary silently discards a draft after persistence failure |
| B-STORAGE-02 | MATERIAL | Successful pre-switch legacy write is absent from the active replica |
| BUS-01 | MATERIAL | Home/manual departures remain stale after time advances |
| BUS-02 | MATERIAL | Public holidays select the wrong service day |
| BUS-03 | MATERIAL | Late GPS result discards a newer manual route |
| BSEC-03 | MATERIAL | Public idea API reads an oversized body before checking its cap |
| D-DOCS-01 | MATERIAL | Required recovery/deploy guides include destructive or superseded steps |
| UI-01 | MATERIAL | Malformed optional profile can blank the entire shell |
| UI-02 | MATERIAL | Map modal leaves focus and keyboard actions in the background |
| UI-03 | MATERIAL | Creative idea/tip Save reports success after failed writes |
| A11Y-01 | MATERIAL | PIN instruction text has 4.196:1 contrast instead of required 4.5:1 |
| BUS-04 | MINOR | Denied home GPS can leave permanent loading copy |
| BUS-05 | MINOR | Manual origin loses its map position and marker |
| BSEC-04 | MINOR | Expired rate-limit buckets accumulate on new-client traffic |
| BSEC-05 | MINOR | Inherited dictionary keys cause an uncontrolled input exception |
| P-PWA-01 | MINOR | Generated install manifest declares English for Estonian metadata |
| UI-04 | MINOR | Profile success copy ignores persistence failure |
| UI-05 | MINOR | Field prompts lack reliable associations |
| UI-06 | MINOR | Creative choice state is visual only |
| TEST-01 | MINOR | Windows EOL portability in bus evidence tools |

## Detailed findings

The diary findings have stronger corroboration than the initial subagent reports: production-build Chromium confirmed both. Tab A persisted `TAB-A`; Tab B then persisted only `TAB-B` while Tab A still displayed its lost record. Under an injected quota exception, the new entry was shown, the editor was discarded, no alert appeared, and reload showed no entry. These receipts are `evidence/browser/deep-report.json` and `browser-report.json`. No actual user profile was touched.

The map focus finding follows the [W3C modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): the observed background focus/interaction contradicts a claimed modal. That pattern evidence is distinguished from the specific WCAG 1.4.3 contrast failure and from unverified whole-application conformance.

## BLOCKING FINDINGS

### B-STORAGE-01 — BLOCKING — Concurrent no-lock revert exporters overwrite a post-revert save

Confidence: HIGH. Native Chromium IndexedDB reproduction, not only a mock. Scope is the explicit revert build with Web Locks unavailable; the default forward build is not claimed to execute this path.

Files/symbols:

- [src/storage/storageAuthority.js:878](../../src/storage/storageAuthority.js), `continueReverting`; the unchecked export starts at lines 910–917 and completion is at 924–929.
- [src/storage/storageAuthority.js:841](../../src/storage/storageAuthority.js), `completeRevert`; lines 846–849 reject obsolete durable ownership only after the shared keys were written. Line 870 treats an already `reverted` authority with no attempt as successful completion.
- [src/storage/storageAuthority.js:1114](../../src/storage/storageAuthority.js), `boot` explicitly permits execution without Web Locks.
- Accepted plan [docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md:162](../../docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md) says locks are supplemental and correctness comes from transaction guards.

Observed: two controllers can concurrently resume the same durable revert attempt. Controller A has committed `backups-verified` but is delayed before export. Controller B resumes that attempt, exports, commits `reverted`, removes the hint and reaches `LEGACY`. A subsequent ordinary legacy household save succeeds with `canWriteLegacy === true`. When A resumes, it writes its earlier snapshot over the new save. Its completion guard notices that the attempt is gone only after those writes, then the reread accepts B's completed `reverted` record. Both controllers report `LEGACY`; the acknowledged new value exists in neither the current legacy store nor the replica. The original backup predates the lost edit as well.

Expected: a stale/resumed exporter whose attempt has already completed must issue zero shared-key writes; acknowledged post-revert user edits must survive.

Native evidence (`native-races.log`, second JSON line): `secondResult.state=LEGACY`, `guardWhenEdit=true`, `savedNameBeforeResume="User save after successful revert"`, `firstResult.state=LEGACY`, `finalLegacyName="Before"`, `replicaName="Before"`, `finalAuthority="reverted"`.

Reproduction: `node ../evidence/storage/native-races.mjs` from snapshot. The native harness uses two real controller/replica instances and native IDB connections. It holds only A's continuation after its real `backups-verified` transaction completes, lets B complete and an ordinary repository save run, then releases A. This is deterministic scheduling of the exposed race; no domain or authority source code is replaced.

Proven root cause: the export is outside the transaction that checks current authority/attempt ownership. The durable attempt identifies a recoverable operation, but does not exclusively assign its live execution to one tab. Guards on final metadata transitions do not guard preceding localStorage writes.

Minimum safe repair direction: put the first shared-key export write and its completion under one guarded ownership boundary that another live/resumed tab cannot overtake; stale ownership must fail before export. Preserve existing backups, compensation and ambiguous-result rules. A simpler alternative is to fail closed when the required cross-tab exclusion cannot be established, but making Web Locks mandatory explicitly changes the accepted optional-lock contract and needs a narrow design/governance amendment.

Proof tests: two native-IDB revert controllers, barriers before/after phase commit and before export/completion, successful legacy edit between winner completion and loser resumption; assert the loser writes no shared keys and the edit survives. Cover both supplied Web Locks and their absence; retain failure/compensation/resume tests. Also cover a competing forward boot before a paused export resumes.

Test gap: existing no-lock concurrency test at [scripts/storage/indexeddb-browser.test.mjs:1919](../../scripts/storage/indexeddb-browser.test.mjs) races forward boots. Revert tests cover crash resume and mutated attempt identities, but no two live revert exporters with an intervening valid legacy user save.

### BSEC-01 — BLOCKING — One diary tab overwrites an already saved entry from another

- Area: device-local storage/data integrity, diary.
- Files/symbols: [src/hooks/useDiary.js:56-60](../../src/hooks/useDiary.js) (`tryUnlock` captures a snapshot), `:86-110` (`addEntry`, `deleteEntry`, whole-array writes from component state); reachable through [src/App.jsx:305](../../src/App.jsx) and [src/components/ShellViews.jsx:68-69](../../src/components/ShellViews.jsx).
- Observed: two mounted/unlocked diary instances each use their own `entries`. A saves a new entry successfully. B saves its new entry from its older snapshot, replacing the complete persisted array and silently deleting A's already-persisted entry. Both calls return success. IDs in the reproduction are distinct, so this is not an ID collision.
- Expected: a save must preserve changes already committed by another tab, or reject a stale edit with an explicit conflict. Deletion must not reintroduce items removed in another tab either.
- Evidence/reproduction: `offline-repro.mjs`, result `diary_two_instances` in `offline-repro.json`: 2 successful writes, only 1 persisted entry, earlier entry overwritten. The harness evaluates exact snapshot hook source with injected React hook primitives and shared synthetic localStorage; no real browser state was used. The root auditor subsequently confirmed the same overwrite in two real Chromium pages; see the `deep-report.json` receipt named in the isolated-workspace evidence inventory below.
- Impact: reproducible loss of an already committed private diary entry under normal multi-tab/PWA use. This meets the requested BLOCKING data-loss definition even though it does not affect shared IndexedDB data.
- Proven root cause: read-modify-write operates on per-component React state, with no serialization, durable revision check, or storage-change reconciliation.
- Confidence: HIGH; exact-source reproduction and subsequent native Chromium multi-tab confirmation agree.
- Minimum safe repair: separately authorize a narrow device-local diary persistence pass. Serialize the entire read/validate/mutate/write transaction or use an approved transactional device-local store. Preserve the existing diary key contents during any migration; do not add diary sync to the shared backend. A storage-event listener alone is insufficient to make simultaneous read/write atomic.
- Repair proof: two independent contexts concurrently append distinct entries and both survive reload; stale delete cannot resurrect a removed entry; an explicit conflict preserves the draft; PIN and device-local-only behavior remains compatible.

### BSEC-02 — BLOCKING — Diary silently discards a draft after persistence failure

- Area: diary storage/error handling.
- Files/symbols: [src/hooks/useDiary.js:9-16](../../src/hooks/useDiary.js) (`writeEntries`, `writePin` swallow persistence failures), `:86-102` (`addEntry` updates memory and returns success), [src/components/PaeviikTab.jsx:368-372](../../src/components/PaeviikTab.jsx) (save unconditionally closes the form). Related same-pattern PIN success copy: [src/components/SeadedTab.jsx:12](../../src/components/SeadedTab.jsx), `:218-219`.
- Observed: when localStorage throws `QuotaExceededError`, `addEntry` returns an entry and updates the displayed list. The form is discarded. The storage contains no new entry; after reload it is gone. PIN update also reports success after a swallowed failed write; the data-loss finding is anchored to the diary entry path.
- Expected: only acknowledge a committed write; if persistence fails, retain the user's text in the editor and present a recoverable error.
- Evidence/reproduction: `offline-repro.mjs`, `diary_quota_failure`: reported success, 1 in-memory entry, 0 persisted entries, 0 after a fresh instance reload/unlock. A precise synthetic `QuotaExceededError` is injected only at `setItem`; existing PIN reads work.
- Impact: user's diary text is irrecoverably lost after a supposedly successful save followed by reload/navigation. Classified BLOCKING under the supplied data-loss definition.
- Proven root cause: catch-and-ignore storage errors and unconditional UI success transition; no persistence outcome crosses the hook/UI boundary.
- Confidence: HIGH; exact-source reproduction and subsequent native Chromium quota/save/reload confirmation agree.
- Minimum safe repair: make device-local writes return/throw their actual result, update state and close the editor only after successful commit, retain draft on failure; do not mask PIN/reset failures. Preserve existing stored data.
- Repair proof: quota and unavailable-storage save failures keep typed text and show an error; successful save survives remount; PIN change failure keeps old PIN valid without success copy; failed reset never says data was removed.

## MATERIAL FINDINGS

### B-STORAGE-02 — MATERIAL — Successful pre-switch legacy write is absent from the active replica

Confidence: HIGH for behavior; the practical incidence of the narrow timing window is not measured. This is recoverable divergence, not silent destruction: the newer value remains in the legacy key and the user receives `LEGACY_DIVERGED`.

Files/symbols:

- [src/storage/storageAuthority.js:431–442](../../src/storage/storageAuthority.js), `finishAfterMigration`, reads legacy sources and then awaits their digest before creating the authority transaction.
- [src/storage/storageAuthority.js:377–387](../../src/storage/storageAuthority.js), `switchTransaction`, checks the marker against that already-captured digest, not against a protected live legacy snapshot.
- [src/storage/storageAuthority.js:226–228](../../src/storage/storageAuthority.js), `canWriteLegacy`, permits legacy saves until a hint exists; the hint is written after the authority commit.
- [docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md:190](../../docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md) guarantees that every pre-switch change fails the guard or is re-adopted, so the latest validated state is always adopted. This guarantee is false for the demonstrated interval.

Observed: after migration, the final raw legacy snapshot is captured. While its Web Crypto digest is pending, the accepted legacy household repository successfully saves a newer name. A fresh IDB read proves authority is still absent and `canWriteLegacy` returns true at that moment. The digest of the old snapshot still matches the migration marker; the authority switch succeeds. The new authoritative replica retains `Before`; the newer acknowledged value remains only in localStorage. Post-switch validation enters `READY` with `LEGACY_DIVERGED`, requiring a separate recovery decision instead of adopting the latest pre-switch data.

Expected under the current accepted guarantee: a successful save before authority commitment is included in the adopted state or prevents the authority switch. The present implementation cannot provide the claimed guarantee across two uncoordinated storage systems.

Native evidence (`native-races.log`, first JSON line): `locksAvailable=true`, actual `navigator.locks` was injected into the controller, `authorityAbsentAtSuccessfulEdit=true`, `guardWhenEdit=true`, `replicaName="Before"`, `legacyName="Saved before switch"`, result `READY + LEGACY_DIVERGED`. The legacy save runs during the second digest call; digest output itself remains the real browser SHA-256 result. Web Locks do not prevent it because legacy writes do not participate in that lock.

Reproduction: same native harness command. Synthetic controller proof independently produced the same result in `synthetic-races.log`.

Proven root cause: time-of-check/time-of-use gap between raw legacy read, asynchronous digest and the authority commit, with no common exclusion/fencing mechanism for legacy writers.

Minimum safe repair direction: first reconcile the accepted guarantee with the supported writer model in a narrow design pass. If pre-switch successful saves must be guaranteed, establish an enforceable legacy-writer fence across snapshot/digest/switch; a simple extra unlocked read does not prove the guarantee against old uncooperative tabs. If recoverable divergence is the intentionally accepted boundary, state it honestly and define the explicit data-recovery action rather than promising latest-state adoption. Preserve the no-auto-re-adopt-after-switch rule; silently merging after authority activation would violate the accepted contract.

Proof tests: hold the final real digest, perform a successful guarded legacy edit while authority remains absent, resume, and assert the chosen accepted behavior. Include a cooperating current LEGACY tab and an old-build writer. Preserve new legacy bytes and avoid unnoticed loss in every outcome.

Test gap: the existing test titled “a legacy write between migration and switch…” ([scripts/storage/indexeddb-browser.test.mjs:2028](../../scripts/storage/indexeddb-browser.test.mjs)) actually changes the source at lines 2040–2041 before `controller.boot()` begins; it does not exercise a write after the final source snapshot was captured.

### BUS-01 — MATERIAL — Home/manual departures remain stale after time advances

- Locations: [src/components/BussCard.jsx:18-51](../../src/components/BussCard.jsx) (`useEffect`, `setStopDeps`), [src/components/BussTab.jsx:451-476](../../src/components/BussTab.jsx) (`routeNow`, GPS-gated interval). Reachability: [src/components/ShellViews.jsx:38-40](../../src/components/ShellViews.jsx) mounts the card under “Buss praegu”.
- Reproduction: 2026-09-14 07:00, GPS at Õie 5901010-1, then advance to 07:23 and force a parent render with unchanged saved-place props. Card still shows 07:05 and 07:22; the actual `deps()` query now returns 08:05 and 08:18. Independently, select manual Õie → Haigla at 07:00 with no GPS. Advancing to 07:23 leaves the 07:22 route displayed with zero scheduled refresh timers. A forced render changes it to 08:18, falsifying a routing-model defect.
- Expected: an upcoming/“Buss praegu” display refreshes as services expire, including manual/GPS-denied use and day changes.
- Proven cause: card stores departure results only in GPS/fallback callbacks, so even KoduTab's minute parent render cannot recompute them. BussTab reads a fresh Date only on render; its only timer is disabled unless GPS succeeded. Exact same-day filters themselves are correct.
- Impact: departed buses remain actionable-looking until another action/remount; card can retain yesterday's departures when kept mounted. Confidence high for source behavior; no browser claim.
- Small repair: use one current service/clock snapshot to derive departures from the selected stop, with minute and foreground refresh independent of GPS success. Keep existing stop-ID read-model intact. Tests: no-interaction advance across a departure and midnight for home and manual route; unchanged parent props; GPS-denied/manual path; foreground resume.

### BUS-02 — MATERIAL — Public holidays select the wrong service day

- Location: [src/utils/bus.js:52-55](../../src/utils/bus.js) (`wd`); runtime callers `BussTab.jsx:333`, `BussTab.jsx:77,317,472`; `depsWithMeta` defaults to the same helper.
- Source authority: [scripts/bus/extract-timetables.mjs:10](../../scripts/bus/extract-timetables.mjs) defines P as “pühapäev, riiklikud pühad”; committed `manifest.json:113-115` assigns the official line-3 Sunday/public-holiday PDF to P (also line 1 at 54-56).
- Reproduction: fake local 2026-12-25 07:00 (Friday, Christmas), actual `wd()` returns E-R. Real Õie 5901010-1 → Haigla 5900078-1 model returns 07:22/07:35; the committed P table returns 09:33/09:46. No live timetable or legal freshness claim is made; this demonstrates the mismatch against the committed source semantics.
- Expected: a public holiday uses the holiday service supported by the timetable source, irrespective of weekday. Cause: `getDay()` is the entire service resolver; no date/holiday override exists. Confidence high.
- Impact: invented weekday runs and omitted actual holiday runs. Small repair: explicit, locally maintained service-calendar resolution shared by both callers, including holiday exceptions for the timetable's covered period; preserve E-R/L/P core API. Tests: a weekday holiday, Saturday holiday, ordinary weekday/Saturday/Sunday and both caller surfaces.

### BUS-03 — MATERIAL — Late GPS result discards a newer manual route

- Locations: [src/components/BussTab.jsx:105-108](../../src/components/BussTab.jsx) (`setDetectedOrigin` clears manual override) and `309-329` (`gpsClick` callback has no request/selection generation guard).
- Reproduction: click “Näita busse minu lähedal”, leave GPS pending, manually select Lihakombinaat → Piira. Real model shows 07:20 departure. Deliver pending GPS result for Õie. Manual origin becomes null, current origin becomes Õie, Piira selection is cleared as unreachable and the route list becomes empty.
- Expected: completing an older asynchronous request must not discard the user's newer explicit manual selection. GPS may update nearby context without changing current manual route choice.
- Proven cause: every GPS success calls `setDetectedOrigin`, which unconditionally clears manual override; neither request ID nor manual-selection revision is checked. The GPS button remains operable during searching, so out-of-order retries are also possible (latter not separately promoted without simulation).
- Impact: user's newly selected trip changes/disappears after an unrelated late result. Confidence high for callback behavior.
- Small repair: invalidate/capture selection/request generation, or make pending GPS update detected-origin data while retaining a manual choice made since request start. Test delayed success after manual selection, reverse-order retries, and GPS failure after success.

### BSEC-03 — MATERIAL — Public idea API reads an oversized body before checking its cap

- Area: public API availability/input handling.
- File/symbol: [functions/api/ullata.js:140-156](../../functions/api/ullata.js), `readRequestJsonWithLimit`; public entrypoint `:446-465`.
- Observed: absent a trustworthy oversized Content-Length, `request.text()` buffers the entire body, then `TextEncoder` allocates a second complete representation to discover the size. The nominal 12 KiB limit only rejects after those operations.
- Expected: bound actual bytes consumed and cancel at the cap, independently of the header. The new auth helper already implements the relevant streaming pattern in [functions/_lib/http.js:32-63](../../functions/_lib/http.js), although its 8 KiB contract must remain unchanged.
- Evidence/reproduction: offline real `Request`/`ReadableStream` to the unchanged handler with 2,097,152 bytes and no Content-Length: all bytes consumed, cancelled=false, then HTTP 400. Positive control with correct oversized Content-Length: 0 bytes consumed, HTTP 400. No provider key or outbound request was involved.
- Impact: an unauthenticated request can make memory and processing scale with the transport body rather than 12 KiB; concurrent oversized uploads create avoidable availability risk. This reproduction does **not** establish a production outage, deployment-specific memory limit, or credential compromise. Field-length validation happens after the full read and does not close this path. Existing isolate-local per-IP rate limiting reduces frequency but does not bound bytes per allowed request.
- Proven root cause: cap enforced after unbounded `request.text()` and re-encoding.
- Confidence: HIGH on bytes/behavior; production exhaustion threshold NOT VERIFIED.
- Minimum safe repair: a separately scoped streaming reader for this endpoint that preserves its existing 12 KiB and JSON/error/fallback contracts; do not casually change the accepted auth helper's 8 KiB contract or introduce new remote infrastructure.
- Repair proof: absent/false Content-Length oversized streams cancel without reading remaining chunks; exact 12 KiB accepted as appropriate; UTF-8 byte limit, invalid JSON, ordinary valid requests and provider/local fallbacks retain their intended outcomes.

### D-DOCS-01 — MATERIAL — Required recovery/deploy guides include destructive or superseded steps

Area: operator recovery / documentation. Confidence: HIGH for the instruction and code consequence; no production data was cleared and no remote operation was performed.

Primary location: [docs/DEPLOYMENT.md:109–115](../../docs/DEPLOYMENT.md), especially line 114, “clear site data if needed”. This is presented as ordinary recovery for a stale mobile/PWA result, with no restriction to disposable test profiles, no distinction between HTTP/SW caches and durable user storage, and no preservation/restore prerequisite.

Why this is a current operational finding rather than merely historical text: [docs/SESSION_BOOT.md:93](../../docs/SESSION_BOOT.md) still requires both [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) and [docs/POST_DEPLOY_FOLLOWUPS.md](../../docs/POST_DEPLOY_FOLLOWUPS.md) for deploy/API-key work; `AGENTS.md:21` routes deploy/post-deploy work to the follow-up document. The deployment file labels its target “Current production target” and supplies executable steps.

Observed behavior/instruction: the guide directs an operator investigating stale assets to clear site data on the app origin. A browser's broad clear-site-data operation can erase IndexedDB and localStorage together, including current household/calendar/places data, legacy snapshots, authority hints, revert backups and device-local diary/preferences. This is not equivalent to refreshing cached JavaScript.

Expected: routine asset freshness troubleshooting must preserve durable user data, use disposable profiles when deletion is intended, and route destructive recovery through an explicit preservation/restore decision. Operators should not be led from a stale bundle symptom into irreversible local-data deletion.

Evidence chain:

1. [docs/SESSION_BOOT.md:45](../../docs/SESSION_BOOT.md) says the application is not using remote D1; backend/runtime integration and real-user readiness remain locked.
2. [docs/COMMON_BACKEND_ARCHITECTURE_V1.md:148–150](../../docs/COMMON_BACKEND_ARCHITECTURE_V1.md) assigns diary, reminder preferences, saved ideas and tips to device-local storage; the shared-domain migration retains legacy data locally as rollback support.
3. [src/storage/storageAuthority.js:466–473](../../src/storage/storageAuthority.js) sees absent authority plus absent hint as a pre-cutover device and begins migration. The data-loss confirmation state requires the surviving hint.
4. [src/storage/legacyMigration.js:24–37](../../src/storage/legacyMigration.js), `84–85`, `93–94`, `118–119`, and `284–304` classify absent legacy keys as valid empty source state. After clearing both storage systems there is no surviving marker to distinguish the original installation from a fresh one.
5. The earlier native storage audit exercised clean-profile startup successfully. No actual clear-site-data action was performed for this docs audit; the deletion consequence is derived from the documented instruction and current storage/recovery code.

Impact: following the guide on an existing user profile can destroy unsynchronized local data while attempting to fix asset freshness. There is no current server restore path to recover it.

Proven root cause: a pre-cutover operational guide remains a required read and was not reconciled with the accepted local-first runtime and newer release gates.

Related stale instructions in the same operator-document set (supporting evidence, not additional counted findings):

- [docs/DEPLOYMENT.md:20–27](../../docs/DEPLOYMENT.md), `52–59`, `98–107` provide direct deploy/retry/manual-upload flows, including `wrangler@latest`, without routing through the current separate release scope and confirmed target.
- [docs/DEPLOYMENT.md:103–105](../../docs/DEPLOYMENT.md) recommends `Get-ChildItem Env:CLOUDFLARE*` / `Env:CF_*`, which prints matching environment values and can place credentials in logs/transcripts. No command was executed.
- [docs/POST_DEPLOY_FOLLOWUPS.md:37–41](../../docs/POST_DEPLOY_FOLLOWUPS.md) says a main-branch push triggers production deployment, whereas [docs/SESSION_BOOT.md:86](../../docs/SESSION_BOOT.md) and [docs/ACTIVE_SCOPE_LOCK.md:300](../../docs/ACTIVE_SCOPE_LOCK.md) explicitly record `production_deployments_enabled: false` and separate deliberate release authorization.
- [docs/DEPLOYMENT.md:8–13](../../docs/DEPLOYMENT.md) labels `annivibe` the current project and gives literal commands against it. Treat that as unreconciled executable runbook text; do not infer a new remote target or count the user's later `majandus` confirmation as a frozen-baseline defect. A protected frontend hostname alone does not authorize a project selection.

Minimum safe repair: a narrow docs-only pass on the two operational guides, preserving historical evidence but clearly marking superseded recipes and linking the current authority/gates. Replace generic clear-site-data recovery with steps that preserve durable storage; confine destructive troubleshooting to explicitly disposable profiles or a separately approved recovery procedure. Use environment-variable names/presence only, never values. Resolve the confirmed target through the accepted checkpoint instead of changing target names by inference. No Cloudflare action, deploy or source implementation belongs in this pass.

Validation: review every runnable example against current authorization, target, pinned tooling and secret-handling boundaries; verify the freshness procedure touches only disposable state or caches and does not suggest deleting IndexedDB/localStorage. No automated product-code regression is necessary for this docs-only repair. STOP if an example requires an unresolved target, external action, secret value or destructive user-data step.

### UI-01 — MATERIAL — Malformed optional profile can blank the entire shell

- Source: [src/hooks/useSettings.js:8-10,18](../../src/hooks/useSettings.js); [src/components/SeadedTab.jsx:31-32,294-298,317](../../src/components/SeadedTab.jsx); app boundary [src/main.jsx:44-48](../../src/main.jsx), [src/App.jsx:351-353,371-377](../../src/App.jsx).
- Trigger: a previously malformed device-local `sade_profile` contains the valid JSON text `null`; load the application and navigate to Seaded. No need to open the nested “Sinu nimi” details because its child renders while collapsed.
- Observed: actual React SSR throws `Cannot read properties of null (reading 'name')`. The root's native browser independently confirms empty `#root` and zero navigation buttons. Stored `null` is unchanged. This is **not** a claim that ordinary profile Save writes null, nor that the app necessarily fails before navigating to Settings.
- Expected: malformed optional profile data must not take down calendar, bus, navigation and shared-data recovery UI. It should be identified locally with an explicit recovery/error path.
- Proven cause: JSON parsing is the entire read validation. Null is accepted by `useSettings`; `ProfileSection` immediately dereferences it. There is no React error boundary around feature rendering in the current root/shell, so the exception tears down the root. Confidence HIGH, source + SSR + native browser.
- Small repair: validate the device profile's object/name shape at the local read boundary and render a non-destructive invalid-state/recovery view. Add a narrow feature error boundary as containment, not as a substitute for validation. Tests: null, array, primitive, wrong-type name, malformed JSON and inaccessible read; Settings remains navigable and existing bytes are preserved until explicit recovery.

### UI-02 — MATERIAL — Map modal leaves focus and keyboard actions in the background

- Source: [src/components/BussTab.jsx:641-657](../../src/components/BussTab.jsx) (overlay and `role="dialog" aria-modal="true"`), `681-695` (close action), `507-510` (close function). This is accessibility behavior, separate from already reported bus route findings.
- Native reproduction: open “Vali sihtkoht kaardilt”. Initial focus stays on its trigger outside the dialog. Press Escape: one dialog still exists. Tab traversal reaches the underlying destination selector, “Muuda lähtekoht” and main Kodu/Kalender/Buss/Veel navigation while the dialog remains visible.
- Expected: modal entry moves focus inside; keyboard focus stays within its active controls; closing restores the invoking focus; Escape provides the expected dialog dismissal where appropriate.
- Proven cause: overlay is an ordinary div with modal ARIA only, no native `showModal`, focus lifecycle, background inertness or key handler. In-repo working pattern: `EventDialog.jsx:25-29,68-69` uses native `<dialog>.showModal()` and handles cancellation. Confidence HIGH, native-browser observation plus source.
- Impact: keyboard users operate obscured background controls or unexpectedly navigate away; announced modal state contradicts actual focus behavior.
- Small repair: use the established native modal lifecycle or implement complete focus/inert/close handling while retaining map selection state. Browser tests: initial focus, repeated Tab/Shift+Tab, Escape, focus restoration and route-map cleanup. This is a confirmed accessibility defect; this audit does **not** claim a complete WCAG conformance assessment or cite an unverified normative criterion number.

### UI-03 — MATERIAL — Creative idea/tip Save reports success after failed writes

- Source: [src/components/LooTab.jsx:312-315,388-397,414-422](../../src/components/LooTab.jsx); visible success at `539-540,763-764`.
- Repro: ordinary visible flows “Loo → Joonistamise nipid → Joonistamise põhitõed → Kontuurjoonistus → Salvesta”, and “Üllata → four valid choices → generate → Salvesta”, with `setItem` throwing `QuotaExceededError`. Both show “Salvestatud”; `sade_saved_tips` / `annivibe_saved_ideas` remain absent. The generation test uses the committed local fallback with network deliberately disabled.
- Expected: a failed save retains an unsaved state and tells the user; memory-only changes should not be described as persisted.
- Proven cause: write catches are empty and success state is set regardless of persistence outcome. Confidence HIGH for source callback behavior, no native Loo quota browser claim.
- Impact: generated content/bookmarks the user believes saved disappear on remount/reload. Small repair: return/propagate the write outcome; update saved state only after success; preserve the displayed idea for retry and expose the failure. Tests: quota/security write failure, prior bytes unchanged, successful retry, remount confirmation.
- Related **MINOR** same-family issue: device profile `useSettings.js:12-13,20-23` updates memory and suppresses the failed write; `SeadedTab.jsx:35` unconditionally presents success. Script proves changed in-memory name with absent `sade_profile`. Include in the small device-local persistence repair, without duplicating the separate diary findings owned by the backend audit.

### A11Y-01 — MATERIAL — PIN instruction text has 4.196:1 contrast instead of required 4.5:1

Baseline: `7882f1063d5c0f34017a9af67d5b54d4895f537b`. Area: accessibility / current UI.

Source: [src/components/PaeviikTab.jsx:55](../../src/components/PaeviikTab.jsx), PIN setup explanatory paragraph; foreground token [src/design/tokens.js:26](../../src/design/tokens.js), background `:2`; actual application background is wired in [src/App.jsx:269](../../src/App.jsx) onward.

Observed: the visible instruction “Vali vähemalt 4 numbrit, mida ainult sina tead.” renders as 14px, weight 400, #6D757A on #F4F2EE. Native Chromium computed styles after the entrance animation finished show every ancestor at opacity 1. The luminance contrast ratio is 4.196375947769527:1. It is ordinary visible instruction text, not a disabled control, decoration, logo or large text.

Expected: at least 4.5:1 for this normal-size text under WCAG 2.2 SC 1.4.3. This is a verified failure for this element, not a claim to have completed a whole-application WCAG certification. Source: [W3C minimum contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Evidence/reproduction: `node ../evidence/browser-contrast.cjs` from snapshot; exit 0. Fresh isolated production build → Veel → Päevik → first PIN setup step → wait for entrance completion → read text and ancestor computed colors. Receipt: `evidence/browser/contrast.json`. Relative luminance uses standard sRGB linearization and (lighter + .05)/(darker + .05).

Impact: reduced legibility for low-vision users on the current PIN setup flow. Proven cause: the muted token is reused on a warm page background without enough contrast; its suitability on white cards does not establish suitability on every surface. Confidence HIGH.

Minimum safe repair: use an existing sufficiently dark text token for normal informational text on this surface, or adjust the relevant token/surface combination after checking other uses. Do not solve by treating meaningful copy as disabled or removing it. This can be repaired in the UI V2 accessibility pass.

Repair proof: measured computed colors at full opacity give at least 4.5:1 for setup/unlock explanatory text and related affected normal-size text on each actual background; retain readable focus/disabled states and reduced motion. No broad palette rewrite is required.

## MINOR FINDINGS

### BUS-04 — MINOR — Denied home GPS can leave permanent loading copy

- Location: [src/components/BussCard.jsx:20-30,43-45,61,83](../../src/components/BussCard.jsx).
- Repro: default saved places (null coordinates), deny GPS, fire fallback timeout. Final state is `fallback`, no timers remain, visible strings are “Otsin lähimat peatust…” and “Laen väljumisi…”. Nothing is still loading.
- Cause: error/fallback state only affects an aria-hidden dot; text depends only on `stop`. Small repair: an explicit no-location/error state with the existing “Ava buss” manual-selection recovery. Tests denied/unsupported/timed-out GPS with and without a usable saved place. Source simulation passed; confidence high.

### BUS-05 — MINOR — Manual origin loses its map position and marker

- Locations: [src/components/BussTab.jsx:90-100](../../src/components/BussTab.jsx) (`mapOriginGroupToChoice`), `487-505` (map center/marker fallback).
- Repro: manual Õie resolves 5901010-1 in BUS_DATA with `coordinateStatus: NOT_IN_SOURCE`; both `Number(point.lat)` and `Number(point.lon)` are NaN. The marker fallback reads the same coordinate-less BUS_DATA entry, returning null. Committed GTFS has the correct 59.334022,26.3478513 coordinates. All normalized runtime stop metadata lack lat/lon by design.
- Impact: map starts at general Rakvere center and omits selected manual origin marker, whereas GPS origin has coordinates. Routing IDs and routes remain correct; therefore minor.
- Small repair: resolve manual/map origin coordinates from GTFS_STOP_COORDS_BY_ID by concrete ID, as `nearest` and map stop rendering already do. Test manual-origin center and marker props plus GPS parity. Static/data proof, not visual browser observation.

### BSEC-04 — MINOR — Expired rate-limit buckets accumulate on new-client traffic

- Area: legacy API memory retention.
- File/symbol: [functions/api/ullata.js:111-129](../../functions/api/ullata.js), `applyRateLimit`.
- Observed: the new/expired-client branch returns before the stale-bucket sweep. An isolate receiving only first requests or requests separated by its 60-second window retains expired client entries indefinitely until a repeat request within a live window triggers cleanup.
- Evidence: exact-source helper fixture advances the injected clock by 180 seconds between 3,001 distinct synthetic clients. Map size remains 3,001 although all prior buckets are expired; a second request from the last client reduces it to 1. See `rate_bucket_retention` in `offline-repro.json`.
- Impact: unnecessary per-isolate memory retention. Isolate lifetime and production traffic impact were not measured, so this is not presented as a proven DoS.
- Root cause: maintenance follows branches that bypass it. Confidence HIGH.
- Minimum safe repair/test: move bounded stale maintenance to a path reached by new and expired client requests; test aged unique clients and retain 20-request window semantics. Keep the documented limiter limitation explicit; do not imply global distributed enforcement.

### BSEC-05 — MINOR — Inherited dictionary keys cause an uncontrolled input exception

- Area: legacy API malformed input/error handling.
- File/symbol: [functions/api/ullata.js:190-193](../../functions/api/ullata.js) validates only string length for `with`; `:285` uses inherited property lookup in `WITH_LABELS`; `:295` calls `withLabel.toLowerCase()`; `:465` runs this before the provider try/catch blocks.
- Observed/evidence: direct offline POST JSON `{ "with": "__proto__" }` rejects with an uncaught TypeError; normal `{}` returns 200. The property yields the inherited prototype object. `offline-repro.json` records `inherited_with_name`.
- Expected: explicitly reject unknown enum values or select a safe own-property fallback.
- Impact: malformed public input causes an uncontrolled server error. No prototype pollution, cross-request state modification, data access, or remote-code execution is demonstrated. Current UI selects fixed valid values, limiting ordinary-user impact.
- Root cause: inherited object properties treated as valid dictionary values. Confidence HIGH.
- Minimum safe repair/test: own-property lookup plus allowed-value policy; negative tests for `__proto__`, `constructor`, `toString`, unknown values and valid UI selections.

### P-PWA-01 — MINOR — Generated install manifest declares English for Estonian metadata

Confidence: HIGH. [public/manifest.webmanifest:12](../../public/manifest.webmanifest) says `lang: et`; [index.html:2](../../index.html) uses `lang=et`; the generated `dist/manifest.webmanifest:1` instead contains `lang: en`. [vite.config.js:11–28](../../vite.config.js) supplies a second manifest configuration without `lang`, and this is the configuration reflected in the generated artifact. The generated installation metadata therefore labels Estonian strings as English. This does not establish a screen-reader failure in page content, which retains the correct HTML language.

Minimal repair: declare `lang: et` in the manifest that actually generates production output, and clarify the ownership of the duplicate public manifest. Verify the generated manifest language after build. This is later metadata cleanup, not a release blocker or reason to redesign the PWA.

### UI-04 — MINOR — profile success copy ignores a failed local write

Files/symbols: [src/hooks/useSettings.js:12](../../src/hooks/useSettings.js), `saveName` at line 20; [src/components/SeadedTab.jsx:35](../../src/components/SeadedTab.jsx), `ProfileSection.save`. The same source callback reproduction in `evidence/ui/reproduce-output.json` produces an updated in-memory name and successful-looking UI while `sade_profile` remains absent after a denied write. Impact is loss of a profile display-name change, not shared household data. Confidence HIGH for source reproduction. Propagate persistence outcome and keep the edited name with an explicit error. Verify quota/security failure and successful retry/remount. This is separate from UI-01's malformed-read crash and diary data loss.

### UI-05 — MINOR — field prompts lack reliable programmatic associations

Files: [src/components/SeadedTab.jsx:256](../../src/components/SeadedTab.jsx) (PIN label/input), `:141` (saved places), [src/components/PaeviikTab.jsx:61](../../src/components/PaeviikTab.jsx), `:98`, `:204`. Meaningful prompts are not consistently associated with controls; PIN placeholder is only bullets. Placeholder fallback means this is not a claim that every input has an empty accessible name. Source evidence and exact cases are in the UI report. Confidence HIGH for markup; full screen-reader behavior NOT VERIFIED. Add persistent labels and error associations; inspect the accessibility tree for each PIN step and filled fields. This is a usability/accessibility markup finding, without an unverified WCAG criterion assertion. [W3C form guidance](https://www.w3.org/WAI/tutorials/forms/instructions/).

### UI-06 — MINOR — Loo choice state is exposed only visually

Files: [src/components/LooTab.jsx:565](../../src/components/LooTab.jsx), `:590`, `:603`, `:626`. Selected single/multiple choices change styling but expose no pressed/selected/radio/checkbox state. Keyboard click still works; this report does not claim complete screen-reader certification. Confidence HIGH from actual rendered JSX. Give controls the matching single/multiple-choice semantics and test state changes through keyboard plus the accessibility tree. No business-logic rewrite is needed.

### TEST-01 — MINOR — bus fixture tools assume LF bytes without pinning Windows checkout policy

File/symbol: [scripts/bus/validate-timetables.mjs:34](../../scripts/bus/validate-timetables.mjs), `parseCSV`; repository has no `.gitattributes` LF policy. A Windows archive with configured core.autocrlf=true produces CRLF CSV; parser rejects any CR. Representative snapshot CSV is 2,829 bytes / 33 CRLF, while the exact committed blob is 2,796 bytes / zero CRLF. Initial generator/runtime suites fail; a separate literal-LF archive of the SAME commit passes 12/12 and 8/8. This is tooling portability, not incorrect committed timetables. Confidence HIGH. Specify canonical checkout EOL for byte-verified fixtures or explicitly normalize at an approved input boundary without weakening evidence-byte validation. Verify both ordinary Windows checkout and literal committed blobs. The independent Xpdf prerequisite failure is a limitation, not another product finding.


## Domain scorecard

PASS describes the audited local contract only; it is not production readiness or complete conformance certification.

| Domain | Result | Basis / remaining boundary |
|---|---|---|
| Architecture | PASS | Explicit browser/runtime/repository/domain boundaries; backend integration remains separate and dormant. No additional material structural defect established. |
| Storage/Data Integrity | NEEDS REPAIR | Two native-IDB transition races and two independent diary loss mechanisms. Shared ordinary transactions otherwise preserve atomicity. |
| Calendar | PASS | Existing pure/UI suites and independent recurrence, DST, exception/import tests. |
| Bus | NEEDS REPAIR | Three material presentation/service-calendar/lifecycle issues. Exact-ID downstream direction core held up. |
| Waste/Household | PASS | Manual scheduling and synthetic import contract verified; unsupported provider/geocoder truthfully disclosed. No live provider tested. |
| Backend Foundation | PASS | 9 suites, 87 TAP tests including actual local Pages dispatch/D1 batch failure. No new auth/scope blocker. Remote readiness unverified. |
| Security/Privacy | PASS WITH FINDINGS | Legacy idea API resource/input issues; no demonstrated auth bypass, reachable user-input XSS, SQL injection or leaked live secret. Diary PIN is a local UI gate, not encryption. |
| PWA | PASS WITH FINDINGS | Actual built worker controls page, offline reload works, API fetch responses absent from caches; generated language metadata is wrong. Two-version update transition unverified. |
| UI/UX | NEEDS REPAIR | Profile corruption crash, false successful saves and bus feedback/state problems. |
| Accessibility | NEEDS REPAIR | Native-browser modal focus failure and a measured normal-text contrast failure; additional markup improvements. Full screen-reader/text-zoom certification not performed. |
| Performance | NOT VERIFIED | Build sizes and local timings recorded; no representative throttled/mobile field trace. No material slowness claim based on chunk size alone. |
| Resilience | NEEDS REPAIR | Older device-local paths lack shared-domain error and validation discipline; failures can erase drafts or remove the shell. |
| Tests | PASS WITH FINDINGS | Broad meaningful transaction/domain coverage; important uncovered race/device-local failures, one timing-sensitive first-run failure, EOL portability, unavailable PDF prerequisite. Not an all-green initial run. |
| Documentation | NEEDS REPAIR | Still-required operator guidance conflicts with current data preservation and release boundaries. Historical checkpoint statements excluded. |

## Test / build evidence

28 existing test entry files were executed, all with `node <path>` from the immutable snapshot. No test or lint tooling was added. Several UI entry files import the same LEGACY/READY shell harness: do not sum the table as independent scenario coverage.

**Initial execution: 24 PASS, 4 FAIL.** Controlled follow-ups: generator and runtime timetable suites pass against a literal-LF archive of the identical commit; reminder UI suite passes a separate complete rerun. Final effective entry status is **27 PASS, 1 partially FAIL due to unavailable Xpdf**. The original failures remain preserved, not overwritten.

| Exact command | Initial TAP tests pass/total | Initial exit | Follow-up / effective status |
|---|---:|---:|---|
| `node scripts/backend/auth.test.mjs` | 10/10 | 0 | PASS |
| `node scripts/backend/create-household-api.test.mjs` | 8/8 | 0 | PASS |
| `node scripts/backend/crypto.test.mjs` | 8/8 | 0 | PASS |
| `node scripts/backend/db.test.mjs` | 8/8 | 0 | PASS |
| `node scripts/backend/foundation-integration.test.mjs` | 13/13 | 0 | PASS |
| `node scripts/backend/households.test.mjs` | 7/7 | 0 | PASS |
| `node scripts/backend/http-ids.test.mjs` | 8/8 | 0 | PASS |
| `node scripts/backend/migration-contract.test.mjs` | 13/13 | 0 | PASS |
| `node scripts/backend/session-api.test.mjs` | 12/12 | 0 | PASS |
| `node scripts/bus/boarding-departures.test.mjs` | 15/15 | 0 | PASS |
| `node scripts/bus/destination-selector.test.mjs` | 31/31 | 0 | PASS |
| `node scripts/bus/direct-routes.test.mjs` | 15/15 | 0 | PASS |
| `node scripts/bus/generate-bus-data.test.mjs` | 1/12 | 1 | Initial FAIL (CRLF); literal-LF same SHA: 12/12 PASS, exit 0 |
| `node scripts/bus/reachability.test.mjs` | 12/12 | 0 | PASS |
| `node scripts/bus/runtime-timetable.test.mjs` | 5/8 | 1 | Initial FAIL (CRLF); literal-LF same SHA: 8/8 PASS, exit 0 |
| `node scripts/bus/timetables.test.mjs` | 7/10 | 1 | Literal-LF: 8/10 PASS, exit 1; 2 PDF cases FAIL because Xpdf is UNAVAILABLE |
| `node scripts/calendar/calendar-ui.test.mjs` | 60/60 | 0 | PASS |
| `node scripts/calendar/events.test.mjs` | 19/19 | 0 | PASS |
| `node scripts/places/saved-places.test.mjs` | 6/6 | 0 | PASS |
| `node scripts/reminders/native-notification.test.mjs` | 50/50 | 0 | PASS |
| `node scripts/reminders/reminder-ui.test.mjs` | 60/62 | 1 | Initial FAIL; isolated complete repeat: 62/62 PASS, exit 0 |
| `node scripts/reminders/reminders.test.mjs` | 28/28 | 0 | PASS |
| `node scripts/shell/app-shell.test.mjs` | 78/78 | 0 | PASS |
| `node scripts/shell/visual-polish.test.mjs` | 72/72 | 0 | PASS |
| `node scripts/storage/indexeddb-browser.test.mjs` | 88/88 | 0 | PASS |
| `node scripts/storage/storage.test.mjs` | 83/83 | 0 | PASS |
| `node scripts/waste/waste-ui.test.mjs` | 64/64 | 0 | PASS |
| `node scripts/waste/waste.test.mjs` | 23/23 | 0 | PASS |

The initial reminder UI failure was the shared shell test at [scripts/shell/app-shell.test.mjs:490](../../scripts/shell/app-shell.test.mjs): the sampled finite entrance animation was no longer present. Its parent group is also counted failed by Node, hence 60/62. The relevant test later passes in other shell runs and in the dedicated 62/62 repeat. Timing sensitivity is a supported inference; the audit does not prove a specific scheduler/CPU root cause or a broken reminder feature. A future harness repair should control animation time rather than retry until green.

The PDF failure is `spawnSync pdftotext ENOENT`. No Xpdf executable was found in PATH or the inspected existing tool locations; none was installed. Tracked source PDFs are present. PDF-derived raw evidence was therefore not freshly regenerated against an actual extractor. Ordinary normalized-data/routing tests and committed blob comparisons still ran.

`npm run build`: **PASS**, exit 0, Vite 5.4.21 / VitePWA 0.21.2. Output:

| Artifact | Size | Gzip |
|---|---:|---:|
| Main JS | 1,031.85 kB | 203.60 kB |
| Main CSS | 48.28 kB | 12.80 kB |
| HTML | 1.63 kB | 0.74 kB |
| registerSW.js | 0.13 kB | — |
| manifest | 0.46 kB | — |
| Precache manifest input | 13 entries / 1065.48 KiB | — |

The build emits the >500 kB chunk warning. Bus data and Leaflet are eagerly imported. This is measurable bundle debt, not proof of a substantial runtime performance defect. A local warmed/worker-served desktop reload measured approximately 186ms DOMContentLoaded / 187ms load; it cannot substitute for a mobile performance trace.

`git diff --check` and `git diff --cached --check` in the isolated snapshot: PASS. Configured lint/typecheck: **UNAVAILABLE / NOT CONFIGURED** ([package.json](../../package.json) exposes dev/build/preview only). Dependency upgrades and audit-network commands: NOT RUN. Intentionally no installs, deployments or production mutations.

### Independent defect and domain verification

- Native Chromium IndexedDB race harness: both reported storage races reproduced with isolated data; exit 0 means successful reproduction, not application acceptance. Actual Web Locks were supplied in the pre-switch digest test; their absence was explicit in the revert test.
- Locally served production build in Chromium: both diary loss paths and profile-null/map-focus findings confirmed.
- Bus lifecycle harness: committed JSX plus real route data with controlled hooks/clocks; source-level reproduction, not full React DOM evidence. Holiday service is checked against committed P-table semantics, not a live timetable claim.
- Backend legacy negative tests: full 2 MiB stream consumed without Content-Length; header positive control consumes zero; malformed dictionary key and stale limiter buckets reproduced; outbound fetch count zero.
- UI callback/SSR harness: creative/profile false saves reproduced; malformed creative-state crash hypothesis falsified.
- Calendar independent day-walk oracle: 192 recurrence comparisons; leap/end-month/moved exclusions; spring/autumn local-clock checks in Tallinn, Honolulu and Tokyo; calendar failed-write byte preservation; imported-field protection; 10 simultaneous synthetic notification attempts produce one delivery.

### Browser runtime and limits

Actual production build was served over isolated localhost origins with fresh Playwright/Chromium contexts and synthetic storage only. All five primary destinations (Kodu, Kalender, Buss, Veel, Seaded) were opened at **390×844, 412×915, 768×1024 and 1440×900**. Twenty screenshots and layout receipts are saved. All measured page widths matched viewport widths; no horizontal overflow on those screens. Loo/Päevik navigation, event dialog keyboard entry/Escape, diary save/reload/two-tab behavior and map keyboard behavior were exercised.

Ordinary four-viewport smoke: **0 console errors, 0 page errors, 0 warning messages, 0 external requests**. The injected invalid-profile probe deliberately produced the reported exception and blank app. The map probe deliberately blocked six OSM tile requests so no external service was contacted; those blocked resources are harness limitations, not application network defects. Actual tile-provider behavior and model-provider requests were not tested.

The generated `dist/sw.js` controlled the page and served an offline reload. Authenticated synthetic GET and POST local stub responses (`503`, `no-store`) were not cached; offline API fetch rejected. This checks generated cache routing, not deployed endpoint authentication. Auth headers never went to production. The broad SPA navigation fallback can serve HTML for an API **document navigation**, but it does not cache ordinary API fetch responses; no credential leakage established. Auto-update code contains no page reload listener, so a hypothetical unsaved-draft-loss claim was not promoted.

Install prompt/OS integration, real Android/iOS notification reception, actual two-version SW transitions, representative mobile speed, exhaustive screen-reader traversal and 200% text scaling remain **NOT VERIFIED**. One measured WCAG contrast failure is established; remaining contrast surfaces were not exhaustively certified. Native notification suite is browser-platform acceptance, not human/device receipt. No human acceptance, staging authorization or real-user readiness is granted by test results.

## Technical debt boundaries

| Timing | Necessary work | Keep outside this scope |
|---|---|---|
| MUST FIX BEFORE UI V2 runtime implementation | Close diary commit/failure and multi-tab data-loss contracts. Resolve the storage adoption guarantee and unsafe revert path before any rollout relying on cutover/rollback. | UI V2 design/prototype repairs may continue; no backend sync redesign or prototype business-logic import. |
| CAN FIX DURING UI V2 | Map modal lifecycle; measured contrast and field/choice semantics; robust device profile/creative save feedback; bus presentation clock and async selection behavior in narrowly tested passes. | Preserve actual stop IDs, recurrence/import constraints, manual waste behavior, honest foreground reminders. Holiday service-calendar correction remains its own domain checkpoint. |
| SHOULD FIX BEFORE BACKEND BIND/DEPLOY | Replace dangerous operator recovery recipes; preserve authorized target/gates and secret-safe commands; bound existing idea API reads before publishing that endpoint; resolve any relied-on client rollback safety. | No changes to accepted auth schema, hash ownership, session lifecycle or client integration just because they are future prerequisites. |
| LATER CLEANUP | Minor manifest metadata, map origin marker, home no-location copy, limiter/dictionary handling, LF tooling policy, stable animation timing, dead Tugi/pre-UX01 presentation code. Measure before chunk optimization. | No broad cleanup disguised as UI V2 or Phase 10 repair. |

## UI V2 effect

**Does this change the planned UI V2 sequence? YES.** Keep the existing NEEDS DESIGN REPAIR FIRST result. Before replacing production UI behavior, complete narrow diary data-integrity passes; make the storage adoption/rollback contract review a release prerequisite. Then implement UI V2 presentational changes with the existing domain contracts retained, fixing modal/contrast/form states within that UI scope. Pure design work can continue in parallel. Unrelated legacy API cleanup is not a reason to expand visual-design scope.

## Backend Phase 10 effect

**Does anything found make the planned PRE-BIND → BIND → DEPLOY sequence unsafe? NOT VERIFIED.** No new auth-foundation implementation blocker or household-scope bypass was found, and the accepted order remains appropriate. Remote target/configuration/binding preservation and rollback proof were forbidden and were not performed. A claimed safe deployment rollback must explicitly address B-STORAGE-01's no-Web-Locks revert condition; ordinary new-auth binding is not shown to cause that path by itself. The stale operator guide must not substitute for the current controlled gates.

The user-confirmed Pages project remains `majandus`; remote D1 is treated as user-provided CREATED/MIGRATED/VERIFIED/UNBOUND/UNDEPLOYED context, not fresh remote proof. Binding, deployment, client/backend integration and real-user readiness remain LOCKED / NOT GRANTED. Accepted deferrals (session expiry/renewal, recovery/revocation, token storage, non-idempotent unknown-result handling, abuse/retention/observability) remain readiness prerequisites rather than manufactured foundation defects.

## Approved work order — governance, not implementation authorization

The audit's own proposed R5A/R5B/R5C/R6/R7A/R7B/R8 labels were recommendations, not the current authorization sequence. The following human-approved order supersedes that proposed ordering while retaining every finding above. Each repair requires its own bounded scope, test evidence, and review; this checkpoint opens no source files.

| Road step | Work | State / boundary |
|---|---|---|
| 1 | Pages target governance checkpoint | **COMPLETE** at `fc44e8ab1cf03248b7f967258e01cde8c52cdb1f`. |
| 2 | Full-application audit + repair-roadmap checkpoint | **CURRENT** (this docs-only preparation; independent review still required). |
| 3 — R0 | Deployment/recovery documentation safety | **NEXT REPAIR**, docs-only after this checkpoint. |
| 4 — R1 | Diary persistence failure contract | Later, separate scope. |
| 5 — R2 | Diary multi-tab atomicity/conflict safety | Later, separate scope. |
| 6 — R3 | Storage revert exporter race | Later, separate scope. |
| 7 — R4 | Pre-switch adoption guarantee/contract reconciliation | Later, separate scope. |
| 8 — UI-V2-0 | Design repair and integration contract | Later checkpoint; pure design/prototype work is allowed now. |
| 9 — UI-V2 | Narrow production/runtime subphases 1–8 | **BLOCKED UNTIL R1–R4 ARE CLOSED**. |
| 10 | Remaining deploy-relevant audit repairs | At minimum bounded Üllata API body read, required rollback safety, and other specifically approved release-relevant findings; R0 covers operator/recovery docs. |
| 11 | Resume Backend Phase 10 | Remains separately gated; no automatic external authority. |

UI-V2 runtime subphases, in order: **1** shell/navigation; **2** Kodu; **3** Kalender; **4** Veel/Prügivedu; **5** Buss; **6** Seaded; **7** responsive/accessibility; **8** regression/human review. UI design work **is allowed now**: prototype review, design inventory, token decisions, visual mapping and UI-V2 design documentation. The untracked `docs/assets/Majamajandus v2.html` belongs to a separate design-reference checkpoint and is untouched here. Do not describe all UI work as blocked. Runtime replacement cannot start before R1–R4 close and must not rewrite unrelated business logic.

### Repair contract boundaries

- **R0 — next:** later docs-only repair, primarily `docs/DEPLOYMENT.md` and `docs/POST_DEPLOY_FOLLOWUPS.md`. Remove generic “clear site data” recovery guidance; preserve durable IndexedDB/localStorage user data; clearly mark superseded deploy recipes; avoid printing Cloudflare credential values; route deploy actions through current authority and do not infer a remote target from historical text. R0 authorizes **no** deployment, Cloudflare reads/writes, D1 access or Pages mutation.
- **R1 — BSEC-02:** make diary persistence failure observable. Retain the draft and editor on failure, show no success before durable write, make PIN/reset failure truthful, and preserve existing diary bytes. No backend diary sync.
- **R2 — BSEC-01:** prove two independent contexts can append distinct entries and both survive reload; stale delete cannot resurrect or incorrectly delete entries; failure/conflict retains user-authored text. Storage-event-only reconciliation is not atomicity proof.
- **R3 — B-STORAGE-01:** a losing/stale revert controller must write **zero** shared keys after another controller completes revert; a post-revert acknowledged legacy user save must survive. Cover with/without Web Locks and preserve backup/compensation/resume behavior. If the proposed fix makes Web Locks mandatory or changes accepted revert semantics, **STOP for a narrow governance/design amendment first**.
- **R4 — B-STORAGE-02:** explicitly choose between **A**, enforcing the strong accepted guarantee that every successful pre-switch write is adopted or blocks the switch, and **B**, accepting recoverable divergence with an honest explicit recovery contract. Do not silently code around the discrepancy, merge after switch, or assume old tabs obey a new fence.
- **BUS-01/BUS-02/BUS-03 remain MATERIAL**, but are not scheduled ahead of R1–R4. Later bounded passes cover departure refresh independently of GPS success, an explicit public-holiday service-day resolver, and late GPS completion not overwriting a newer manual route. Preserve concrete stop IDs, route-pattern/direction logic, and destination-first selection.
- **UI-01/UI-02/UI-03/A11Y-01/UI-04/UI-05/UI-06** may be repaired in narrow UI-V2 passes: malformed optional-profile containment/validation; map modal focus lifecycle; truthful idea/tip/profile save feedback; PIN instruction contrast; form label associations; and selection semantics. No unrelated business-logic rewrite.
- **Backend Foundation: PASS for the audited local contract.** No auth bypass, household-scope bypass, SQL injection or live-secret leak was demonstrated. **BSEC-03** is separate Üllata endpoint hardening: bound actual request bytes before full buffering, preserving that endpoint's 12 KiB behavior. Do not change the accepted authentication helper's 8 KiB contract. BSEC-04/BSEC-05 and other remaining findings retain the severity and limitations recorded above.

## Phase 10 boundary retained

Pages project identity is **CONFIRMED = `majandus`** (not the hostname `annivibe.pages.dev`). Phase 10 step 4 is **IN PROGRESS**, with the read-only current production/relevant preview configuration review still outstanding. The next external gate is **COMPLETE PAGES TARGET CONFIGURATION REVIEW — READ-ONLY; BLOCKED PENDING EXPLICIT HUMAN AUTHORIZATION**. This checkpoint does not authorize that review. Step 5 PRE-BIND TARGET CONFIGURATION SNAPSHOT remains **LOCKED**.

The dedicated remote D1 `majandus-backend-v1` (`8d7f229b-d821-4ce3-bd63-7efb427269e4`, EU) is recorded as **CREATED / MIGRATED / VERIFIED / UNBOUND / UNDEPLOYED**; the application is **not** using it. The unrelated `tehnika-temp-inventory` (`c6ea725f-c533-441c-a287-af714af99f43`) is protected and out of scope. Binding, deployment, client/runtime integration, and further Phase 10 implementation remain **LOCKED**; real-user readiness is **NOT GRANTED**. Backend 10B/10C remain distinct future gates. The full-application audit did not verify live production Pages configuration, binding-preservation semantics, or safe deployment rollback.

## Isolated-workspace evidence inventory

These are **filenames from the temporary Astra audit workspace**, not repository paths or links. They were generated outside the repository; **raw ephemeral evidence was not committed in this checkpoint**, nor was the entire evidence directory copied. The frozen report's detailed observations above remain the retained narrative evidence.

| Artifact filename | What the isolated audit artifact demonstrated / recorded |
|---|---|
| `baseline.json`; `final-integrity.json` | Frozen baseline, 214-file snapshot hashes and final main-repository integrity/status observations. |
| `results.json`; `literal-lf-results.json`; `reminder-ui-repeat.log` | Original 28 test entry receipts, same-commit LF bus follow-ups, and complete reminder UI rerun. |
| `build.log` | Local production-build result and generated artifact sizes. |
| `browser-report.json`; `deep-report.json` | Four-viewport synthetic browser checks, quota diary failure, two-tab diary overwrite, worker/offline behavior. |
| `a11y-resilience-report.json`; `contrast.json` | Map focus/profile-null observations and measured PIN instruction contrast. |
| `native-races.log` | Native-IDB pre-switch digest and two-controller no-lock revert races. |
| `reproduce-output.json` (bus); `offline-repro.json` (backend); `reproduce-output.json` (UI) | Controlled bus lifecycle/routing, legacy API negative cases, and device-local UI callback/SSR probes, respectively. |
| `domain-verification.json` | Independent calendar/reminder/waste oracles and synthetic concurrency checks. |
| `storage/findings.md`; `backend/backend-security-report.md`; `bus/report.md`; `calendar/calendar-reminders-waste-report.md`; `ui/report.md`; `docs/findings.md`; `docs/pwa-final-review.md` | Detailed isolated track reports, corroboration, falsified candidates and limitations. |

The original audit ended without repair, stage, commit, push or Cloudflare call. Its observed four uncommitted governance documents were an audit-time concurrency snapshot, not the current HEAD: the intervening commit changed only governance docs. No finding above is presented as freshly retested against `fc44e8ab1cf03248b7f967258e01cde8c52cdb1f`.
