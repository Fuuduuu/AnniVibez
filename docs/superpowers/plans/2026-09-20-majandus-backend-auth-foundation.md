# Majandus Backend/Auth Foundation Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

Goal: Add a dormant Majandus server foundation: D1 schema, opaque device-session auth, household creation, and safe session inspection, without changing the accepted client runtime.

Architecture: Cloudflare Pages Functions are the only server compute surface and use one D1 binding named DB. Small modules isolate HTTP, IDs, Web Crypto, D1, auth, and household creation. Creation generates IDs and secrets before issuing one D1 batch transaction.

Tech Stack: Cloudflare Pages Functions, Cloudflare D1, Workers Web Crypto, ESM JavaScript, Node built-in test runner, Miniflare 3.20250718.3, Wrangler 4.135.0 for local-only D1 verification.

Spec: docs/COMMON_BACKEND_ARCHITECTURE_V1.md

## Global Constraints

- Preserve Pages Functions plus D1. Do not add a separate Worker service, Durable Objects, Queues, R2, or an external backend.
- Implement accepted architecture order item 2 only: schema, helpers, secure hashes, device-session middleware, household creation, and session inspection.
- Majandus remains local-first. Do not wire backend availability into calendar, household, places, waste, outbox, or storage-authority runtime.
- Do not modify src/storage/**, calendar runtime, household runtime, saved-place runtime, waste runtime, storage authority, or sync outbox behavior. The accepted C8 runtime provenance 9dac8c021be1b99bf7ec1227615cb6f3bd874674 is protected.
- Do not implement invite/join, device-link, member/owner recovery, device revocation UI, sync bootstrap/pull/push, outbox processing, conflict resolution, domain sync, or account-management UI.
- No task may create a D1 resource, bind Pages, change Pages settings, run a remote migration, deploy, or persist Cloudflare credentials. Task 10 records the later human gate only.
- Use Workers Web Crypto only. No password login, OAuth, JWT, refresh token, or external identity provider.
- Protected scope comes only from trusted { sessionId, userId, householdId, role }; client identity claims never authorize access.
- Error body is { error: { code, message } }, JSON plus Cache-Control: no-store; never expose SQL, stack, hash, or secret state.
- Begin and end each implementation task with clean status and empty staging. Every staging command must name paths.

## Accepted architecture-review amendments

These binding clarifications apply to Tasks 2-10 and override a narrower conflicting task description. They do not change the accepted Phase 1 schema or authorize runtime implementation, Cloudflare resources, remote operations, or deployment.

### Task 2: HTTP validation and server IDs

`newId(prefix)` remains generation-only. Its only allowed prefixes are `hld`, `usr`, and `ses`; it emits the corresponding prefixed `crypto.randomUUID()` identifier. Every other prefix value, including an unknown string, the empty string, `undefined`, `null`, and a non-string, MUST throw `RangeError`. There is no coercion, fallback prefix, fallback ID, or external ID validator. The human-readable error message is not contractual. Unsupported-prefix use is a server/programmer error, preventing accidental generation in an unapproved namespace rather than validating an externally supplied identifier.

`readJsonObject(request, options)` requires a JSON media type: `application/json`, optionally with `charset=utf-8`. Media-type and charset matching are case-insensitive. It rejects a missing Content-Type, another media type, and an unsupported charset with the existing safe `{ ok: false, code: "INVALID_REQUEST" }` result; no new public error code is introduced. It validates transport/input shape only, never authenticates a user or makes a client-supplied household, user, session, or role authoritative. Validation success is not authorization success.

The body cap is 8192 encoded bytes, not JavaScript character count. Content-Length may reject a clearly oversized request early, but is never the sole check. The reader accumulates at most 8192 bytes and rejects as soon as byte 8193 would be consumed, cancelling or releasing the reader as appropriate; it must not read the complete oversized body merely to measure it. Empty, malformed, and oversized bodies never silently become `{}`.

Every JSON response from `json(...)` and `apiError(...)` has `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`. Caller-supplied additional headers may be added, but cannot override or remove either invariant. `apiError(...)` still permits protocol headers such as `Allow` and later `WWW-Authenticate`.

### Task 3: token and hash contracts

`hashSecret(kind, secret)` supports only `device-session` and `household-recovery`; every other kind throws `RangeError` without coercion. It hashes the secret exactly as supplied: no trim, case conversion, Unicode normalization, or repair. The domain-separated input remains `majandus:v1:<kind>:<secret>`. Token generation remains Workers Web Crypto with 32 random bytes, unpadded base64url, `m1s_` for device sessions, and `m1r_` for recovery. This plan does not claim that a complete authentication request is constant-time.

### Tasks 4-6: repository, session, and creation boundaries

General SQL helpers such as `prepare` and `runBatch` may exist internally, but are not the public repository contract consumed by endpoints. Endpoints and services consume narrow operations only: active-session lookup by token hash, one atomic household-creation batch, and safe session metadata lookup/projection scoped from trusted session context. No endpoint may construct arbitrary SQL. The atomic household-creation batch is owned once by the repository/service boundary; individual inserts are not independently committed public operations. Preserve the ability to make a future domain mutation, its change_log entry, and applied_mutations record one atomic operation.

For Tasks 4-9, an active foundation session is present, has `device_sessions.revoked_at IS NULL`, and belongs to a user with `users.revoked_at IS NULL`. Foundation sessions are revoke-controlled, not expiry-controlled; this is acceptable only for local/synthetic foundation testing and does not approve indefinite production user sessions. `last_seen_at` is not authoritative device activity unless a later scope updates it. Before real user data, a separate accepted lifecycle/recovery scope must define server-enforced maximum lifetime or equivalent renewal, device revocation, lost-device recovery, and renewal/re-authentication behavior. Do not retrofit `expires_at` into Phase 1.

Credential failures—missing, malformed, unknown, revoked-session, revoked-user, and any future expired credential—share the safe `401 UNAUTHORIZED` response with `WWW-Authenticate: Bearer` and no cause disclosure. Infrastructure failures, including unavailable D1, a thrown D1 query, or an unexpected internal failure, are safe generic server failures and MUST NOT become 401.

The Phase 6 creation operation remains atomic but intentionally non-idempotent. Distinguish definitely rolled back, definitely committed with response delivered, and client-unknown result after a lost response/connection. Clients MUST NOT automatically retry an unknown-result create; household name/address is not a duplicate key; bootstrap creation does not use applied_mutations; and token/recovery plaintext must never enter applied_mutations.result_json. Tasks 6-9 are therefore controlled foundation testing only. Real-user onboarding remains blocked pending a separately accepted continuation/idempotency/recovery design.

### Tasks 7-8: Pages routing and session projection

Create-household routing must prove actual Pages behavior: `onRequestPost` handles POST and generic `onRequest` handles every method without a more-specific handler as safe 405 with `Allow: POST`. HEAD and OPTIONS are 405; no permissive CORS is added. Tests use a local Pages-router/integration path rather than calling `onRequestPost` with a fake GET.

Session routing follows the same pattern: `onRequestGet` handles GET and generic `onRequest` returns safe 405 with `Allow: GET` for every other method, including HEAD and OPTIONS. Its local tests prove actual Pages routing.

The session endpoint remains a minimal trusted projection containing at least `session.id`, `account.userId`, `account.role`, and `household.id`; accepted display metadata may remain only where its existing consumer contract requires it. It never exposes a bearer token, token hash, recovery code/hash, internal OWNER marker, SQL, stack trace, or a household selected by query/body. Any lookup is scoped solely from authenticated trusted context.

Task 7 may implement unauthenticated create-household locally, but that does not authorize public user onboarding. Before real-user creation is reachable, a separate publication/abuse-control decision is required; controlled technical deployment may use operator/environment restriction. Do not add a rate-limiting dependency to this foundation.

### Tasks 9-10: deployment and readiness gates

Tasks 2-9 retain the prohibition on remote D1 creation, Pages binding changes, remote migrations, deployment, Cloudflare credentials in the repository, GitHub deployment workflows, automatic Wrangler deploy commands, and Cloudflare configuration that silently enables external execution. Phase 9 remains integrated security regression, not the first security test: Tasks 2-8 retain focused negative/security tests, while Task 9 combines schema, HTTP boundary, crypto, repository scope, trusted authentication, atomicity, route behavior, secret non-leakage, and protected-runtime isolation.

Task 10 remains the external-execution stage, with three distinct gates. **10A — explicit remote-resource authorization** requires specific human approval for the Cloudflare account/project/environment, D1 creation, DB binding, and remote migration; it is not general deploy-everything authorization. **10B — controlled technical deployment** permits only isolated synthetic/non-user-data verification and must verify preview/production separation, DB binding target, real route-method behavior, response headers, no credential logging, and no client-runtime coupling; it is not user-ready. **10C — real-user-data gate** remains closed until separately accepted scopes provide lost-device/session revocation, recovery flow, safe client auth-token storage, bootstrap unknown-result/retry handling, recovery/rollback addressing restored credentials, and abuse/publication control. Tasks 1-10 can establish a technically deployable backend foundation without automatically making it ready for real user data.

The later live/readiness gate must treat D1 restoration/time-travel as an authentication-security event. Before reopening user traffic, verify whether restored state resurrected revoked device sessions, rotated/revoked recovery hashes, later one-time tokens, or sync cursor/history assumptions. This is operational recovery/readiness work, not Phase 2-9 code.

## Review Focus

1. Task 6 proves a failed D1 batch leaves no household, owner, session, or recovery row.
2. Tasks 3, 6, and 9 prove token/recovery plaintext is never stored or logged and is visible only in its one creation response.
3. Tasks 5, 7, and 8 prove client-supplied household/user/role values cannot select scope.
4. Task 5 proves malformed, unknown, revoked-session, and revoked-user credentials share one safe 401 result.
5. Tasks 1, 4, and 9 preserve household scoping, revisions, change_log, and applied_mutations needed for later idempotent sync.

---

## Locked file map and contracts

| Path | Responsibility | Producer | Consumers |
| --- | --- | --- | --- |
| migrations/0001_majandus_backend.sql | complete initial D1 schema | Task 1 | Tasks 4-9, later sync |
| functions/_lib/http.js | JSON/method/error/input helpers | Task 2 | Tasks 5, 7, 8 |
| functions/_lib/ids.js | server-only IDs | Task 2 | Task 6 |
| functions/_lib/crypto.js | tokens and deterministic hashes | Task 3 | Tasks 4-6 |
| functions/_lib/db.js | prepared statements and D1 batch only | Task 4 | Tasks 5-6 |
| functions/_lib/auth.js | bearer parse and trusted context | Task 5 | Task 8, later APIs |
| functions/_lib/households.js | atomic creation service | Task 6 | Task 7 |
| functions/api/auth/create-household.js | POST create-household | Task 7 | later client-auth scope |
| functions/api/auth/session.js | GET session | Task 8 | later client-auth scope |
| scripts/backend/*.test.mjs | Node/local-D1 evidence | Tasks 1-9 | task owner |
| scripts/backend/wrangler.test.jsonc | local-only synthetic DB binding | Task 1 | migration test |
| docs/MAJANDUS_BACKEND_AUTH_FOUNDATION_EXECUTION_GATE.md | operator authorization gate | Task 10 | human operator |

## API contract

POST /api/auth/create-household accepts exactly four JSON fields:

    {
      "userName": "Mari",
      "householdName": "Kase kodu",
      "householdAddress": "Näide 1, Rakvere",
      "deviceName": "Mari telefon"
    }

User name, household name, and device name are trimmed 1-80, 1-120, and 1-120 Unicode-code-point strings. Address is omitted/null or a trimmed 1-240-character string. Unknown fields are invalid, including userId, householdId, role, sessionId, revision, and all timestamps.

Success is 201 and exactly this shape:

    {
      "account": { "userId": "usr_...", "displayName": "Mari", "role": "OWNER" },
      "household": { "id": "hld_...", "name": "Kase kodu", "address": "Näide 1, Rakvere", "revision": 1, "createdAt": "...", "updatedAt": "..." },
      "deviceSession": { "id": "ses_...", "deviceName": "Mari telefon", "createdAt": "...", "token": "m1s_<base64url>" },
      "recovery": { "code": "m1r_<base64url>" }
    }

Token and recovery plaintext occur only in that one success response. A later client-auth scope may write the existing IndexedDB auth record { key: "deviceSession", sessionId, serverUserId, serverHouseholdId, role, deviceToken, createdAt }; it must never store recovery code, put auth in outbox, or make runtime depend on backend.

GET /api/auth/session authenticates first and returns only safe metadata:

    {
      "session": { "id": "ses_...", "deviceName": "Mari telefon", "createdAt": "...", "lastSeenAt": "..." },
      "account": { "userId": "usr_...", "displayName": "Mari", "role": "OWNER" },
      "household": { "id": "hld_...", "name": "Kase kodu", "address": "...", "revision": 1, "createdAt": "...", "updatedAt": "..." }
    }

Error codes are INVALID_REQUEST (400), UNAUTHORIZED (401), METHOD_NOT_ALLOWED (405), CONFLICT (409), and INTERNAL_ERROR (500). Missing, malformed, unknown, revoked-session, and revoked-user tokens get the same 401 envelope.

## D1 and token design

The one migration creates households, users, device_sessions, one_time_tokens, household_recovery, calendar_events, waste_config, shared_places, change_log, and applied_mutations. The deferred household-to-OWNER pointer deliberately forms the one household/user cycle; all other parent relationships use their ordinary restrictive ordering.

- households: id, name, address nullable, owner_member_id, constant owner_marker, revision, created_at, updated_at.
- users: id, household_id, name, role, created_at, revoked_at nullable, generated/stored owner_marker.
- device_sessions: id, user_id, token_hash, device_name, created_at, last_seen_at, revoked_at nullable.
- one_time_tokens: id, household_id, subject_user_id nullable, purpose, token_hash, created_by_user_id, created_at, expires_at, consumed_at nullable, consumed_by_user_id nullable, revoked_at nullable.
- household_recovery: household_id, recovery_hash, created_at, rotated_at nullable.
- calendar_events: id, household_id, payload_json, revision, created_at, updated_at, deleted_at nullable.
- waste_config: id, household_id, payload_json, revision, updated_at, deleted_at nullable.
- shared_places: id, household_id, name, address, lat, lon, revision, updated_at, deleted_at nullable.
- change_log: seq, household_id, entity_type, entity_id, revision, operation, changed_fields_json, changed_by, changed_at.
- applied_mutations: mutation_id, household_id, result_json, created_at.

- IDs are TEXT primary keys. households.revision starts at 1. Domain tables retain all canonical household IDs, payload/normalized fields, revisions, timestamps, and tombstones. households also has owner_member_id TEXT NOT NULL and owner_marker INTEGER NOT NULL DEFAULT 1 CHECK (owner_marker = 1).
- users has household_id, name, role CHECK OWNER/MEMBER, created_at, revoked_at, and a generated/stored owner_marker that is 1 only for a non-revoked OWNER and 0 otherwise. UNIQUE (household_id, id, owner_marker) supplies the parent key for a deferred composite foreign key from (households.id, households.owner_member_id, households.owner_marker) to users(household_id, id, owner_marker). The partial unique active-OWNER index remains: it enforces at most one active OWNER, while the mandatory valid owner pointer enforces at least one. Together they enforce exactly one active OWNER per persisted household. The pointer FK is DEFERRABLE INITIALLY DEFERRED because household creation forms a household-to-OWNER-to-household cycle that must resolve in one D1 batch. Direct SQL cannot leave a sole OWNER revoked, demoted or deleted, or leave the pointer null, dangling or cross-household.
- device_sessions has unique fixed lowercase-hex token_hash, restrictive user foreign key, device_name, created_at, last_seen_at, revoked_at.
- one_time_tokens has every canonical column, purpose check INVITE/DEVICE_LINK/MEMBER_RECOVERY, unique token hash, null subject only for INVITE, a check that consumed_at/revoked_at cannot both be non-null, and same-household subject/creator/consumer triggers. Active-token indexes support a future atomic expected-state consumption update requiring correct purpose, no consumed/revoked state, and unexpired expires_at. This slice does not issue or consume a one-time token.
- household_recovery is one row per household, containing recovery_hash, created_at, rotated_at only; recovery_hash is globally UNIQUE as well as NOT NULL and canonical lowercase-hex.
- Calendar/waste/places have household foreign keys; a partial unique index permits one active waste_config per household. change_log has a household_id, seq index; applied_mutations has unique mutation_id. Neither table is written this slice, but both are created now for later sync without redesign.
- Foreign keys are restrictive. Tests prove orphan insert failure and empty PRAGMA foreign_key_check.

Each secret is crypto.getRandomValues(new Uint8Array(32)): 256 bits. Wire form is m1s_ or m1r_ plus 43-character unpadded base64url. hashSecret(kind, token) returns lowercase-hex SHA-256 of UTF-8 majandus:v1:<kind>:<token>. The domain separator prevents cross-class matches. Deterministic SHA-256 is appropriate for uniformly random 256-bit bearer secrets and indexed lookup, unlike human passwords. No plaintext comparison remains after the hash lookup, so constant-time equality is not applicable.

createHousehold prepares values, then calls DB.batch in this order: household row containing the future OWNER member id, OWNER user row, device-session/token row, and recovery row. The household owner-pointer FK is deferred; all ordinary parent FKs remain restrictive. D1 documents batch as a transaction that rolls back the entire sequence on a failed statement, so the cycle must be resolved by batch completion or no partial household is persisted. Do not use manual BEGIN/COMMIT or an assumed transaction API.

Task 1 local configuration is local test input only: binding DB, database name majandus-backend-test, synthetic UUID 00000000-0000-0000-0000-000000000001. It is not production configuration. Its only state directory is .tmp/majandus-d1-test.

A later explicit operator scope must separately create one D1 resource majandus-backend-v1, bind it to Pages as DB, record its real ID safely, apply the migration remotely, verify it, and deploy. This plan authorizes none.

## Tasks

### Task 1: D1 migration and executable schema contract

**Files:**
- Create: migrations/0001_majandus_backend.sql
- Create: scripts/backend/wrangler.test.jsonc
- Create: scripts/backend/migration-contract.test.mjs
- Modify: package.json
- Modify: package-lock.json

**Interfaces:**
- Consumes: canonical D1 model and binding DB.
- Produces: full migration; freshMigratedDb() Miniflare D1 fixture; and Wrangler local-migration verification.

- [ ] **Step 1: Write the failing test**

Assert sqlite_master, PRAGMA table_info, PRAGMA index_list, PRAGMA foreign_key_list, and PRAGMA foreign_key_check prove all tables, columns, indexes, and foreign keys. The schema contract must cover: valid atomic household plus OWNER creation; ownerless household rejection; second active OWNER rejection; sole-OWNER revocation, demotion, and deletion rejection; cross-household, null, missing, and dangling owner-pointer rejection; successful atomic ownership transfer; adversarial direct SQL resistance; failed deferred-FK batch rollback with no partial household; clean PRAGMA foreign_key_check after valid operations; duplicate recovery-hash rejection across households; and acceptance of different valid recovery hashes.

    test("migration applies and enforces owner and FK invariants", async () => {
      const db = await freshMigratedDb();
      assert.deepEqual(await tableNames(db), REQUIRED_TABLES);
      await assert.rejects(() => db.prepare(ORPHAN_SESSION_SQL).run());
      await assert.rejects(() => db.batch([ownerOne, ownerTwo]));
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/migration-contract.test.mjs

Expected: FAIL because migration, configuration, and fixture are absent.

- [ ] **Step 3: Implement minimal complete schema**

Add dev dependencies miniflare 3.20250718.3 and wrangler 4.135.0. Implement one migration with every table/check/index/trigger above, including the constant household owner marker, generated user owner marker, composite UNIQUE parent key, deferred composite household-to-OWNER FK, retained partial active-OWNER uniqueness, and global recovery-hash uniqueness. It uses ordinary CREATE statements, because Wrangler records and applies each numbered migration once rather than silently masking a partial schema. freshMigratedDb() constructs a Miniflare instance with a D1 binding named DB, executes the migration SQL with its D1 database, and returns that D1Database to the Node tests. Separately, the migration-contract test runs:

    node_modules/.bin/wrangler d1 migrations apply majandus-backend-test --local --config scripts/backend/wrangler.test.jsonc --persist-to .tmp/majandus-d1-test

It deletes only the exact .tmp/majandus-d1-test directory before a run.

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/migration-contract.test.mjs

Expected: PASS; empty local D1 migrates and rejects invalid foreign-key/owner states.

Run: node_modules/.bin/wrangler d1 migrations list majandus-backend-test --local --config scripts/backend/wrangler.test.jsonc --persist-to .tmp/majandus-d1-test

Expected: 0001_majandus_backend.sql is applied locally; no remote flag.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- migrations/0001_majandus_backend.sql scripts/backend/wrangler.test.jsonc scripts/backend/migration-contract.test.mjs package.json package-lock.json && git commit -m "feat: add majandus d1 schema"

Expected: only the five named files are committed.

### Task 2: HTTP validation and server IDs

**Files:**
- Create: functions/_lib/http.js
- Create: functions/_lib/ids.js
- Create: scripts/backend/http-ids.test.mjs

**Interfaces:**
- Consumes: Workers Request, Response, crypto.randomUUID.
- Produces: json(status, body), apiError(status, code, message, headers), requireMethod(request, method), readJsonObject(request, options), validateCreateHouseholdInput(value), newId(prefix).

- [ ] **Step 1: Write the failing test**

Cover invalid JSON/array/null body, over-8-KiB body, unknown field, required/overlong string, valid/null optional address, 405 Allow, no-store header, and ID prefixes.

    test("authority fields fail before handler access", () => {
      assert.deepEqual(validateCreateHouseholdInput({ ...VALID_INPUT, householdId: "forged" }),
        { ok: false, code: "INVALID_REQUEST" });
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/http-ids.test.mjs

Expected: FAIL with missing exports.

- [ ] **Step 3: Implement minimal helpers**

Check declared and encoded body size. Parsing returns only { ok: true, value } or { ok: false, code: "INVALID_REQUEST" }; raw parser details never escape. newId emits prefixed crypto.randomUUID identifiers only for hld, usr, ses and follows the binding allowed-prefix/RangeError contract above.

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/http-ids.test.mjs

Expected: PASS; no request value becomes server identity.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- functions/_lib/http.js functions/_lib/ids.js scripts/backend/http-ids.test.mjs && git commit -m "feat: add majandus backend http primitives"

Expected: only the three named files are committed.

### Task 3: Opaque token and hash primitives

**Files:**
- Create: functions/_lib/crypto.js
- Create: scripts/backend/crypto.test.mjs

**Interfaces:**
- Consumes: crypto.getRandomValues, crypto.subtle.digest, TextEncoder.
- Produces: newDeviceToken(), newRecoveryCode(), hashSecret(kind, secret), isTokenHash(value).

- [ ] **Step 1: Write the failing test**

Assert format, 256-bit entropy, deterministic same-token hash, changed-token/kind hash, 64 lowercase hex, and no companion hash in returned credentials.

    test("device token has 256-bit secret and domain-separated hash", async () => {
      const token = newDeviceToken();
      assert.match(token, /^m1s_[A-Za-z0-9_-]{43}$/);
      assert.equal(await hashSecret("device-session", token), await hashSecret("device-session", token));
      assert.notEqual(await hashSecret("device-session", token), await hashSecret("household-recovery", token));
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/crypto.test.mjs

Expected: FAIL because crypto module is absent.

- [ ] **Step 3: Implement minimal Workers Web Crypto**

Generate 32 bytes, base64url encode without padding, prefix by kind, and SHA-256 domain-separated input to lowercase hex. Validate DB hash format before lookup. Add no logging, JWT, refresh token, salt table, or password KDF.

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/crypto.test.mjs

Expected: PASS; test double records exactly 32 random bytes and source guard finds no credential logging.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- functions/_lib/crypto.js scripts/backend/crypto.test.mjs && git commit -m "feat: add majandus token hashing"

Expected: only the two named files are committed.

### Task 4: D1 repository primitives

**Files:**
- Create: functions/_lib/db.js
- Create: scripts/backend/db.test.mjs

**Interfaces:**
- Consumes: D1Database and hashSecret.
- Produces: prepare(db, sql, values), runBatch(db, statements), findActiveSessionByHash(db, hash), insertHouseholdCreation(db, record), toPublicSessionRow(row).

- [ ] **Step 1: Write the failing test**

Use recording D1 fake and local D1 fixture. Verify all values bind rather than interpolate, lookup joins active session/user/household only, one batch call, and public projection excludes hash/secrets.

    test("revoked user cannot resolve session", async () => {
      await seedSession(db, { sessionRevokedAt: null, userRevokedAt: "2026-09-20T00:00:00.000Z" });
      assert.equal(await findActiveSessionByHash(db, HASH), null);
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/db.test.mjs

Expected: FAIL with missing repository exports.

- [ ] **Step 3: Implement database boundary**

Keep only prepared statements and D1 batch. Lookup joins device_sessions, users, households and requires both revoked_at values null. It returns null or safe session/user/household metadata. Creation binds four parent-first inserts and calls one batch.

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/db.test.mjs

Expected: PASS; no secret reaches a public shape.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- functions/_lib/db.js scripts/backend/db.test.mjs && git commit -m "feat: add majandus d1 repositories"

Expected: only the two named files are committed.

### Task 5: Device-session authentication middleware

**Files:**
- Create: functions/_lib/auth.js
- Create: scripts/backend/auth.test.mjs

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces: parseBearerToken(request), authenticateDevice(request, db), requireAuthenticated(request, db); success is exactly { sessionId, userId, householdId, role }.

- [ ] **Step 1: Write the failing test**

Test absent/multiple/malformed header, malformed token, unknown token, revoked session/user, and valid token. Every rejection has equal 401 code/message; syntax invalidity performs no lookup.

    test("valid token yields only trusted context", async () => {
      assert.deepEqual(await authenticateDevice(requestWith(TOKEN), db),
        { sessionId: "ses_1", userId: "usr_1", householdId: "hld_1", role: "OWNER" });
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/auth.test.mjs

Expected: FAIL because middleware is absent.

- [ ] **Step 3: Implement middleware**

Accept exactly one Bearer m1s secret, hash it as device-session, use Task 4 lookup, return the four trusted fields. requireAuthenticated maps every credential failure to apiError(401, "UNAUTHORIZED", "Authentication required.").

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/auth.test.mjs

Expected: PASS; no enumeration and no client scope selection.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- functions/_lib/auth.js scripts/backend/auth.test.mjs && git commit -m "feat: add majandus device authentication"

Expected: only the two named files are committed.

### Task 6: Atomic household-creation service

**Files:**
- Create: functions/_lib/households.js
- Create: scripts/backend/households.test.mjs

**Interfaces:**
- Consumes: Task 2 validation/IDs, Task 3 secrets, Task 4 batch insertion.
- Produces: createHousehold({ db, input, clock }) and publicHouseholdCreation(result).

- [ ] **Step 1: Write the failing test**

Use local D1 success and injected fourth-batch failure. Assert one household, exactly one active OWNER, a matching owner pointer, one session, one recovery row, optional address, no plaintext DB secrets, and no partial state on invalid/failing creation. The successful batch order is household row with future OWNER id, OWNER user, session/token row, recovery row; the owner-pointer FK is deferred and the remaining parent FKs remain restrictive.

    test("failed fourth statement leaves no partial household", async () => {
      const before = await creationCounts(db);
      await assert.rejects(() => createHousehold({ db: failingBatchDb(db, 4), input: VALID_INPUT, clock }));
      assert.deepEqual(await creationCounts(db), before);
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/households.test.mjs

Expected: FAIL because service is absent.

- [ ] **Step 3: Implement one-batch creation**

Generate IDs/secrets once, derive hashes, take one ISO time, set household revision 1, and execute the four inserts in the specified owner-pointer-safe order. Return public contract only after batch resolves. D1 failure becomes a private service error. Do not write change_log or applied_mutations.

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/households.test.mjs

Expected: PASS; D1 proves atomicity and owner invariant.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- functions/_lib/households.js scripts/backend/households.test.mjs && git commit -m "feat: add majandus household creation"

Expected: only the two named files are committed.

### Task 7: Create-household Pages Function

**Files:**
- Create: functions/api/auth/create-household.js
- Create: scripts/backend/create-household-api.test.mjs

**Interfaces:**
- Consumes: Tasks 2 and 6.
- Produces: onRequestPost({ request, env }) at /api/auth/create-household.

- [ ] **Step 1: Write the failing test**

Cover 201, 405 Allow POST, bad JSON/body, missing/oversized fields, forged identity fields, optional address, missing binding/D1 failure, and response secret redaction.

    test("forged role and household fail input validation", async () => {
      const response = await onRequestPost(contextWithBody({ ...VALID_INPUT, role: "OWNER", householdId: "hld_other" }));
      assert.equal(response.status, 400);
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/create-household-api.test.mjs

Expected: FAIL because route is absent.

- [ ] **Step 3: Implement transport adapter**

Require env.DB, validate exact JSON, call Task 6 once, and use no-store JSON. Map input to 400, valid service conflict to 409, missing binding/unexpected D1 to generic 500. Never log request or credentials.

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/create-household-api.test.mjs

Expected: PASS; only 201 includes initial token/recovery plaintext.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- functions/api/auth/create-household.js scripts/backend/create-household-api.test.mjs && git commit -m "feat: add household creation endpoint"

Expected: only the two named files are committed.

### Task 8: Authenticated session Pages Function

**Files:**
- Create: functions/api/auth/session.js
- Create: scripts/backend/session-api.test.mjs

**Interfaces:**
- Consumes: Tasks 2, 4, 5.
- Produces: onRequestGet({ request, env }) at /api/auth/session.

- [ ] **Step 1: Write the failing test**

Cover valid metadata, bad/unknown/revoked credential, revoked user, wrong method, forged household/role query fields, and scan body for token/hash/recovery/SQL/stack leaks.

    test("query household cannot alter trusted household", async () => {
      const response = await onRequestGet(contextFor("/api/auth/session?householdId=hld_other", VALID_TOKEN));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).household.id, "hld_trusted");
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/session-api.test.mjs

Expected: FAIL because route is absent.

- [ ] **Step 3: Implement trusted projection**

Require GET and env.DB; authenticate before response selection; return only contract safe fields. No household selector is accepted and no fallback trusts client data.

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/session-api.test.mjs

Expected: PASS; valid context is trusted and all bad credentials return safe 401.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- functions/api/auth/session.js scripts/backend/session-api.test.mjs && git commit -m "feat: add majandus session endpoint"

Expected: only the two named files are committed.

### Task 9: Local-D1 security regression

**Files:**
- Create: scripts/backend/foundation-integration.test.mjs
- Modify: scripts/backend/migration-contract.test.mjs
- Modify: scripts/backend/crypto.test.mjs
- Modify: scripts/backend/auth.test.mjs
- Modify: scripts/backend/households.test.mjs

**Interfaces:**
- Consumes: Tasks 1-8 and local D1 fixture.
- Produces: one full regression command and protected-runtime source guard.

- [ ] **Step 1: Write the failing test**

Create household via function, read session via returned token, inspect D1, inject batch failure, prove future sync tables are present but empty, and reject changed src/storage paths/imports.

    test("round trip preserves credentials and dormant runtime", async () => {
      const created = await createViaFunction(db, VALID_INPUT);
      const session = await readSessionViaFunction(db, created.deviceSession.token);
      assert.equal(session.household.id, created.household.id);
      assert.equal(await hasPlaintextSecret(db, created.deviceSession.token), false);
      assert.equal(await hasPlaintextSecret(db, created.recovery.code), false);
      assert.equal(await sourceTouchesProtectedStorage(), false);
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/foundation-integration.test.mjs

Expected: FAIL until all previous interfaces connect.

- [ ] **Step 3: Add test-only integration wiring**

Use same local fixture, fixed clock, env.DB fake. Add no production behavior. Source guard compares changed paths with Task 1 baseline and rejects every src/storage path or runtime import.

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/migration-contract.test.mjs scripts/backend/http-ids.test.mjs scripts/backend/crypto.test.mjs scripts/backend/db.test.mjs scripts/backend/auth.test.mjs scripts/backend/households.test.mjs scripts/backend/create-household-api.test.mjs scripts/backend/session-api.test.mjs scripts/backend/foundation-integration.test.mjs

Expected: PASS; schema, hashes, trusted context, atomicity, API, and runtime-isolation pass.

Run: npm run build && git diff --check

Expected: PASS; no accepted client-runtime regression.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- scripts/backend/foundation-integration.test.mjs scripts/backend/migration-contract.test.mjs scripts/backend/crypto.test.mjs scripts/backend/auth.test.mjs scripts/backend/households.test.mjs && git commit -m "test: cover majandus backend foundation"

Expected: only the five named test files are committed.

### Task 10: Deployment-readiness documentation and human gate

**Files:**
- Create: docs/MAJANDUS_BACKEND_AUTH_FOUNDATION_EXECUTION_GATE.md
- Modify: scripts/backend/foundation-integration.test.mjs

**Interfaces:**
- Consumes: DB binding, migration path, Task 9 evidence, Pages containment policy.
- Produces: explicit separation of repo/local D1 from resource, binding, remote migration, deployment, and human smoke.

- [ ] **Step 1: Write the failing test**

    test("gate requires explicit authorization for external actions", async () => {
      const gate = await readFile("docs/MAJANDUS_BACKEND_AUTH_FOUNDATION_EXECUTION_GATE.md", "utf8");
      for (const action of ["create D1 database", "bind DB", "apply remote migration", "deploy"]) {
        assert.match(gate, new RegExp(action + "[\\s\\S]*explicit authorization", "i"));
      }
    });

- [ ] **Step 2: Verify RED**

Run: node --test scripts/backend/foundation-integration.test.mjs

Expected: FAIL because gate document is absent.

- [ ] **Step 3: Write gate document**

Separate repository/local test evidence from later explicit actions: create majandus-backend-v1, bind DB, add production config only if needed, apply remote migration, deploy, and human/backend smoke. Preserve production_deployments_enabled false; do not add client integration.

- [ ] **Step 4: Verify GREEN**

Run: node --test scripts/backend/foundation-integration.test.mjs && git diff --check

Expected: PASS; external authority is unambiguous.

- [ ] **Step 5: Exact staging and commit**

Run: git add -- docs/MAJANDUS_BACKEND_AUTH_FOUNDATION_EXECUTION_GATE.md scripts/backend/foundation-integration.test.mjs && git commit -m "docs: add backend execution gate"

Expected: only the two named files are committed.

## Implementation self-review before an execution scope opens

1. Run a case-insensitive unfinished-marker and vague-handling scan, excluding its command line; resolve every production/test hit.
2. Confirm every listed interface has one producer and only listed consumers.
3. Reconcile all in-scope requirements to Tasks 1-10: schema, DB boundary, Web Crypto, trusted auth, atomicity, owner invariant, error contract, and local test.
4. Confirm no invite/recovery/sync/client-storage/external-resource behavior leaks into an implementation task.
5. Confirm Task 9 source guard finds no src/storage/** or runtime changes.
6. Run Task 9 combined tests, npm run build, and git diff --check.

## Out of scope

- Invite/join, device link, member/owner recovery, recovery rotation endpoint, revocation/UI, and member management.
- Sync/bootstrap/pull/push, outbox processing, change-log writes, applied-mutation handling, conflicts, tombstones, calendar/places/waste/profile sync.
- Client auth storage implementation, React/UI wiring, or backend dependence for Majandus local operation.
- D1 creation, Pages binding/settings, remote migration, secret change, preview/production deployment.

## Completion gate for this planning pass

Only this file may change in the present docs-only pass. Inspect exact diff, perform self-review, then:

    git add -- docs/superpowers/plans/2026-09-20-majandus-backend-auth-foundation.md
    git commit -m "docs: plan majandus backend auth foundation"
    git push origin main

After push require HEAD equals origin/main, clean worktree, and empty staging. Human review of this plan is the next safe action; it does not authorize implementation or external Cloudflare work.
