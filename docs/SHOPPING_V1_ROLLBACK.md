# Shopping V1 and Data Integrity rollback

The Data Integrity release source is `9b192828b41b373f8aff64aa5f702f16adc7a296`. Build the browser assets and package the Pages Functions from the same clean checkout of that commit. Verify the production deployment's source against that SHA. Later documentation commits do not change the release source.

## Choose the recovery path

Prefer a fix-forward release from the approved release source. Production rollback always requires separate human authorization.

| Candidate | IndexedDB and application behavior | Decision for this release |
| --- | --- | --- |
| A · `b47e01ba673d30021bf768df653f7257ac53b1b4` | Opens IndexedDB v2 and includes Shopping and Calendar. Its server and browser can silently overwrite a remote value through a stale `MERGED` chain. | Prior production baseline only. Restoring it reintroduces the original merge defect. |
| B · `68f38e9bc9f211268c695c85bb4a3a59f6ee2a98` | Opens IndexedDB v2 and includes Shopping and Calendar. Its complete Functions tree matches the Data Integrity release and rejects unsafe pushes from old cached clients. | Preferred emergency rollback candidate if fix-forward is unavailable. Build its browser and Functions together. |
| C · `4c3c8a4a716b5e7c97a266115aa4d62e9df04fb5` with the exact v2 schema below | Opens IndexedDB v2 and preserves Shopping records at rest. The old application has no Shopping interface or API, and its Calendar server lacks the merge capability guard. | Historical storage-compatibility fallback only. Exclude it from the normal rollback plan for this release. |

B restores the previous browser code. The Calendar editor can again overwrite concurrent form changes, and Shopping bulk confirmation can again include a newly checked item. The server protection covers the sync merge path. An old browser can stop at `409 CLIENT_UPGRADE_REQUIRED` before pulling or sending later edits in that domain. Its pending mutations stay in IndexedDB. Resolve the incident with a capable client from the release or an approved fix-forward commit.

## Verify the release and emergency candidate locally

1. Use isolated checkouts at the exact SHAs and build in default forward mode with `VITE_STORAGE_AUTHORITY_MODE` unset. Keep each build with its own `functions/` tree.
2. Start with a disposable IndexedDB v2 profile from the release. Reopen that same profile with candidate B. Check `READY` storage, Calendar and Shopping data, auth, and pending mutations. Use disposable local D1 with the existing `0001` and `0002` schema.
3. Reconnect an old client with a queued stale merge and a dependent conflicting update or delete. Require `409 CLIENT_UPGRADE_REQUIRED` before the unsafe write, unchanged server data and revisions, and retained mutation IDs and patches. Restore the capable browser client in the same profile to verify safe resumption.
4. Use the local mixed-version suite for the old and current client/server pairs, including a service-worker-cached tab. In the approved production release flow, an old cached tab may need a reload to load the capable client before sync can resume. A reload into B still serves the legacy browser.

The local rehearsal of B used the same Chromium profile and local D1 across the release, rollback, and return to the release. B opened all ten IndexedDB v2 stores, showed Calendar and Shopping, and retained auth, cursors, and pending changes. Its guarded pushes returned `409` with D1 data and revisions intact. Returning to the release synced the disjoint edits and preserved the overlaps as conflicts.

Use a clean, exact checkout for any separately authorized manual deployment to Pages project `majandus`. Confirm the canonical hostname `annivibe.pages.dev`, the active deployment source, and the production binding to `majandus-backend-v1`. Before deploying this Data Integrity release, require the prior production source to match candidate A and the migration history to match the two files below. Stop on drift and reconcile the baseline. Keep automatic production deployments disabled. A Git push publishes source only for this preparation.

## Keep IndexedDB v2

Shopping V1 opens `majandus_local_v1` at **version 2**. Keep all ten stores, including `shoppingItems`, on every candidate. Plain `4c3c8a4` and any build with `DB_VERSION = 1` can fail to open devices that already use v2. A Pages rollback to a deployment with that schema has the same risk.

For candidate C's historical compatibility build, start from clean `4c3c8a4a716b5e7c97a266115aa4d62e9df04fb5` and replace only `src/storage/schema.js` with the raw Git blob from `8187699342026496facf24c2c51adddfed3f09c7` at that path.

- Git blob ID · `7916a002c3976755603afcee3b585ab1dd7084a2`
- SHA-256 of the raw 976 bytes · `89b456791017b033b83e79c22b11f60476cb1d4cbec26b1c123390c15e36642b`

Read the bytes from the Git object. Windows checkout line endings change the hash. This command hashes the blob directly and works in PowerShell.

```powershell
node --input-type=module -e "import {createHash} from 'node:crypto'; import {execFileSync} from 'node:child_process'; const bytes=execFileSync('git',['cat-file','blob','8187699342026496facf24c2c51adddfed3f09c7:src/storage/schema.js']); console.log(createHash('sha256').update(bytes).digest('hex'));"
```

When reconstructing C in the isolated checkout, write the `execFileSync` buffer directly to `src/storage/schema.js` with Node's `writeFileSync`. Require its SHA-256 to match the blob, `git diff --name-only` to show only `src/storage/schema.js`, and `git diff --check` and the default-forward build to pass.

## Preserve production and browser data

Keep the production D1 migration history at `0001_majandus_backend.sql` and `0002_shopping_items.sql`. This release and candidate B require zero new migrations. Preserve D1 rows and all browser storage, including Shopping and Calendar records, outboxes, cursors, conflicts, and auth. Reload or refresh the PWA to update assets while keeping site data.

D1 Time Travel is a separate disaster recovery procedure and requires its own authorization. Keep production rollback manual and preserve the current D1 schema and state.
