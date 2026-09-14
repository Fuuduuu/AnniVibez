# PROMPT_TEMPLATES.md

Status: reusable Codex prompt templates for AnniVibe.

Purpose:
- reduce repeated prompt text
- keep every pass aligned with truth-layer docs
- prevent scope drift
- make future Codex prompts short

Do not duplicate full project memory here.
This file references the canonical docs.

---

## Universal short preamble

Use this at the top of short prompts:

```text
Read and obey AGENTS.md.
Read docs/SESSION_BOOT.md, docs/CURRENT_STATE.md and docs/ACTIVE_SCOPE_LOCK.md.
Use the relevant template from docs/PROMPT_TEMPLATES.md.
Read only pass-specific files beyond that.
Do one narrow pass only.
```

Default read-first is the `AGENTS.md` default read set:
- `AGENTS.md`
- `docs/SESSION_BOOT.md`
- `docs/CURRENT_STATE.md`
- `docs/ACTIVE_SCOPE_LOCK.md`
- pass-specific files only

Authority, audit validity, human gate, exact staging, closeout and test-integrity rules live in `AGENTS.md`. Templates reference them and do not restate them.

---

## Output contract used by all templates

Unless the task says otherwise, output:

```text
A. What was done
B. Files changed
C. Validation result
D. What stayed untouched
E. Whether this is checkpointable
F. Recommended next narrow pass
G. Remaining risks / open questions
H. Current git status
```

---

## PASS 26A compact templates (preferred)

Guideline for all templates:
- be a sniper, not a machine gun
- one pass only
- no unrelated "helpful" edits

Common placeholders:
- `PASS_NAME`
- `GOAL`
- `EXPECTED_HEAD`
- `FILES_TO_READ`
- `LIKELY_TOUCHED`
- `PROTECTED_FILES`
- `VALIDATION`
- `STOP_IF`
- `CLAUDE_AUDIT_PACKET`
- `OUTPUT_REQUIRED`

### Execution prompt extensions: STOP_IF and CLAUDE_AUDIT_PACKET

`STOP_IF` lists the conditions that end the pass with a report instead of a workaround. Default entries, extended per pass:

```text
STOP_IF:
- live repo/branch/HEAD/worktree/staged state differs from the expected baseline
- live Git state advances during the pass or audit (restart from the new baseline)
- canonical docs still conflict after the AGENTS.md conflict rule
- a required change falls outside LIKELY_TOUCHED or touches PROTECTED_FILES
- a required validation cannot be run
- <pass-specific conditions>
```

`CLAUDE_AUDIT_PACKET` is produced at the end of an implementation pass for the fresh read-only audit. Generate every field from live Git output and commands actually run:

```text
CLAUDE_AUDIT_PACKET:
BASELINE: <branch> @ <git rev-parse HEAD> (expected: <EXPECTED_HEAD>)
CHANGED_FILES: <git status --short --untracked-files=all, this pass's files>
DIFF: <git diff -- <changed files>; untracked files included in full>
VALIDATION_RUN: <exact command -> exit code and PASS/FAIL counts>
CHECKS_NOT_RUN: <check -> reason>
MANUAL_SMOKE: not-required (<reason>) | PENDING | PASS (<human, device/URL, what>) | FAIL (<what>)
GIT_STATUS: <git status --short --untracked-files=all>
STAGED: <git diff --cached --name-only>
```

Packet rules:
- Never invent packet, validation or smoke content; unrun checks stay listed under `CHECKS_NOT_RUN`.
- A packet describes one state only. Any later material delta makes it and its verdict stale (`AGENTS.md` audit and evidence rule).
- The packet lives in the pass output. Ordinary passes need no diff hashes or separate audit files.

### 1) Docs-only planning pass

```text
PASS_NAME: <PASS_NAME>
GOAL: <GOAL>

Repo alignment gate (required):
pwd
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git remote -v
git status --short --untracked-files=all
git ls-files docs/SESSION_BOOT.md

FILES_TO_READ: <FILES_TO_READ>
LIKELY_TOUCHED: docs/*
PROTECTED_FILES: <PROTECTED_FILES>
VALIDATION: git status --short --untracked-files=all (docs-only changes)
STOP_IF: <STOP_IF>
OUTPUT_REQUIRED: <OUTPUT_REQUIRED>
Stop and wait.
```

