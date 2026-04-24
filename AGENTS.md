# AGENTS.md

Status: root AI working rules for AnniVibe.

## Read order before every task

Always read first:

1. `docs/PROJECT_MEMORY.md`
2. `docs/TRUTH_INDEX.md`
3. `docs/ACTIVE_SCOPE_LOCK.md`
4. `docs/ACCEPTED_CHECKPOINTS.md`

Then read when present:

5. `docs/CODEBASE_MAP.md`
6. `docs/CHANGE_SURFACES.md`

## Conditional read order

If the task touches bus logic, also read:

- `docs/BUS_LOGIC_LOCK.md`

If the task touches deploy, post-deploy checks, or API key setup, also read:

- `docs/POST_DEPLOY_FOLLOWUPS.md`

If the task needs visual/project orientation, also read:

- `docs/PROJECT_MAP.md`
- `docs/PROJECT_MINI_MAP.md`

If the task is about writing, shortening, or standardizing Codex prompts, also read:

- `docs/PROMPT_TEMPLATES.md`

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
