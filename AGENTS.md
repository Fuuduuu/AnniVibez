# AGENTS.md

Status: root AI working rules for AnniVibe.

## Read order before every task

Always read first:

1. `docs/SESSION_BOOT.md`

Then read only what the task needs:

- Docs checkpoint / lock updates:
  - `docs/ACCEPTED_CHECKPOINTS.md`
  - `docs/ACTIVE_SCOPE_LOCK.md`
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
- If docs conflict, follow the conservative canonical interpretation.
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

## Conflict rule

- Active lock and current session state win for current work.
- `docs/SESSION_BOOT.md` is the operational current-state entrypoint.
- `docs/PROJECT_MEMORY.md` is long-term project truth.
- `docs/BUS_LOGIC_LOCK.md` wins for bus logic.
- If conflict remains after these rules, stop and report before changing anything.

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

## Mandatory session-end ritual

1. Update `docs/SESSION_BOOT.md`.
2. Update `docs/ACCEPTED_CHECKPOINTS.md` if a pass was accepted.
3. Check `docs/ACTIVE_SCOPE_LOCK.md` and update only if the next pass changed.

## Completion rule

Every implementation pass must end with:

1. files changed
2. build/test result
3. what stayed untouched
4. whether the pass is checkpointable
5. recommended next narrow pass

Every docs-only pass must end with:

1. docs changed
2. whether scope changed
3. active lock after update
4. remaining open questions
5. recommended next narrow pass
