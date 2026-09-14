# AGENTS.md

Status: root AI working rules for AnniVibe.

## Read order before every task

Default read set for every task:

1. `AGENTS.md`
2. `docs/SESSION_BOOT.md`
3. `docs/CURRENT_STATE.md`
4. `docs/ACTIVE_SCOPE_LOCK.md`

Then read only the task-specific files the pass needs:

- Docs checkpoint / lock updates:
  - `docs/ACCEPTED_CHECKPOINTS.md`
- Bus logic or bus data:
  - `docs/BUS_LOGIC_LOCK.md`
- Deploy or post-deploy:
  - `docs/POST_DEPLOY_FOLLOWUPS.md`
- Prompt/template standardization:
  - `docs/PROMPT_TEMPLATES.md`
- Visual/project orientation:
  - `docs/PROJECT_MAP.md`
  - `docs/PROJECT_MINI_MAP.md`
- Long-term truth or conflict escalation:
  - `docs/PROJECT_MEMORY.md`
  - `docs/TRUTH_INDEX.md`

Historical checkpoints, audits, audit backlogs and project memory are on-demand only and never part of the default read set. This default read set supersedes the older `AGENTS.md` + `docs/CURRENT_STATE.md`-only read policy still written in `docs/TOKEN_BUDGET_RULES.md` and `docs/PROMPT_SYSTEM.md`.

## Working rules

- Work in narrow passes.
- Follow `docs/ACTIVE_SCOPE_LOCK.md`.
- Do not change code during docs-only passes.
- Do not reopen Trends in v1.
- Do not redesign the app unless explicitly unlocked.
- Do not do broad refactors without a new active lock.
- Do not invent missing logic silently.
- Do not silently change architecture or data shape.
- Do not commit secrets.
- Do not write API keys or tokens into repo files.
- If docs conflict, apply the conflict rule below; never invent a compromise.
- If baseline does not match the docs, stop and report before fixing.
- If a task is unclear, classify it first:
  - docs
  - checkpoint
  - QA
  - bugfix
  - bus-data
  - bus-logic
  - deploy
  - post-deploy

## Live authority rule

- Verified live Git state (repo root, branch, HEAD, worktree, staged set) outranks memory, old chats, handoffs, screenshots and historical checkpoints or audits.
- Repo-owned current governance docs and accepted repo specs outrank external orientation material (ZIPs, context bundles, mockups, other projects' docs).
- Never reuse an old commit hash, file allowlist, audit verdict or validation result without verifying it against current live state.
- Baseline advance: if live Git state changes during a gate, audit or pass for reasons outside that pass (new HEAD, unexpected worktree or staged changes), stop and restart from the new baseline. A verdict tied to the previous baseline is void.

## Conflict rule

- Active lock and `docs/SESSION_BOOT.md` win for current work.
- `docs/SESSION_BOOT.md` is the operational current-state entrypoint.
- `docs/PROJECT_MEMORY.md` is long-term project truth.
- `docs/BUS_LOGIC_LOCK.md` wins for bus logic.
- If canonical live docs still conflict after these rules, stop and report before changing anything. Do not invent a compromise.

## Bus-specific rule

For bus work, `docs/BUS_LOGIC_LOCK.md` is the canonical rule source.

Locked principle:
- Rakvere bus logic is pattern + stopId based, not stop-name-only.
- Same-name stops may be grouped for display only.
- Routing logic must preserve direction-specific stop IDs.
- Nearest stop logic must use stop-points, not display group centroid.

## Scope rule

Current v1 must not silently expand.

Do not add or reopen:
- Trends
- Loo oma trend
- broad redesign
- broad refactor
- unrelated backend changes
- unrelated deployment changes

Any new feature requires a new active scope lock first.

## Audit and evidence rule

- A review or audit verdict applies only to the exact diff and state it reviewed.
- Any material delta after the audit (changed content, added or removed files, a different baseline) makes that verdict stale.
- A fresh read-only audit of the final diff is required before staging or commit.
- Audit packets, validation results and smoke status must come from actual Git output and commands actually run. Never invent audit, validation or smoke evidence; report unrun checks as not run. Packet format: `docs/PROMPT_TEMPLATES.md`.

## Human gate

- For user-visible changes, automated tests and code/test audits do not replace human visual/runtime smoke.
- When a pass requires human smoke, automated PASS plus reviewer PASS must not be reported as UI acceptance. Smoke stays `PENDING` until the human confirms it; an agent never marks it PASS on the human's behalf.

## Exact staging rule

- Never broad-stage: no `git add .`, `git add -A`, `git add -u`, `git commit -a` or `git commit -am`.
- Stage only the exact accepted file set, by explicit path, after the latest applicable audit.
- Before commit, `git diff --cached --name-only` must equal that accepted set; otherwise stop.

## Standard closeout

Preferred sequence for an implementation route:

1. implementation
2. automated validation
3. human/manual smoke when user-visible
4. fresh read-only audit of the final diff
5. exact stage / commit / push
6. checkpoint / route closeout
7. separate optional docs/memory compaction pass

Commit and deploy stay separate passes. Docs/memory compaction is never mixed into implementation. This sequence supersedes the older lifecycle orderings in `docs/PROMPT_SYSTEM.md` (Pass lifecycle) and `docs/MERMAID_DIAGRAMS.md` (diagram D), which place checkpoint docs before commit and have no audit step.

## Test integrity rule

- Production code must not contain invisible or test-only UI solely to keep stale tests passing.
- Integration/UI tests must exercise real visible production behavior.
- When accepted product behavior changes, update the stale tests instead of adding hidden compatibility anchors.
- Injected test seams (parameters, fixtures, test-only wrappers) are allowed only when they add no production UI or behavior.

## Design authority rule

- Figma, reference mockups, design ZIPs and generated design code are design/provenance input, not runtime authority.
- Adopting runtime assets or generated code requires the implementation pass to authorize those exact files or assets explicitly.

## Docs and memory hygiene

- One fact, one primary home; other docs link to it instead of restating it.
- Keep the default read set compact (see Read order).
- Historical checkpoints, audits and project memory stay on demand.
- Docs/memory compaction is a separate pass after route closeout.

## Session-end ritual

Performed at checkpoint / route closeout, not inside implementation passes:

1. Update `docs/SESSION_BOOT.md` when current state or the next phase changes.
2. Update `docs/ACCEPTED_CHECKPOINTS.md` if a pass was accepted.
3. Check `docs/ACTIVE_SCOPE_LOCK.md` and update only if the next pass changed.

## Completion rule

Every implementation pass must end with:

1. files changed
2. build/test result
3. what stayed untouched
4. whether the pass is checkpointable
5. recommended next narrow pass
6. manual smoke status when user-visible
7. `CLAUDE_AUDIT_PACKET` and current git status

Every docs-only pass must end with:

1. docs changed
2. whether scope changed
3. active lock after update
4. remaining open questions
5. recommended next narrow pass
6. current git status
