# Majandus Common Backend Architecture v1

Status: accepted canonical specification. This document is architecture only; it does not by itself authorize backend implementation, Cloudflare resource creation, bindings, migrations, dependencies or deployment changes. Implementation requires separately approved scoped passes.

## 1. Decision and scope

Majandus v1 uses one shared backend foundation:

```text
Cloudflare Pages Functions
        +
Cloudflare D1
```

This is the selected v1 architecture. The existing Pages project and Pages Functions remain the application edge/API layer; D1 is the private household SQL and synchronization store. No separate Worker service is part of v1 unless implementation evidence proves a blocker.

The system remains local-first. A backend outage or loss of connectivity must not prevent normal local use of Majandus.

V1 supports exactly one private household per user and one household per account. A household has exactly one active OWNER and can contain multiple MEMBER users. Multi-household support is out of scope.

## 2. Non-goals

V1 does not add:

- email/password, phone, OAuth, Google or Apple login
- external auth providers
- realtime/WebSocket synchronization or a CRDT framework
- diary cloud synchronization or end-to-end encryption for shared data
- a separate Worker service, Durable Objects, Queues, R2 or another backend platform
- multi-household support, complex ACLs or unrelated frontend rewrites

## 3. Identity, membership and device access

The visible account model is intentionally minimal: a server `userId`, display name, role and household membership. Users enter a name; they do not create credentials in v1.

| Role | Shared-data access | Household administration |
|---|---|---|
| `OWNER` | Read and modify | Create/revoke invites, remove members, recover MEMBER access, revoke devices, manage household details and use household recovery |
| `MEMBER` | Read and modify | None |

Each device has a separate opaque device session. The client sends the token only as `Authorization: Bearer <device-token>`; the server stores only a cryptographic hash. A session contains `id`, `user_id`, `token_hash`, `device_name`, `created_at`, `last_seen_at` and `revoked_at`. JWTs and refresh tokens are not used in v1.

Protected request handling must first resolve `authenticateDevice(request)` into trusted `{ sessionId, userId, householdId, role }`. Business code derives household scope from this context. A client-supplied household ID never authorizes access.

## 4. Access and recovery flows

### Household creation

The first user supplies a name, household name and optional address. The server creates the household, OWNER user, first device session and a high-entropy household recovery code. The recovery code is shown only once; only its hash is stored.

### Joining a household

An OWNER creates an expiring, one-time, revocable `one_time_token` with purpose `INVITE` for one household. A join link has the form `/join/<token>`. The recipient supplies only a name. Successful use creates a MEMBER, membership and first device session, then atomically marks the token consumed.

### Adding a device

An authenticated device creates a short-lived, one-time `one_time_token` with purpose `DEVICE_LINK` for its existing user. A second device claims it and receives a new session for that same user; no additional MEMBER is created. QR presentation may be added later without changing this protocol.

### MEMBER recovery

An OWNER may create a short-lived, one-time `one_time_token` with purpose `MEMBER_RECOVERY` for an existing MEMBER. Claiming it creates a session for the existing user. The OWNER can revoke the member's existing sessions before or during recovery.

### OWNER recovery

The household recovery code identifies the OWNER household recovery path. On successful validation, the server creates a new OWNER device session, invalidates the old recovery code and creates a replacement code. Recovery-code rotation is mandatory after each successful recovery.

## 5. Sensitive-token security

Invite, device-link, MEMBER-recovery and household-recovery flows are security-sensitive. Their primary protection is not network rate limiting. Each uses high-entropy random tokens, server-side token hashing, short expiry where appropriate, one-time-use and explicit revocation or rotation.

The D1 write that changes a token's state must enforce the expected prior state, so concurrent use cannot consume a token twice. Sensitive flows return generic failures where a more specific response would enable enumeration. Application-level attempt/audit controls are used when justified.

Cloudflare Rate Limiting may reduce abuse, but it is not the security boundary: it is location-local, permissive and eventually consistent. It must not be the sole brute-force control for any sensitive token flow.

## 6. Server data boundary

Every synchronized record is scoped by `household_id`. Server data is private by default and protected endpoints require an active device session.

| Data | Storage model | Synchronizes |
|---|---|---|
| Household | `household` row | Yes |
| User and membership | `users` row, one household per user | Yes, as needed for membership UI |
| Device sessions | `device_sessions` rows | Device-private management metadata only |
| Temporary tokens and recovery material | `one_time_tokens` and recovery rows | No token material is synced |
| Calendar events | versioned `calendar_events.payload_json` | Yes |
| Waste configuration | versioned `waste_config.payload_json` | Yes |
| Shared places | normalized `shared_places` rows | Yes |
| Household-level settings/profile | versioned household payload/columns | Yes |
| Diary, saved ideas and saved tips | existing device-local storage | No |
| Notification permission and delivery preferences | existing device-local storage | No |

