import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  apiError,
  json,
  readJsonObject,
  requireMethod,
  validateCreateHouseholdInput,
} from "../../functions/_lib/http.js";
import * as ids from "../../functions/_lib/ids.js";

const { newId } = ids;
const encoder = new TextEncoder();
const validInput = {
  userName: "Mari",
  householdName: "Kase kodu",
  householdAddress: "Näide 1, Rakvere",
  deviceName: "Mari telefon",
};

function requestWithBody(body, headers = { "content-type": "application/json" }) {
  return new Request("https://example.test/api/auth/create-household", { method: "POST", headers, body });
}

function jsonBodyWithExactByteLength(byteLength) {
  const prefix = '{"value":"';
  const suffix = '"}';
  return `${prefix}${"x".repeat(byteLength - encoder.encode(prefix + suffix).byteLength)}${suffix}`;
}

function streamedRequest(chunks, headers = { "content-type": "application/json" }) {
  let chunkIndex = 0;
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (chunkIndex === chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[chunkIndex]);
      chunkIndex += 1;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    request: new Request("https://example.test/api/auth/create-household", {
      method: "POST",
      headers,
      body: stream,
      duplex: "half",
    }),
    state: {
      get pulls() {
        return pulls;
      },
      get cancelled() {
        return cancelled;
      },
    },
  };
}

test("json and apiError preserve JSON and no-store invariants", async () => {
  const response = json(201, { created: true }, {
    "X-Request-Id": "request-1",
    "Content-Type": "text/plain",
    "Cache-Control": "public, max-age=60",
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { created: true });
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), "request-1");

  const lowerCaseOverride = json(200, { ok: true }, {
    "content-type": "text/plain",
    "cache-control": "public, max-age=60",
  });
  assert.equal(lowerCaseOverride.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(lowerCaseOverride.headers.get("cache-control"), "no-store");

  const error = apiError(405, "METHOD_NOT_ALLOWED", "Method not allowed.", { Allow: "POST" });
  assert.equal(error.status, 405);
  assert.deepEqual(await error.json(), { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
  assert.equal(error.headers.get("allow"), "POST");
  assert.equal(error.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(error.headers.get("cache-control"), "no-store");
});

test("requireMethod accepts the required method and returns a safe 405 otherwise", async () => {
  const post = new Request("https://example.test", { method: "POST" });
  assert.equal(requireMethod(post, "POST"), null);

  const rejected = requireMethod(new Request("https://example.test", { method: "GET" }), "POST");
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get("allow"), "POST");
  assert.equal(rejected.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(rejected.headers.get("cache-control"), "no-store");
  assert.deepEqual(await rejected.json(), { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
});

test("readJsonObject accepts only JSON objects with an accepted media type", async () => {
  assert.deepEqual(await readJsonObject(requestWithBody('{"value":true}')), { ok: true, value: { value: true } });
  assert.deepEqual(await readJsonObject(requestWithBody('{"value":true}', { "content-type": "APPLICATION/JSON; CHARSET=UTF-8" })), { ok: true, value: { value: true } });
  for (const body of ["{", "[]", "null", "true", "42", "", "\"text\""]) {
    assert.deepEqual(await readJsonObject(requestWithBody(body)), { ok: false, code: "INVALID_REQUEST" });
  }
  assert.deepEqual(await readJsonObject(requestWithBody("{}", {})), { ok: false, code: "INVALID_REQUEST" });
  assert.deepEqual(await readJsonObject(requestWithBody("{}", { "content-type": "text/plain" })), { ok: false, code: "INVALID_REQUEST" });
  assert.deepEqual(await readJsonObject(requestWithBody("{}", { "content-type": "application/xml" })), { ok: false, code: "INVALID_REQUEST" });
  assert.deepEqual(await readJsonObject(requestWithBody("{}", { "content-type": "application/json; charset=iso-8859-1" })), { ok: false, code: "INVALID_REQUEST" });
});

test("readJsonObject collapses stream errors into INVALID_REQUEST", async () => {
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(encoder.encode('{"value":'));
        return;
      }
      controller.error(new Error("stream failed"));
    },
  });
  const request = new Request("https://example.test/api/auth/create-household", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  });
  assert.deepEqual(await readJsonObject(request), { ok: false, code: "INVALID_REQUEST" });
  assert.ok(pulls >= 2);
});