### 2) Implementation pass

```text
PASS_NAME: <PASS_NAME>
GOAL: <GOAL>
EXPECTED_HEAD: <EXPECTED_HEAD>
FILES_TO_READ: <FILES_TO_READ>
LIKELY_TOUCHED: <LIKELY_TOUCHED>
PROTECTED_FILES: <PROTECTED_FILES>
VALIDATION:
- <VALIDATION>
- npm run build
MANUAL_SMOKE: required (<what>) | not-required (<reason>)
STOP_IF: <STOP_IF>
OUTPUT_REQUIRED:
- <OUTPUT_REQUIRED>
- CLAUDE_AUDIT_PACKET
No staging or commit in this pass.
Stop and wait.
```

### 3) Validation/checkpoint pass

```text
PASS_NAME: <PASS_NAME>
GOAL: Validate previously implemented pass without new implementation.
FILES_TO_READ: <FILES_TO_READ>
LIKELY_TOUCHED: docs/checkpoint files only
PROTECTED_FILES: src/*, functions/* (unless explicitly requested)
VALIDATION:
- npm run build
- source/manual checks
- git diff --name-only
OUTPUT_REQUIRED: <OUTPUT_REQUIRED>
Stop and wait.
```

### 4) Deploy/live-smoke pass

```text
PASS_NAME: <PASS_NAME>
GOAL: Deploy current validated tree and run live smoke checks.
FILES_TO_READ: docs/SESSION_BOOT.md, docs/POST_DEPLOY_FOLLOWUPS.md
LIKELY_TOUCHED: none (or docs-only if explicitly requested)
PROTECTED_FILES: runtime/source files
VALIDATION:
- npm run build
- wrangler/pages deploy
- canonical URL 200
- /api smoke
OUTPUT_REQUIRED: <OUTPUT_REQUIRED>
Stop and wait.
```

### 5) Commit/push pass

```text
PASS_NAME: <PASS_NAME>
GOAL: Stage the exact accepted file set, commit, push.
FILES_TO_READ: docs/SESSION_BOOT.md
EXPECTED_HEAD: <EXPECTED_HEAD>
ACCEPTED_FILES: <explicit paths>
PRECONDITION: fresh audit PASS for the current diff; human smoke PASS when required
LIKELY_TOUCHED: none
PROTECTED_FILES: all non-listed files
STOP_IF:
- HEAD, worktree or staged state differs from the audited state
- the audit verdict predates the latest change
- any file outside ACCEPTED_FILES would be staged
STAGING: git add -- <ACCEPTED_FILES> (exact paths only; AGENTS.md exact staging rule)
VALIDATION:
- git diff --cached --name-only (must equal ACCEPTED_FILES)
- git status --short --untracked-files=all
- git log --oneline -3
OUTPUT_REQUIRED: <OUTPUT_REQUIRED>
Stop.
```

### 6) Claude architecture prompt

```text
PASS_NAME: <PASS_NAME>
GOAL: architecture/logic options and edge-case review only.
FILES_TO_READ: <FILES_TO_READ>
Constraints:
- no code edits
- preserve locked behavior
- propose 1-3 narrow options with risks
OUTPUT_REQUIRED:
- recommended option
- edge cases
- pass split proposal
```

### 7) Qwen/Ollama review prompt

```text
PASS_NAME: <PASS_NAME>
GOAL: cheap local review / patch draft only.
FILES_TO_READ: <FILES_TO_READ>
Constraints:
- no final authority
- no broad refactor suggestions
- list concrete risks and tiny patch ideas
OUTPUT_REQUIRED:
- findings by severity
- minimal patch suggestion
- what to verify in Codex
```

### 8) Claude read-only audit

```text
PASS_NAME: <PASS_NAME>_AUDIT
GOAL: fresh read-only audit of the exact state in CLAUDE_AUDIT_PACKET.
INPUT: <CLAUDE_AUDIT_PACKET>
Constraints:
- no edits, staging or commits
- verify live branch/HEAD/status matches the packet first; if not, STOP (stale packet)
- the verdict applies only to this packet's state
OUTPUT_REQUIRED:
- VERDICT: PASS | AMEND | FAIL
- findings by severity with file:line
- checks not run and manual smoke still required
```

