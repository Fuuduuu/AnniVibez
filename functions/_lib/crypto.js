const SECRET_BYTE_LENGTH = 32;
const HASH_KINDS = new Set(["device-session", "household-recovery"]);

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function newSecret(prefix) {
  return `${prefix}${base64url(crypto.getRandomValues(new Uint8Array(SECRET_BYTE_LENGTH)))}`;
}

export function newDeviceToken() {
  return newSecret("m1s_");
}

export function newRecoveryCode() {
  return newSecret("m1r_");
}

export async function hashSecret(kind, secret) {
  if (!HASH_KINDS.has(kind)) throw new RangeError("Unsupported hash kind");
  const input = new TextEncoder().encode(`majandus:v1:${kind}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isTokenHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
