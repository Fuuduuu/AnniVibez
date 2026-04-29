# PROTECTED_SURFACES

## Bus engine

- `src/utils/bus.js`
- `depsWithMeta(...)`
- `nearest(...)`
- `emptyReason(...)`

Rules:
- do not modify unless pass explicitly targets bus engine
- do not rewrite for UI-only, POI-only, map-only, or docs-only passes

## Bus data

- `src/data/busData.js`

Rules:
- do not modify unless pass explicitly targets timetable/stop data

## Bus UI

- `src/components/BussTab.jsx`
- `src/components/BussCard.jsx`

Rules:
- BussTab owns destination-first UI, route cards, origin override, POI/search/map integration
- BussCard owns home bus widget
- do not touch in data-only or docs-only passes

## POI data

- `src/data/poiData.js`

Rules:
- data-only local place dataset
- UI imports are allowed only in an explicit POI-search pass
- unverified POIs must remain disabled

## Üllata

- `src/components/LooTab.jsx`
- `functions/api/ullata.js`

Rules:
- do not touch in bus/data/map passes
- provider chain `Gemini -> OpenAI -> local` must not be changed unless pass explicitly targets Üllata/API
- localStorage key `annivibe_saved_ideas` must not be changed casually

## Deployment

- `docs/DEPLOYMENT.md`
- Cloudflare Pages project `annivibe`

Rules:
- deploy-only passes should not modify source
- direct dirty deploys are for smoke only; accepted work should be committed

## Docs-only

Rules:
- docs-only passes must not touch runtime/source/package files
- no build required unless package/runtime files changed

