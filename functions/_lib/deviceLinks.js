import { hashSecret, newDeviceLinkToken, newDeviceToken } from './crypto.js';
import { newId } from './ids.js';
import { findSessionMetadataByTrustedContext } from './db.js';

const LINK_TOKEN = /^m1l_[A-Za-z0-9_-]{43}$/;
const LINK_LIFETIME_MS = 10 * 60 * 1000;

export async function createDeviceLink({ db, context, clock }) {
  const createdAt = clock();
  const expiresAt = new Date(Date.parse(createdAt) + LINK_LIFETIME_MS).toISOString();
  const linkToken = newDeviceLinkToken();
  const tokenHash = await hashSecret('device-link', linkToken);
  // Recheck the trusted device/user inside the write, including revocation between auth and issuance.
  const result = await db.prepare(`INSERT INTO one_time_tokens
    (id, household_id, subject_user_id, purpose, token_hash, created_by_user_id, created_at, expires_at)
    SELECT ?, ?, ?, 'DEVICE_LINK', ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM device_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND u.household_id = ?
        AND s.revoked_at IS NULL AND u.revoked_at IS NULL)`)
    .bind(newId('ott'), context.householdId, context.userId, tokenHash, context.userId, createdAt, expiresAt,
      context.sessionId, context.userId, context.householdId).run();
  if (result.meta.changes === 0) return { ok: false, code: 'UNAUTHORIZED' };
  if (result.meta.changes !== 1) throw new Error('Unexpected device link insert');
  return { ok: true, linkToken, expiresAt };
}

export async function claimDeviceLink({ db, input, clock }) {
  if (!input || Array.isArray(input) || typeof input !== 'object'
      || Object.keys(input).length !== 2 || typeof input.linkToken !== 'string' || !LINK_TOKEN.test(input.linkToken)
      || typeof input.deviceName !== 'string') return { ok: false, code: 'INVALID_REQUEST' };
  const deviceName = input.deviceName.trim();
  if (!deviceName || Array.from(deviceName).length > 120) return { ok: false, code: 'INVALID_REQUEST' };

  const stamp = clock();
  const tokenHash = await hashSecret('device-link', input.linkToken);
  const sessionId = newId('ses');
  const token = newDeviceToken();
  const deviceHash = await hashSecret('device-session', token);
  // D1 batch is one transaction. changes() binds the INSERT to this batch's own successful UPDATE,
  // rather than a timestamp which could also match a concurrent/already completed claim.
  const [consumed, inserted] = await db.batch([
    db.prepare(`UPDATE one_time_tokens SET consumed_at = ?, consumed_by_user_id = subject_user_id
      WHERE token_hash = ? AND purpose = 'DEVICE_LINK'
        AND consumed_at IS NULL AND revoked_at IS NULL AND created_at <= ? AND expires_at > ?
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = one_time_tokens.subject_user_id
          AND u.household_id = one_time_tokens.household_id AND u.revoked_at IS NULL)
      RETURNING household_id, subject_user_id`).bind(stamp, tokenHash, stamp, stamp),
    db.prepare(`INSERT INTO device_sessions (id, user_id, token_hash, device_name, created_at, last_seen_at)
      SELECT ?, subject_user_id, ?, ?, ?, ? FROM one_time_tokens
      WHERE token_hash = ? AND changes() = 1 AND purpose = 'DEVICE_LINK'
        AND consumed_at = ? AND consumed_by_user_id = subject_user_id AND revoked_at IS NULL
      RETURNING id`).bind(sessionId, deviceHash, deviceName, stamp, stamp, tokenHash, stamp),
  ]);
  if (consumed.results.length === 0 && inserted.results.length === 0) return { ok: false, code: 'INVALID_DEVICE_LINK' };
  if (consumed.results.length !== 1 || inserted.results.length !== 1 || inserted.results[0].id !== sessionId) {
    throw new Error('Unexpected device claim result');
  }
  const subject = consumed.results[0];
  const metadata = await findSessionMetadataByTrustedContext(db, {
    sessionId, userId: subject.subject_user_id, householdId: subject.household_id,
  });
  if (!metadata) throw new Error('Claimed device metadata unavailable');
  return { ok: true, account: metadata.account, household: metadata.household,
    deviceSession: { id: metadata.session.id, deviceName: metadata.session.deviceName,
      createdAt: metadata.session.createdAt, token } };
}
