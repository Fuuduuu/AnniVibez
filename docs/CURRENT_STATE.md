# CURRENT_STATE

Status: compact low-token state snapshot for future Codex passes.

## Repo

- branch: `main`
- canonical app URL: `https://annivibe.pages.dev`
- Cloudflare Pages project: `annivibe`
- build command: `npm run build`
- deploy command: `npx wrangler pages deploy dist --project-name annivibe`

## Accepted runtime features

- destination-first bus flow is active in `BussTab`
- route cards include:
  - `Mine peatusesse`
  - `Sõida liiniga`
  - `Välju peatuses`
- POI/place-first destination direction is accepted
- local POI dataset file exists (`src/data/poiData.js`) and is not wired to UI yet
- Üllata provider chain is `Gemini -> OpenAI -> local`
- Üllata save persistence uses localStorage key `annivibe_saved_ideas`
- build/deploy workflow for Cloudflare Pages is documented and in use

## Current bus architecture

- primary prompt is destination-first: `Kuhu soovid minna?`
- effective origin model:
  - `effectiveOrigin = manualOriginOverride ?? currentOrigin`
- route engine remains:
  - `depsWithMeta(...)`
- coordinate-to-stop resolver remains:
  - `nearest(...)`
- origin code resolution is protected:
  - `displayCodes || codes || [code]`
- nearby candidate logic remains active
- route-card intent is:
  - walk to origin stop
  - take line
  - get off at destination stop

## POI/place direction

- users should search places, not internal stop names
- stop-name search remains fallback/advanced path
- current implementation state:
  - POI dataset exists
  - place-search UI not implemented yet
  - map picker not implemented yet
- map remains future input method, not a new routing engine

## Protected boundaries

- do not rewrite `depsWithMeta(...)` casually
- do not rewrite `nearest(...)` casually
- do not remove `displayCodes || codes || [code]` fallback
- do not remove Õie/Tulika nearby behavior
- do not remove Kivi/Kesk sibling-code behavior
- do not mix bus work with Üllata/API work
- do not add map inside non-map pass
- do not touch runtime in docs-only pass

## Agent workflow

- Human/user: final acceptance, field testing, deploy approval
- ChatGPT: scope controller, prompt writer, reviewer
- Claude: architecture and edge-case planner
- Qwen/Ollama: low-cost reviewer / patch drafter
- Codex: real repo edits, build/deploy/status execution

## Default future Codex read-first rule

For most passes, read only:
- `AGENTS.md`
- `docs/CURRENT_STATE.md`
- pass-specific files listed in the prompt

Expand reads only when the prompt explicitly requires it.

Use these docs to decide read/touch/validate boundaries:
- `docs/CODEBASE_IMPACT_MAP.md`
- `docs/PROTECTED_SURFACES.md`

## Next likely passes

- `PASS 26C — WORKFLOW_AND_BUS_LOGIC_DIAGRAMS`
- `PASS 25D — PLACE_SEARCH_UI_NO_MAP`
- `PASS 25E — ROUTE_RECOMMENDATION_SCORING_NO_MAP`
- `PASS 25F — MAP_PICKER_SKELETON`

## Known deploy notes

- Wrangler/Cloudflare can occasionally fail with `10500` / `503`
- canonical/PWA cache can briefly show an older bundle
- after deploy, verify canonical HTML bundle asset
- recovery details are in `docs/DEPLOYMENT.md`
