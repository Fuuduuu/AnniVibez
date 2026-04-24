# PROJECT_MINI_MAP.md

Status: one-screen map for fast AI orientation.

```mermaid
flowchart LR
  TL["Truth Layer<br/>PROJECT_MEMORY<br/>TRUTH_INDEX<br/>ACTIVE_SCOPE_LOCK<br/>ACCEPTED_CHECKPOINTS"]
  SRC["Canonical App<br/>src/App.jsx<br/>src/components<br/>src/hooks"]
  API["API<br/>functions/api/ullata.js<br/>fallback safe"]
  BUILD["Build<br/>npm run build<br/>dist/"]
  LIVE["Live<br/>annivibe.pages.dev"]
  NEXT["Next Pass<br/>one narrow task only"]

  TL --> SRC
  SRC --> API
  SRC --> BUILD
  API --> LIVE
  BUILD --> LIVE
  TL --> NEXT

  BLOCK["Do NOT in v1:<br/>Trends<br/>redesign<br/>broad refactor<br/>secret commits"]
  TL -. blocks .-> BLOCK

  classDef truth fill:#eef2ff,stroke:#5b5fc7,color:#111;
  classDef runtime fill:#fff4d6,stroke:#b9770e,color:#111;
  classDef live fill:#e8f4ff,stroke:#2874a6,color:#111;
  classDef stop fill:#ffe5e5,stroke:#c0392b,color:#111;

  class TL,NEXT truth;
  class SRC,API,BUILD runtime;
  class LIVE live;
  class BLOCK stop;
```

## Use this when starting a new AI pass

Ask:
1. What does `ACTIVE_SCOPE_LOCK.md` allow?
2. Is this a docs pass, QA pass, bugfix pass, or deploy pass?
3. What single file/surface is being touched?
4. What must stay untouched?
5. What checkpoint proves the pass is complete?
