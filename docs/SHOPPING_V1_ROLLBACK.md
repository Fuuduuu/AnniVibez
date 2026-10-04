# Shopping V1 emergency rollback

## Never downgrade a device's schema

After Shopping V1 opens on a device, `majandus_local_v1` is IndexedDB **version 2**. Never roll production back by:

- selecting Cloudflare Pages rollback to the old pre-Shopping deployment;
- deploying plain commit `4c3c8a4a716b5e7c97a266115aa4d62e9df04fb5`;
- reverting Shopping in a way that restores `DB_VERSION = 1`.

These actions can cause `IndexedDB VersionError` / reload-required on upgraded devices. Do not delete browser storage to bypass the error.

## Build the compatible rollback application

The safe emergency candidate is exactly:

- old application tree: `4c3c8a4a716b5e7c97a266115aa4d62e9df04fb5`;
- **only** `src/storage/schema.js` replaced with the Shopping v2-compatible file from `8187699342026496facf24c2c51adddfed3f09c7`.

Schema SHA256: `ce4bcda42ef77181ddc6db495ec3bd4275677c89634a12ed6000aea010a04e17`.

1. Create a clean, separate worktree at the old application commit.
2. Copy only the schema file from the exact Shopping commit above, preserving its bytes. Keep `DB_VERSION = 2` and all ten stores, including `shoppingItems`.
3. Require `git diff --name-only` to show only `src/storage/schema.js`, verify its SHA256, and run `git diff --check`.
4. Build with `npm run build` in default forward mode (`VITE_STORAGE_AUTHORITY_MODE` unset). Require build PASS.
5. After separate human authorization, make a **new manual production deployment** of this compatible build to Pages project `majandus`. Automatic production deployments are disabled; neither a Git push nor Pages rollback to the old deployment is the safe rollback procedure.

Accepted local Chromium proof: v1 -> v2 -> compatible rollback open PASS; Calendar PASS; auth PASS; calendar outbox/conflicts PASS; reload stays `READY`; no storage deletion. The additional local Shopping store is retained and ignored by the old application.

## Preserve server and local Shopping data

Leave the production D1 schema in place. **Do not drop `shopping_items` or normally roll back migration `0002_shopping_items.sql`.** Old application code safely ignores the additional server table.

Keep Shopping server rows and local records, pending mutations, cursors and conflicts. They remain preserved and can resume when the Shopping feature returns. Do not clear IndexedDB or sync stores during rollback.

D1 Time Travel restore is disaster recovery only, **not normal application rollback**. This runbook authorizes no deployment, migration, schema change, data cleanup or restore.
