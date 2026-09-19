# CURRENT_STATE

Status: compact operational snapshot for future Majandus passes.

## Product and production

- visible product: `Majandus`
- accepted product runtime baseline: `062cdcbe6488282854cbb7d8fcf2309c50360dec` (`feat: improve calendar usability`)
- canonical production: `https://annivibe.pages.dev`
- observed canonical production: accidental C6-containing Git auto-deployment `0cca08f2-3a87-4176-99e2-7bc107bf8ce5` from `549203d3a0eced020fc954cab62721ee85a06936`; this is not a C8 accepted deployment
- prior production and human phone validation: PASS; it is not acceptance evidence for the observed accidental production runtime

## Accepted product state

- Majandus application shell: Kodu, Kalender, Buss, Veel and Seaded.
- Household calendar, waste/household functionality and reminders are accepted.
- Existing Buss functionality is preserved, including concrete stop_id routing, nearby departures and map destination selection.
- Motion polish is accepted at `20ac51b481c1b2a7ea58ce2251f28ceb96f31046` (`style: add subtle native motion`): subtle page entrance, tactile navigation and press feedback, calendar state motion, event-dialog entrance and reduced-motion support.
- Calendar UX v2 is accepted at `062cdcbe6488282854cbb7d8fcf2309c50360dec`: visible `+ Lisa`, integrated `Täna`, month-aligned selected-day content, the legend after selected-day content, essential-first event creation and truthful advanced options.

## Protected boundaries

- Preserve current bus routing behavior and concrete stop_id identity; `depsWithMeta(...)` and `displayCodes` remain transitional where present.
- Preserve calendar recurrence and imported-event protections.
- Preserve local-only data until an accepted migration plan exists.
- Do not reopen Trends in v1 or combine unrelated feature work.

## Evidence

- Motion polish validation: `211 PASS`, `0 FAIL`; human phone review: PASS.
- Calendar UX v2 validation: `206 PASS`, `0 FAIL`; production smoke and human phone review: PASS.
- These are pass-specific validation results, not the repository-wide test total.

## Next action

- `RUNTIME_CUTOVER_C7` Step 1 is CHECKPOINTED. Fixed branch/origin: `c7-storage-cutover` / `https://c7-storage-cutover.annivibe.pages.dev`; accepted legacy recovery preview deployment `342c1212-7023-48e5-a195-be0f3896748c` from `6123c12567efea7040d5a5995dd8ba5f738c73a1` (the incomplete predecessor was `3fdf1f45-9c64-4d70-b5d9-05a0fb9225b2`). Human Step 1 PASS evidence is recorded in `docs/ACCEPTED_CHECKPOINTS.md`: installed PWA, one-off/recurring events, household profile, three visible saved places, reminder setup/permission and manual waste schedule; `WASTE_IMPORT: NOT AVAILABLE`; no unexpected state. Saved-place add/remove is `NOT USER-EXPOSED`; the locked order is Kodu — Õie 58, Vanaema — Kaevu 10, Trenn — Pikk 23. C7 Step 2 and Steps 3-7 are PENDING. Next safe action: C7 Step 2A — pre-cutover legacy-data existence and baseline verification before any forward deployment. Cloudflare Pages containment remains verified (`production_branch: main`, automatic production deployments `false`, preview setting `all`, Git integration `github`): a `main` push MUST NOT auto-deploy production, and any unexpected production deployment before C8 is a STOP. Current production is frozen at accidental C6-containing deployment `0cca08f2-3a87-4176-99e2-7bc107bf8ce5`; C8 remains LOCKED.
- Common Backend Architecture v1 is accepted; Cloudflare Pages Functions + D1 is selected for the v1 backend; the Phase A implementation plan is accepted.
- Task 1's native IndexedDB schema/primitives are accepted at `f2fe59c7b1704c5a1feb2266123606acaa4a1342` with real Chromium tests `5/5 PASS`, build PASS and no runtime cutover.
- Task 2's local-replica contracts and exported record validators are accepted at `5d7546fbf96fff77b738b48ca0b1e5f5936cfc48` with Chromium storage tests `6/6 PASS`, build PASS and no runtime cutover.
- Task 3's legacy validation, transformation and digest are accepted at `7ace02444fc3783898a14251c62ebe032113e0ea` with storage tests `45/45 PASS`, IndexedDB regressions `6/6 PASS`, build PASS and no runtime migration.
- Task 4's dormant migration state machine is accepted at `e651a6edb2f19bf850e5e67ceac462551f2fd37a` with storage tests `48/48 PASS`, IndexedDB tests `15/15 PASS`, build PASS and final adversarial audit PASS; no runtime migration has occurred, legacy storage remains non-destructive and migration generates zero outbox mutations.
- Task 5's integration breadth is accepted at `fa7f7b79dbdbac300ca1e7e2069091bbc9c474cf` with storage tests `49/49 PASS`, IndexedDB tests `16/16 PASS`, build PASS, diff check PASS and no production file changes; migration remains dormant and no live runtime migration has occurred.
- Task 6's dormant guard and fail-fast regression is accepted at `abdd002240e78ed093facdb3ef463d4ba6ede418`: source guard PASS, bundle guard PASS, fail-fast sweep PASS and runtime diff NONE.
- Phase A implementation is complete and the Phase A final human review is ACCEPTED (range `4e9a65af179c45ce95395aae21d577fe90ed13b2..abdd002240e78ed093facdb3ef463d4ba6ede418`; review package at checkpoint `4cb17e283abffb98df54c23837ffeaf253b402ac`).
- The runtime cutover plan in `docs/superpowers/plans/2026-09-16-majandus-runtime-cutover.md` remains HUMAN ACCEPTED. C1-C6 are ACCEPTED / CHECKPOINTED as recorded there; C6 activates the runtime authority cutover with guarded `LEGACY` and C4-proven `READY`, and its source scope is CLOSED. `RUNTIME_CUTOVER_C7` is OPEN only for external fixed-preview deployment and the real Android/PWA human gate: no repository source/config change and no intentional canonical-production deployment. The C6-containing canonical runtime was observed from a prior Git auto-deployment, is frozen in place, and must not be rolled back to pre-C6 because clients may have switched authority to IndexedDB. C8 remains LOCKED; production deployment, backend, authentication, sync and outbox work remain separate gates.
