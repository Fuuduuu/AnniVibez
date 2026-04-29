# TOKEN_BUDGET_RULES

Status: PASS 26B docs-only workflow optimization.

## Goal

Reduce Codex token use while preserving safety and scope control.

## Default read policy

- read `AGENTS.md`
- read `docs/CURRENT_STATE.md`
- use `docs/CODEBASE_IMPACT_MAP.md` and `docs/PROTECTED_SURFACES.md` to choose read/touch/validate scope
- read only pass-specific files required by the prompt
- do not read `docs/ACCEPTED_CHECKPOINTS.md` unless checkpoint/history is needed
- do not read `docs/AUDIT_FINDINGS_BACKLOG.md` unless backlog state is part of the pass
- do not read `docs/TRUTH_INDEX.md` unless docs index/canonical references are being changed
- do not scan full repo trees by default
- do not inspect unrelated source files

## Prompt size rules

- one goal per prompt
- one pass per prompt
- avoid broad context dumps
- include a short "known accepted state" summary instead of full history
- use Claude/Qwen for larger exploratory analysis before sending a minimal Codex pass prompt

## Docs update rules

- small data/code pass: update docs only when state/lock/checkpoint truly changes
- runtime/UI pass: checkpoint only after build and required smoke checks
- docs-only direction change: update only the relevant planning/governance docs
- commit-only pass: no docs edits
- deploy-only pass: no docs edits unless recording a new accepted deploy checkpoint

## Output rules

Codex output should be compact by default:
- files read
- files changed
- build/validation result
- protected files untouched
- git status
- stop/wait

## When to expand context

Allow larger read-first only when:
- architecture direction changes
- debugging a cross-file bug
- recovering from alignment mismatch/dirty tree issues
- preparing a major checkpoint
- source ownership is unclear

In normal passes, the impact map is authoritative for scope discipline:
- `docs/CODEBASE_IMPACT_MAP.md`
