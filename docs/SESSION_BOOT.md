# SESSION_BOOT.md

Status: operational session entrypoint for AnniVibe.

## Project

AnniVibe is a live Android-first / PWA creative app for a 10-13-year-old user.

Live:
https://annivibe.pages.dev

## Current state

Latest accepted baseline:
- Cloudflare manual Wrangler deploy verified
- app live and smoke-tested
- pattern-aware Rakvere bus data added
- nearest bus stop now uses stop-points, not group centroid
- prompt template system added

## Current active focus

Next likely pass:
BUS_LOGIC_PASS - destination/upcoming sequence logic.

## Allowed files for next pass

- src/utils/bus.js
- src/components/BussTab.jsx

## Must preserve

- nearest stop-point logic
- BUS_DATA.patterns
- Õie/Tulika stopId distinction
- docs/BUS_LOGIC_LOCK.md rules

## Forbidden in next pass

- src/App.jsx
- src/components/LooTab.jsx
- src/components/PaeviikTab.jsx
- src/components/TugiTab.jsx
- src/components/SeadedTab.jsx
- functions/api/ullata.js
- deploy config
- design tokens
- Trends
- broad redesign/refactor

## Active risks

- Cloudflare Git-backed deploy previously built old commit 165d23e.
- Manual Wrangler deploy works.
- Destination/upcoming logic is not yet completed.
- Do not regress busData patterns or nearest stop-point logic.

## Required reads by task

Bus work:
- docs/BUS_LOGIC_LOCK.md

Deploy/API-key work:
- docs/POST_DEPLOY_FOLLOWUPS.md

Prompt/workflow work:
- docs/PROMPT_TEMPLATES.md

Historical context only if needed:
- docs/ACCEPTED_CHECKPOINTS.md
- docs/PROJECT_MEMORY.md
- docs/TRUTH_INDEX.md

## Session-end checklist

Before ending a session:

1. Update this file with current state and next pass.
2. Update docs/ACCEPTED_CHECKPOINTS.md if a pass was accepted.
3. Check docs/ACTIVE_SCOPE_LOCK.md and update if the next pass changed.
4. Ensure git status is clean or explicitly reported.
