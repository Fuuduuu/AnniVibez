import { isTokenHash } from "./crypto.js";

function requireTokenHash(value) {
  if (!isTokenHash(value)) throw new RangeError("Token hash must be canonical");
}

function boundStatement(db, sql, values) {
  return db.prepare(sql).bind(...values);
}

export async function findActiveSessionByHash(db, tokenHash) {
  requireTokenHash(tokenHash);

  const row = await boundStatement(
    db,
    `SELECT
       device_sessions.id AS session_id,
       users.id AS user_id,
       households.id AS household_id,
       users.role AS role
     FROM device_sessions
     JOIN users ON users.id = device_sessions.user_id
     JOIN households ON households.id = users.household_id
     WHERE device_sessions.token_hash = ?
       AND device_sessions.revoked_at IS NULL
       AND users.revoked_at IS NULL
     LIMIT 1`,
    [tokenHash],
  ).first();

  if (row === null) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    householdId: row.household_id,
    role: row.role,
  };
}

export async function findSessionMetadataByTrustedContext(db, trustedContext) {
  const { sessionId, userId, householdId } = trustedContext;
  const row = await boundStatement(
    db,
    `SELECT
       device_sessions.id AS session_id,
       device_sessions.device_name AS device_name,
       device_sessions.created_at AS session_created_at,
       device_sessions.last_seen_at AS last_seen_at,
       users.id AS user_id,
       users.name AS display_name,
       users.role AS role,
       households.id AS household_id,
       households.name AS household_name,
       households.address AS household_address,
       households.revision AS household_revision,
       households.created_at AS household_created_at,
       households.updated_at AS household_updated_at
     FROM device_sessions
     JOIN users ON users.id = device_sessions.user_id
     JOIN households ON households.id = users.household_id
     WHERE device_sessions.id = ?
       AND device_sessions.user_id = ?
       AND device_sessions.revoked_at IS NULL
       AND users.household_id = ?
       AND users.revoked_at IS NULL
     LIMIT 1`,
    [sessionId, userId, householdId],
  ).first();

  if (row === null) return null;
  return {
    session: {
      id: row.session_id,
      deviceName: row.device_name,
      createdAt: row.session_created_at,
      lastSeenAt: row.last_seen_at,
    },
    account: {
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
    },
    household: {
      id: row.household_id,
      name: row.household_name,
      address: row.household_address,
      revision: row.household_revision,
      createdAt: row.household_created_at,
      updatedAt: row.household_updated_at,
    },
  };
}

export async function insertHouseholdCreation(db, record) {
  requireTokenHash(record.tokenHash);
  requireTokenHash(record.recoveryHash);

  await db.batch([
    boundStatement(
      db,
      "INSERT INTO households (id, name, address, owner_member_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        record.householdId,
        record.householdName,
        record.householdAddress,
        record.ownerUserId,
        record.revision,
        record.createdAt,
        record.updatedAt,
      ],
    ),
    boundStatement(
      db,
      "INSERT INTO users (id, household_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)",
      [record.ownerUserId, record.householdId, record.userName, record.role, record.createdAt],
    ),
    boundStatement(
      db,
      "INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      [record.sessionId, record.ownerUserId, record.tokenHash, record.deviceName, record.createdAt, record.lastSeenAt],
    ),
    boundStatement(
      db,
      "INSERT INTO household_recovery (household_id, recovery_hash, created_at) VALUES (?, ?, ?)",
      [record.householdId, record.recoveryHash, record.createdAt],
    ),
  ]);
}
