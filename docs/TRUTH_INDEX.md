# TRUTH_INDEX.md

## Canonical truth

Need failid on AnniVibe praegune põhitõde:

- `docs/PROJECT_MEMORY.md`
- `docs/TRUTH_INDEX.md`
- `docs/ACTIVE_SCOPE_LOCK.md`
- `docs/ACCEPTED_CHECKPOINTS.md`

## Active lock files

Need failid juhivad aktiivset tööd, aga ei asenda põhitõde:

- `docs/ACTIVE_SCOPE_LOCK.md`
- `docs/ACCEPTED_CHECKPOINTS.md`

## Supporting docs

Need võivad toetada tööd, aga ei tohi canonical truth’i üle kirjutada:

- `AGENTS.md`
- `docs/FUTURE_DIRECTION.md`
- `docs/IMPLEMENTATION_PATH_LATER.md`
- `docs/CODEBASE_MAP.md`
- `docs/CHANGE_SURFACES.md`
- `docs/PROJECT_MAP.md`
- `docs/PROJECT_MINI_MAP.md`
- `docs/PROMPT_SYSTEM.md`
- `docs/PROMPT_TEMPLATES.md`
- `docs/CURRENT_STATE.md`
- `docs/ROUTING_UX_PRINCIPLES.md` (product/UX guidance; not raw data/audit truth)
- `docs/TOKEN_BUDGET_RULES.md`
- `docs/MERMAID_DIAGRAMS.md`
- `docs/assets/annivibe-sniper-matrix.png` (visual aid; source-of-truth in `docs/CODEBASE_IMPACT_MAP.md`)
- `docs/DEPLOYMENT.md`
- `docs/BUS_POI_DESTINATION_PLAN.md`
- `docs/CODEBASE_IMPACT_MAP.md`
- `docs/PROTECTED_SURFACES.md`
- `docs/SECURITY_APPEND.md`

## Historical / duplicate / not-yet-instantiated docs

Need ei ole praegu canonical truth:

- vanemad või kõrvalised handoff failid
- eelmistest voorudest jäänud truth-layer eksperimendid
- täitmata template-docs, kuni need on päriselt instantsieeritud

## Current project interpretation

- `src/` on canonical app baseline
- docs truth on 4-failine minimaalne governance kiht
- Pass 1 on docs-only governance bootstrap
- järgmine õige samm on docs-only codebase mapping, mitte koodimuudatus

## Conflict rule

Kui tekib vastuolu:
1. `docs/PROJECT_MEMORY.md` võidab
2. `docs/TRUTH_INDEX.md` ütleb, mis on canonical ja mis supporting
3. `docs/ACTIVE_SCOPE_LOCK.md` võidab aktiivse järgmise sammu küsimustes
4. `docs/ACCEPTED_CHECKPOINTS.md` ütleb, milline implementation baseline on accepted
5. supporting või historical failid ei tohi aktiivset truth-layerit ümber kirjutada