Calendar recurrence, overrides, exclusions and imported-event rules remain application-domain logic. V1 stores each calendar event domain object in `payload_json`; it does not decompose recurrence into a new relational occurrence model. Waste-generated events remain calendar events and are not duplicated in the waste configuration table.

## 7. Required D1 model

The implementation must create this model only in a later approved implementation pass:

```text
households(id, name, address, revision, created_at, updated_at)
users(id, household_id, name, role, created_at, revoked_at)
device_sessions(id, user_id, token_hash, device_name, created_at, last_seen_at, revoked_at)
one_time_tokens(id, household_id, subject_user_id, purpose, token_hash,
                created_by_user_id, created_at, expires_at, consumed_at,
                consumed_by_user_id, revoked_at)
household_recovery(household_id, recovery_hash, created_at, rotated_at)

calendar_events(id, household_id, payload_json, revision, created_at, updated_at, deleted_at)
waste_config(id, household_id, payload_json, revision, updated_at, deleted_at)
shared_places(id, household_id, name, address, lat, lon, revision, updated_at, deleted_at)

change_log(seq, household_id, entity_type, entity_id, revision, operation,
           changed_fields_json, changed_by, changed_at)
applied_mutations(mutation_id, household_id, result_json, created_at)
```

`one_time_tokens.purpose` is exactly one of `INVITE`, `DEVICE_LINK` or `MEMBER_RECOVERY`. `subject_user_id` is null only for `INVITE`; `DEVICE_LINK` and `MEMBER_RECOVERY` must target an existing non-revoked user in the same household. Consumption, revocation and expiry are mutually exclusive terminal states. Token use must atomically verify the correct purpose, active state and expiry before it changes the state.

The model must enforce unique session-token hashes, unique active one-time token consumption, unique `mutation_id` records and household scoping. It must preserve exactly one active OWNER per household: an OWNER cannot be removed, revoked or demoted unless the same transaction first assigns a non-revoked successor OWNER. V1 does not expose ownership transfer as a product flow. `seq` is the monotonically increasing cursor for one household's change stream. Synced entity IDs are client-generated permanent UUID-style values; array index and temporary server IDs are never sync identity.

## 8. Local replica and migration

Each device will hold a complete local replica of shared household data in IndexedDB database `majandus_local_v1`:

```text
meta, auth,
householdProfile, calendarEvents, sharedPlaces, wasteState,
outbox, syncState, conflicts
```

`auth` is device-private and never enters the household outbox. Local shared entities include server synchronization metadata: `id`, `payload`, `revision`, `updatedAt`, `deletedAt` and `syncStatus` (`synced`, `pending` or `conflict`). Server revision, not client time, is the concurrency authority.

Migration is copy-first and non-destructive. The current localStorage sources that need an explicit migration inventory are:

```text
majamajandus_household_events_v1
majamajandus_household_profile_v1
sade_saved_places
```

Reminder preferences (`majamajandus_reminder_preferences_v1`) and reminder delivery records (`majamajandus_reminder_delivery_v1`) remain device-local. Diary keys (`sade_diary_pin`, `sade_diary_entries`) also remain device-local. Existing localStorage is retained through initial migration for rollback; deletion needs a separate accepted cleanup pass.

Saved ideas (`annivibe_saved_ideas`) and saved tips (`sade_saved_tips`) are not classified as shared household data in v1 and remain device-local. Each migrated saved place receives a generated permanent UUID before it enters `sharedPlaces`; the current local array index is not an identity.

Migration sequence: inspect marker; read legacy data; validate with current domain validators; write the IndexedDB replica atomically; read back and validate; then record completion. Invalid or unreadable legacy data leaves sync disabled and legacy storage intact. It must never become an empty server upload.

## 9. Synchronization protocol

The UI reads local state first. A local edit and its outbox record are committed together where practical, so a reload or restart does not lose pending work.

An outbox item is:

```text
mutationId, entityType, entityId, operation, baseRevision, patch,
createdAt, attemptCount, lastAttemptAt
```

The server stores processed mutation IDs for all of v1. Retrying a mutation after a lost response returns its original result rather than applying the write again.

