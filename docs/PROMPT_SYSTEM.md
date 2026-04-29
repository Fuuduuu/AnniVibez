# PROMPT_SYSTEM.md

Status: PASS 26A docs-only governance sync.

Purpose:
- formalize the AnniVibe pass-based execution model
- keep prompts narrow, testable, and checkpointable
- prevent scope drift between bus, map, and Üllata/API work

## Core workflow principles

- one narrow pass at a time
- docs-first when product direction changes
- scope lock before implementation
- implementation only after scope is explicit
- validation before checkpoint
- deploy/live smoke before runtime/UI acceptance
- commit only after validation
- Codex stops after each pass and waits for explicit next prompt
- no broad refactors without explicit pass
- no mixing unrelated surfaces

## Protected boundaries

- `depsWithMeta(...)` must not be rewritten unless a concrete bug is proven
- `nearest(...)` and nearby-stop behavior must not be casually changed
- `displayCodes || codes || [code]` sibling handling must be preserved
- Õie/Tulika nearby handling must be preserved
- Kivi/Kesk sibling-code handling must be preserved
- map work must not be mixed into non-map passes
- Üllata/API work must not be mixed with bus/map work
- docs-only passes must not touch runtime files

## Agent roles

- Human/user: final acceptance, field testing, deploy approval, product direction
- ChatGPT: scope controller, prompt writer, reviewer, checkpoint logic
- Claude: architecture/logic designer, edge-case planner
- Qwen/Ollama: cheap/local reviewer or patch drafter, never final authority
- Codex: applies approved changes in real repo, runs build/deploy/status, stops after pass

## Pass lifecycle

1. idea / issue
2. architecture or docs planning pass if direction changes
3. narrow implementation pass
4. build/source validation
5. deploy/live smoke if UI/runtime changed
6. checkpoint docs
7. commit/push
8. next locked pass

## Required Codex prompt sections

Every Codex prompt should include:

- PASS name
- goal
- repo alignment gate
- read-first files
- scope
- do list
- do-not list
- likely touched files
- protected files not to touch
- validation commands
- manual/source checks
- docs update requirements
- required output
- stop/wait instruction

## Default low-token read-first policy

For most passes, default read-first context is:

- `AGENTS.md`
- `docs/CURRENT_STATE.md`
- pass-specific files listed in the prompt

Token policy details are in:

- `docs/TOKEN_BUDGET_RULES.md`

## Required repo alignment gate

Use this default gate pattern:

```text
pwd
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git remote -v
git status --short --untracked-files=all
git ls-files docs/SESSION_BOOT.md
```

## Required Codex output fields

- repo root, branch, HEAD, remote
- files read
- files changed
- exact code/doc areas changed
- build result, if applicable
- validation result
- protected-file untouched confirmation
- `git diff --name-only`
- `git status --short --untracked-files=all`
- next recommended pass
- stop/wait confirmation
