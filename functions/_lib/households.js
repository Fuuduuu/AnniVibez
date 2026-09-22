import { hashSecret, newDeviceToken, newRecoveryCode } from "./crypto.js";
import { insertHouseholdCreation } from "./db.js";
import { validateCreateHouseholdInput } from "./http.js";
import { newId } from "./ids.js";

const CLOCK_ERROR = "Invalid household creation clock";
const RESULT_ERROR = "Invalid household creation result";
const CANONICAL_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DEVICE_TOKEN = /^m1s_[A-Za-z0-9_-]{43}$/;
const RECOVERY_CODE = /^m1r_[A-Za-z0-9_-]{43}$/;

function invalidClock() {
  return new Error(CLOCK_ERROR);
}

function requiredClockValue(clock) {
  if (typeof clock !== "function" || clock.length !== 0) throw invalidClock();
  const value = clock();
  if (typeof value !== "string" || !CANONICAL_UTC_INSTANT.test(value)) throw invalidClock();
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== value) throw invalidClock();
  return value;
}

function invalidResult() {
  return new Error(RESULT_ERROR);
}

function requireObject(value) {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw invalidResult();
  return value;
}

function requireString(value) {
  if (typeof value !== "string" || value.length === 0) throw invalidResult();
  return value;
}

function requireCanonicalInstant(value) {
  const instant = requireString(value);
  if (!CANONICAL_UTC_INSTANT.test(instant)) throw invalidResult();
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== instant) throw invalidResult();
  return instant;
}

function requireCreationResult(result) {
  const source = requireObject(result);
  const household = requireObject(source.household);
  const account = requireObject(source.account);
  const deviceSession = requireObject(source.deviceSession);
  const secrets = requireObject(source.secrets);
  const address = household.address;
  if (address !== null) requireString(address);
  if (!Number.isInteger(household.revision) || household.revision < 1) throw invalidResult();
  if (account.role !== "OWNER") throw invalidResult();
  const deviceToken = requireString(secrets.deviceToken);
  const recoveryCode = requireString(secrets.recoveryCode);
  if (!DEVICE_TOKEN.test(deviceToken) || !RECOVERY_CODE.test(recoveryCode)) throw invalidResult();

  return {
    household: {
      id: requireString(household.id),
      name: requireString(household.name),
      address,
      revision: household.revision,
      createdAt: requireCanonicalInstant(household.createdAt),
      updatedAt: requireCanonicalInstant(household.updatedAt),
    },
    account: {
      userId: requireString(account.userId),
      displayName: requireString(account.displayName),
      role: account.role,
    },
    deviceSession: {
      id: requireString(deviceSession.id),
      deviceName: requireString(deviceSession.deviceName),
      createdAt: requireCanonicalInstant(deviceSession.createdAt),
    },
    secrets: { deviceToken, recoveryCode },
  };
}

export async function createHousehold({ db, input, clock }) {
  const validation = validateCreateHouseholdInput(input);
  if (!validation.ok) return { ok: false, code: "INVALID_REQUEST" };

  const { userName, householdName, householdAddress, deviceName } = validation.value;
  const householdId = newId("hld");
  const ownerUserId = newId("usr");
  const sessionId = newId("ses");
  const deviceToken = newDeviceToken();
  const recoveryCode = newRecoveryCode();
  const createdAt = requiredClockValue(clock);
  const tokenHash = await hashSecret("device-session", deviceToken);
  const recoveryHash = await hashSecret("household-recovery", recoveryCode);
  const record = {
    householdId,
    householdName,
    householdAddress,
    ownerUserId,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    userName,
    role: "OWNER",
    sessionId,
    tokenHash,
    deviceName,
    lastSeenAt: createdAt,
    recoveryHash,
  };

  await insertHouseholdCreation(db, record);

  return {
    household: {
      id: householdId,
      name: householdName,
      address: householdAddress,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
    },
    account: {
      userId: ownerUserId,
      displayName: userName,
      role: "OWNER",
    },
    deviceSession: {
      id: sessionId,
      deviceName,
      createdAt,
    },
    secrets: { deviceToken, recoveryCode },
  };
}

export function publicHouseholdCreation(result) {
  const value = requireCreationResult(result);
  return {
    account: {
      userId: value.account.userId,
      displayName: value.account.displayName,
      role: value.account.role,
    },
    household: {
      id: value.household.id,
      name: value.household.name,
      address: value.household.address,
      revision: value.household.revision,
      createdAt: value.household.createdAt,
      updatedAt: value.household.updatedAt,
    },
    deviceSession: {
      id: value.deviceSession.id,
      deviceName: value.deviceSession.deviceName,
      createdAt: value.deviceSession.createdAt,
      token: value.secrets.deviceToken,
    },
    recovery: { code: value.secrets.recoveryCode },
  };
}