---

## 1. DOCS_ONLY_PASS

Use for documentation creation/update only.

Required reads:
- `docs/SESSION_BOOT.md`

```text
Template: DOCS_ONLY_PASS

Rules:
- Do not touch code.
- Do not change runtime.
- Do not change deployment.
- Do not add features.
- Do not redesign.
- Do not bring Trends back.

Allowed:
- docs/*.md
- AGENTS.md only if task explicitly asks

Validation:
- git status --short
- confirm only docs/root governance files changed

Output:
Use the shared output contract.
```

---

## 2. DOCS_CHECKPOINT_PASS

Use after a completed bugfix, QA, deploy, or docs pass.

Required reads:
- `docs/SESSION_BOOT.md`
- `docs/ACCEPTED_CHECKPOINTS.md`
- `docs/ACTIVE_SCOPE_LOCK.md`

```text
Template: DOCS_CHECKPOINT_PASS

Task:
Record the completed pass in:
- docs/ACCEPTED_CHECKPOINTS.md
- docs/ACTIVE_SCOPE_LOCK.md

Rules:
- Do not touch code.
- Do not alter completed implementation.
- Do not open broad new scope.

Must record:
- pass name
- accepted/rejected status
- files changed
- build/test result
- current active lock
- next narrow pass

Validation:
- git status --short
- confirm only checkpoint docs changed
```

---

## 3. BUGFIX_PASS

Use for one concrete live/user-reported bug.

Required reads:
- `docs/SESSION_BOOT.md`
- relevant lock doc for the touched surface

```text
Template: BUGFIX_PASS

Rules:
- Fix one bug only.
- Audit first, then implement.
- Do not redesign.
- Do not refactor broadly.
- Do not touch unrelated tabs/files.
- If scope expands, stop and report.

Allowed files:
- list explicitly in the short prompt

Validation:
- npm run build
- targeted repro case
- targeted fixed case
- no unrelated files changed

Output:
Use the shared output contract.
```

---

## 4. BUS_DATA_PASS

Use for restoring or normalizing bus source data.

Required reads:
- `docs/SESSION_BOOT.md`
- `docs/BUS_LOGIC_LOCK.md`

```text
Template: BUS_DATA_PASS

Required extra docs:
- docs/BUS_LOGIC_LOCK.md

Rules:
- Data/model pass only.
- Do not change UI unless required to keep build working.
- Do not implement destination filtering in this pass.
- Do not invent missing trips/times.
- If source coverage is incomplete, document it.

Allowed typical files:
- src/data/busData.js
- optional source parser/normalizer if explicitly approved

Validation:
- npm run build
- report counts:
  - stop IDs
  - display groups
  - lines
  - patterns
  - trips/schedules
- confirm Õie and Tulika locked stopIds still exist

Output:
Use the shared output contract.
```

---

## 5. BUS_LOGIC_PASS

Use for bus behavior after data is locked.

Required reads:
- `docs/SESSION_BOOT.md`
- `docs/BUS_LOGIC_LOCK.md`

```text
Template: BUS_LOGIC_PASS

Required extra docs:
- docs/BUS_LOGIC_LOCK.md

Rules:
- One bus behavior change only.
- Preserve pattern + stopId logic.
- Do not regress nearest stop-point logic.
- Do not merge direction-specific stop IDs.
- Do not touch App/Loo/Päevik/Tugi/Seaded/API/deploy.

Allowed typical files:
- src/utils/bus.js
- src/components/BussTab.jsx
- src/components/BussCard.jsx
- src/data/busData.js only if a tiny verified data issue is found and reported first

Validation:
- npm run build
- deterministic bus cases required by the short prompt
- specifically check Õie/Tulika if relevant
- no dist files committed

Output:
Use the shared output contract.
```

---

## 6. QA_PASS

Use for local, mobile, or live smoke testing.

Required reads:
- `docs/SESSION_BOOT.md`