`syncState` holds `serverCursor`, `lastSuccessfulSyncAt`, `lastAttemptAt` and `bootstrapCompleted`. The cursor advances only after received server changes are committed locally. Only one sync execution may run on one device at a time.

Sync runs at application startup and foreground, after local mutation, on network restoration and manual retry. A lightweight foreground poll may run approximately every 30-60 seconds. Realtime transport is not required.

```text
if offline: stop
push persistent outbox
process each mutation result
pull delta after serverCursor
commit canonical changes locally
reapply still-pending local patches
advance cursor only after that commit succeeds
```

`GET /api/sync/bootstrap` returns complete household state plus current cursor for first setup, device recovery, explicit full resync or unrecoverable local state. `GET /api/sync/pull?after=<cursor>` returns deltas. `POST /api/sync/push` accepts a batch and reports each mutation independently, so one rejected or conflicting item does not discard unrelated work.

V1 performs no garbage collection or compaction of `change_log`, `applied_mutations` or tombstones. If a server cannot prove a cursor/history chain is complete, it returns `RESYNC_REQUIRED`; a client must bootstrap and reconcile pending mutations through the ordinary revision/conflict rules. It must never blind-merge or advance a cursor across missing history.

## 10. Concurrency, merging and deletion

Every mutation declares exactly one operation: `CREATE`, `UPDATE` or `DELETE`.

- `CREATE` uses a client-generated permanent entity ID and `baseRevision = 0`. The server requires that this ID has never existed for that household, including as a tombstone. It creates revision `1`, records the mutation result and appends the change-log entry atomically.
- `UPDATE` requires an existing, non-deleted entity and a positive `baseRevision`. If the base revision equals the current server revision, the server applies the field-level patch and increments the revision atomically. If the server has advanced, it compares the patch fields with all fields changed since `baseRevision`; only disjoint fields may auto-merge. Same-field overlap returns an explicit conflict. There is no last-write-wins path.
- `DELETE` requires an existing, non-deleted entity and a `baseRevision` equal to the current server revision. A stale delete returns conflict rather than merging or overwriting newer fields. A successful delete sets `deleted_at`, increments revision and appends a `DELETE` change-log entry atomically.

A conflict on one entity does not block unrelated synchronization. A later UI may offer "Kasuta minu varianti" or "Kasuta serveri varianti"; advanced conflict UI is not a prerequisite for the first sync implementation.

Clients consume tombstones and hide deleted entities from ordinary UI. Hard deletion, tombstone garbage collection, change-log compaction and applied-mutation cleanup are forbidden until a separate retention and compaction design is accepted.

## 11. API boundary

The planned Pages Functions API surface is:

```text
/api/auth/create-household
/api/auth/invite-info
/api/auth/join
/api/auth/device-link
/api/auth/claim-device
/api/auth/recover-member
/api/auth/recover-household
/api/auth/session
/api/auth/revoke-device

/api/household
/api/household/invite
/api/household/members

/api/sync/bootstrap
/api/sync/pull
/api/sync/push
```

Shared domains use the common sync API; no feature creates its own standalone synchronization protocol.

`POST /api/auth/invite-info` accepts an invite token before join acceptance and returns only the minimum safe display data needed to confirm the destination household, such as its name. Invalid, expired, revoked and consumed tokens receive the same generic failure response; the endpoint does not expose membership, OWNER or other household information.

## 12. First synchronization rules

For an existing installation, the user explicitly enables sync, migrates local shared data to IndexedDB, creates the household and uploads that local shared state as the initial OWNER baseline. The server must not overwrite it during setup.

A joining MEMBER bootstraps the existing household from the server. Unrelated old local Majandus data on that device must not merge automatically into the joined household; importing it requires a separate explicit design.

## 13. Implementation order and acceptance gate

Later implementation must be divided into narrow passes:

1. IndexedDB foundation and non-destructive migration with current UI behavior preserved.
2. D1 schema, Pages Functions helpers, token hashing, authentication middleware and household creation.
3. Invite, join, session, device-link, recovery and device revocation.
4. Outbox, bootstrap, push/pull, revisions, idempotency, change log and tombstones.
5. Calendar as the first shared domain.
6. Shared places, household profile and waste configuration.
7. Sync status, conflict resolution, member/device management and recovery UX.

No phase opens automatically. Each requires its own accepted scope, tests and review. The controlling acceptance principle is:

> Majandus remains fully usable locally when the backend is unavailable. Cloud synchronization enhances the local application; it never becomes a prerequisite for normal household use.
