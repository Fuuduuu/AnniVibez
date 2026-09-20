import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as cryptoHelpers from "../../functions/_lib/crypto.js";

const {
  hashSecret,
  isTokenHash,
  newDeviceToken,
  newRecoveryCode,
} = cryptoHelpers;

const DEVICE_VECTOR_SECRET = "m1s_fixed-secret";
const DEVICE_VECTOR_HASH = "9a2af2b778f025c779497a11905ef9c625fdce23d5d983eaaf3eaad451bb31f7";
const RECOVERY_VECTOR_SECRET = "m1r_fixed-recovery";
const RECOVERY_VECTOR_HASH = "1ed51c96dd20ccc0c16c2233a1da703476ffddc6cb8afa0e781fc20c16d2cc72";
const URL_SAFE_BYTES = Uint8Array.from([
  0xfb, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const URL_SAFE_DEVICE_TOKEN = "m1s_-___AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const URL_SAFE_RECOVERY_CODE = "m1r_-___AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function assertTokenShape(value, prefix) {
  assert.match(value, new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`));
  assert.equal(value.includes("="), false);
}

test("newDeviceToken and newRecoveryCode create separate unpadded base64url secrets", () => {
  const firstDeviceToken = newDeviceToken();
  const secondDeviceToken = newDeviceToken();
  const recoveryCode = newRecoveryCode();

  assertTokenShape(firstDeviceToken, "m1s_");
  assertTokenShape(secondDeviceToken, "m1s_");
  assertTokenShape(recoveryCode, "m1r_");
  assert.notEqual(firstDeviceToken, secondDeviceToken);
  assert.notEqual(firstDeviceToken.slice(4), recoveryCode.slice(4));
});

test("newDeviceToken and newRecoveryCode request exactly 32 random bytes", () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const originalCrypto = globalThis.crypto;
  const lengths = [];
  let callCount = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes) {
        lengths.push(bytes.byteLength);
        callCount += 1;
        bytes.fill(callCount);
        return bytes;
      },
      subtle: originalCrypto.subtle,
    },
  });
  try {
    const deviceToken = newDeviceToken();
    const recoveryCode = newRecoveryCode();
    assert.deepEqual(lengths, [32, 32]);
    assert.notEqual(deviceToken.slice(4), recoveryCode.slice(4));
  } finally {
    Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
  }
});

test("newDeviceToken and newRecoveryCode substitute Base64 plus and slash deterministically", () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes) {
        assert.equal(bytes.byteLength, 32);
        bytes.set(URL_SAFE_BYTES);
        return bytes;
      },
      subtle: originalCrypto.subtle,
    },
  });
  try {
    assert.equal(newDeviceToken(), URL_SAFE_DEVICE_TOKEN);
    assert.equal(newRecoveryCode(), URL_SAFE_RECOVERY_CODE);
  } finally {
    Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
  }
});

test("hashSecret returns independently known SHA-256 vectors for both domains", async () => {
  assert.equal(await hashSecret("device-session", DEVICE_VECTOR_SECRET), DEVICE_VECTOR_HASH);
  assert.equal(await hashSecret("household-recovery", RECOVERY_VECTOR_SECRET), RECOVERY_VECTOR_HASH);
});

test("hashSecret domain-separates and preserves exact secret strings", async () => {
  const secret = "Secret";
  assert.notEqual(
    await hashSecret("device-session", secret),
    await hashSecret("household-recovery", secret),
  );
  assert.notEqual(await hashSecret("device-session", " secret"), await hashSecret("device-session", "secret"));
  assert.notEqual(await hashSecret("device-session", "secret "), await hashSecret("device-session", "secret"));
  assert.notEqual(await hashSecret("device-session", "SECRET"), await hashSecret("device-session", "secret"));
});

test("hashSecret rejects unsupported kinds without coercion", async () => {
  for (const kind of ["other", "", undefined, null, 1, {}]) {
    await assert.rejects(hashSecret(kind, "secret"), RangeError);
  }
});

test("isTokenHash accepts only canonical lowercase SHA-256 representations", () => {
  const validHash = "0123456789abcdef".repeat(4);
  assert.equal(validHash.length, 64);
  assert.equal(isTokenHash(validHash), true);
  for (const value of [
    validHash.slice(0, 63),
    `${validHash}0`,
    validHash.toUpperCase(),
    `${validHash.slice(0, 63)}g`,
    "",
    null,
    undefined,
    1,
    {},
  ]) {
    assert.equal(isTokenHash(value), false);
  }
});

test("crypto module exports only Phase 3 APIs and has no secret-handling side effects", () => {
  assert.deepEqual(Object.keys(cryptoHelpers).sort(), [
    "hashSecret",
    "isTokenHash",
    "newDeviceToken",
    "newRecoveryCode",
  ]);
  const source = readFileSync(new URL("../../functions/_lib/crypto.js", import.meta.url), "utf8");
  for (const forbidden of [/console\.(log|error)/, /\bfetch\b/, /\bAuthorization\b/, /\bD1\b/i, /\bSQL\b/i]) {
    assert.doesNotMatch(source, forbidden);
  }
});