```text
Template: QA_PASS

Rules:
- Prefer reporting first.
- Do not change code unless an explicit blocker is found and the fix is tiny/local.
- Do not open new features.
- Do not redesign.

Minimum checks when relevant:
- npm run build
- app opens
- bottom nav works
- Kodu/Buss/Loo/Päevik/Tugi/Seaded
- Loo drawing tips count = 17
- Üllata returns idea or fallback
- no critical console/runtime errors

Output must include:
- QA matrix
- commands run
- results by flow
- GO/NO-GO
- exact blocker-fix pass if NO-GO
```

---

## 7. DEPLOY_PASS

Use for Cloudflare Pages deploy or deploy verification.

Required reads:
- `docs/SESSION_BOOT.md`
- `docs/POST_DEPLOY_FOLLOWUPS.md`

```text
Template: DEPLOY_PASS

Required extra docs:
- docs/POST_DEPLOY_FOLLOWUPS.md

Rules:
- Do not commit secrets.
- Do not print secrets.
- Do not write tokens/API keys into repo files.
- Do not change code unless deploy is blocked by one tiny/local issue and report first.

Expected settings:
- Build command: npm run build
- Output directory: dist
- Root directory: repo root
- Functions directory: functions
- Branch: main

Validation:
- git status --short
- npm run build
- Cloudflare deploy result
- live URL smoke
- /api/ullata POST returns JSON with idea and source

Output must include:
- deploy target/settings
- env vars configured/missing without values
- live URL
- GO/NO-GO
```

---

## 8. POST_DEPLOY_PASS

Use for optional post-deploy documentation only.

Required reads:
- `docs/SESSION_BOOT.md`
- `docs/POST_DEPLOY_FOLLOWUPS.md`

```text
Template: POST_DEPLOY_PASS

Rules:
- Docs-only unless explicitly unlocked.
- Do not change code.
- Do not change deployment settings.
- Do not commit secrets.

Allowed:
- docs/POST_DEPLOY_FOLLOWUPS.md
- docs/ACCEPTED_CHECKPOINTS.md
- docs/ACTIVE_SCOPE_LOCK.md

Typical topics:
- OPENAI_API_KEY setup status
- OPENAI_MODEL status
- source=openai vs source=local verification
- optional real Android Chrome smoke status

Output:
Use the shared output contract.
```

---

## Short prompt examples

### Example 1 — bus destination logic

```text
Read and obey AGENTS.md.
Use BUS_LOGIC_PASS.

Task:
Implement destination/upcoming sequence logic.

Allowed files:
- src/utils/bus.js
- src/components/BussTab.jsx

Must preserve:
- nearest stop-point logic
- BUS_DATA.patterns
- docs/BUS_LOGIC_LOCK.md rules

Validate:
npm run build.
Test valid destination, invalid direction, no destination, and Õie/Tulika remain distinct.
Report before coding if baseline does not match.
```

### Example 2 — docs checkpoint

```text
Read and obey AGENTS.md.
Use DOCS_CHECKPOINT_PASS.

Task:
Record nearest-stop fix as accepted.

Record:
- files changed
- build result
- Õie/Tulika validation
- next active lock
```

### Example 3 — live QA

```text
Read and obey AGENTS.md.
Use QA_PASS.

Task:
Run live smoke on https://annivibe.pages.dev.

Check:
Kodu, Buss, Loo, Päevik, Tugi, Seaded, /api/ullata, console errors.
```

### Example 4 — deploy

```text
Read and obey AGENTS.md.
Use DEPLOY_PASS.

Task:
Verify Cloudflare Pages deployment for main branch.

Do not print secrets.
Report live URL and /api/ullata source.
```

### Example 5 — OpenAI key follow-up

```text
Read and obey AGENTS.md.
Use POST_DEPLOY_PASS.

Task:
Document OPENAI_API_KEY setup status and test result.

Do not commit secrets.
```

---

## Checkpoint archive rule

- Keep only active/recent checkpoints in `docs/ACCEPTED_CHECKPOINTS.md`.
- Move older history later to `docs/archive/CHECKPOINTS_history.md`.
- Do not archive during a pass unless explicitly requested.

---

## Rule for future prompts

A good future prompt should usually be 10-20 lines, not 80+ lines.

Structure:
1. template name
2. task
3. allowed files
4. must preserve
5. validation
6. stop conditions (`STOP_IF`)

If the prompt needs more than that, update the docs first instead of expanding the prompt.