test("readJsonObject enforces the 8192-byte cap from both headers and the actual stream", async () => {
  const exactLimit = jsonBodyWithExactByteLength(8192);
  assert.equal(encoder.encode(exactLimit).byteLength, 8192);
  assert.deepEqual(await readJsonObject(requestWithBody(exactLimit)), { ok: true, value: JSON.parse(exactLimit) });

  assert.deepEqual(await readJsonObject(requestWithBody("{}", { "content-type": "application/json", "content-length": "8193" })), { ok: false, code: "INVALID_REQUEST" });
  const oversized = jsonBodyWithExactByteLength(8193);
  assert.deepEqual(await readJsonObject(requestWithBody(oversized, { "content-type": "application/json", "content-length": "1" })), { ok: false, code: "INVALID_REQUEST" });

  const firstChunk = encoder.encode(jsonBodyWithExactByteLength(8192));
  const { request, state } = streamedRequest([firstChunk, encoder.encode("x"), encoder.encode("this must not be read")]);
  assert.deepEqual(await readJsonObject(request), { ok: false, code: "INVALID_REQUEST" });
  assert.equal(state.cancelled, true);
  assert.ok(state.pulls <= 2, "oversized body reader must not intentionally consume later chunks");

  const multibyte = `{"value":"${"€".repeat(2730)}"}`;
  assert.ok(multibyte.length < 8192);
  assert.ok(encoder.encode(multibyte).byteLength > 8192);
  assert.deepEqual(await readJsonObject(requestWithBody(multibyte)), { ok: false, code: "INVALID_REQUEST" });
});

test("validateCreateHouseholdInput accepts only normalized client fields", () => {
  assert.deepEqual(validateCreateHouseholdInput({
    userName: "  Mari  ",
    householdName: "  Kase kodu  ",
    householdAddress: "  Näide 1  ",
    deviceName: "  Mari telefon  ",
  }), {
    ok: true,
    value: { ...validInput, householdAddress: "Näide 1" },
  });
  assert.deepEqual(validateCreateHouseholdInput({ ...validInput, householdAddress: null }), {
    ok: true,
    value: { ...validInput, householdAddress: null },
  });
  assert.deepEqual(validateCreateHouseholdInput({ userName: "Mari", householdName: "Kase kodu", deviceName: "Mari telefon" }), {
    ok: true,
    value: { ...validInput, householdAddress: null },
  });

  const invalid = [
    {},
    { ...validInput, userName: "   " },
    { ...validInput, userName: "x".repeat(81) },
    { ...validInput, householdName: "x".repeat(121) },
    { ...validInput, householdAddress: "x".repeat(241) },
    { ...validInput, deviceName: "x".repeat(121) },
    { ...validInput, userName: 3 },
    { ...validInput, householdAddress: 3 },
    { ...validInput, extra: "unexpected" },
    { ...validInput, householdId: "hld_forged" },
    { ...validInput, userId: "usr_forged" },
    { ...validInput, sessionId: "ses_forged" },
    { ...validInput, role: "OWNER" },
    { ...validInput, revision: 1 },
    { ...validInput, createdAt: "2026-09-20T00:00:00Z" },
  ];
  for (const value of invalid) assert.deepEqual(validateCreateHouseholdInput(value), { ok: false, code: "INVALID_REQUEST" });

  const seventyNineAstralCodePoints = "😀".repeat(79);
  assert.equal(seventyNineAstralCodePoints.length, 158);
  assert.equal(validateCreateHouseholdInput({ ...validInput, userName: seventyNineAstralCodePoints }).ok, true);
  assert.deepEqual(validateCreateHouseholdInput({ ...validInput, userName: "😀".repeat(81) }), { ok: false, code: "INVALID_REQUEST" });
});

test("validateCreateHouseholdInput independently enforces field minima and types", () => {
  for (const [field, invalidValue] of [
    ["userName", "   "],
    ["userName", 1],
    ["householdName", "   "],
    ["householdName", 1],
    ["deviceName", "   "],
    ["deviceName", 1],
    ["householdAddress", "   "],
    ["householdAddress", 1],
  ]) {
    assert.deepEqual(validateCreateHouseholdInput({ ...validInput, [field]: invalidValue }), { ok: false, code: "INVALID_REQUEST" });
  }
  assert.deepEqual(validateCreateHouseholdInput({ userName: "Mari", householdName: "Kase kodu", deviceName: "Mari telefon" }), {
    ok: true,
    value: { ...validInput, householdAddress: null },
  });
  assert.deepEqual(validateCreateHouseholdInput({ ...validInput, householdAddress: null }), {
    ok: true,
    value: { ...validInput, householdAddress: null },
  });
});

test("newId generates only server UUID namespaces and rejects unsupported prefixes", () => {
  const patterns = {
    hld: /^hld_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    usr: /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ses: /^ses_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  };
  for (const [prefix, pattern] of Object.entries(patterns)) {
    const first = newId(prefix);
    const second = newId(prefix);
    assert.match(first, pattern);
    assert.match(second, pattern);
    assert.notEqual(first, second);
  }
  for (const value of ["other", "", undefined, null, 1, {}]) assert.throws(() => newId(value), RangeError);
  assert.equal("isId" in ids, false);
  assert.equal("validateId" in ids, false);
  assert.equal("parseId" in ids, false);
  assert.match(readFileSync(new URL("../../functions/_lib/ids.js", import.meta.url), "utf8"), /crypto\.randomUUID\(\)/);
});
