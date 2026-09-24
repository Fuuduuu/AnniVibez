// Phase 9 actual-runtime integration for the Majandus backend foundation.
//
// Scope of proof:
//   VERIFIED HERE  - actual Cloudflare Pages file/method dispatch. Requests travel over localhost HTTP
//                    through the installed Wrangler `pages dev` runtime, its Pages filesystem routing and
//                    method dispatch, into this repository's own functions/ tree, and back.
//   NOT HERE       - exported-handler contracts, which are pinned by create-household-api.test.mjs and
//                    session-api.test.mjs through direct handler calls.
//
// Isolation: every runtime gets a fresh OS-temp directory holding its local D1 persistence, an empty
// static-asset directory, and a project directory whose `functions` entry is a junction/symlink to this
// repository's functions/ tree. Wrangler runs with `--cwd` pointed at that project directory, so its
// `.wrangler` bundle output lands in temp rather than in the repository. The schema comes from the
// existing migration through `wrangler d1 migrations apply --local`. Nothing here is remote.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const wranglerBin = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const functionsDir = resolve(root, "functions");
const TEST_CONFIG = "scripts/backend/wrangler.test.jsonc";
const TEST_DATABASE_NAME = "majandus-backend-test";
const TEST_DATABASE_ID = "00000000-0000-0000-0000-000000000001";
const COMPATIBILITY_DATE = "2026-09-20";
const EXPECTED_WRANGLER_VERSION = "4.135.0";
const READY_TIMEOUT_MS = 120_000;
const TEMP_DIRECTORY_REMOVE_RETRY_MS = 300;
const TEMP_DIRECTORY_REMOVE_TIMEOUT_MS = 30_000;
const RETRYABLE_TEMP_REMOVE_CODES = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);
// Parent of the Phase 1 schema commit 6d3496177a6c8ca1857c4081d900be69a0bbfeeb: the pre-backend baseline.
const BACKEND_BASELINE = "18f5c041fb796b3d4476a3959a79b09ce19d28b8";

const CREATE_PATH = "/api/auth/create-household";
const SESSION_PATH = "/api/auth/session";
const DEVICE_TOKEN = /^m1s_[A-Za-z0-9_-]{43}$/;
const RECOVERY_CODE = /^m1r_[A-Za-z0-9_-]{43}$/;
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const METHOD_NOT_ALLOWED = { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } };
const UNAUTHORIZED = { error: { code: "UNAUTHORIZED", message: "Authentication required." } };
const INTERNAL_ERROR = { error: { code: "INTERNAL_ERROR", message: "Internal server error." } };
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const FUTURE_SYNC_TABLES = ["applied_mutations", "calendar_events", "change_log", "shared_places", "waste_config"];
const validInput = {
  userName: "Märt",
  householdName: "Kase kodu",
  householdAddress: "Näide 1, Rakvere",
  deviceName: "Märt telefon",
};
const childEnv = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" };
const liveChildren = new Set();

// Last-resort guard: never leave a Wrangler process tree behind, even on an unexpected exit.
process.on("exit", () => {
  for (const child of liveChildren) killTree(child.pid);
});

function killTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { encoding: "utf8" });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], { cwd: root, env: childEnv, encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `wrangler ${args.slice(0, 3).join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function d1(persistDir, sql) {
  const stdout = runWrangler([
    "d1", "execute", TEST_DATABASE_NAME, "--local", "--config", TEST_CONFIG,
    "--persist-to", persistDir, "--json", "--command", sql,
  ]);
  return JSON.parse(stdout).map((entry) => entry.results);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function portAcceptsConnections(port) {
  return new Promise((resolveState) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolveState(true);
    });
    socket.once("error", () => resolveState(false));
  });
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function removeTempDirectoryWithRetry(path) {
  const deadline = Date.now() + TEMP_DIRECTORY_REMOVE_TIMEOUT_MS;
  let lastError;

  while (true) {
    if (lastError && Date.now() >= deadline) throw lastError;

    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!RETRYABLE_TEMP_REMOVE_CODES.has(error?.code)) throw error;
      lastError = error;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw lastError;
      await delay(Math.min(TEMP_DIRECTORY_REMOVE_RETRY_MS, remainingMs));
    }
  }
}

// Creates isolated state, migrates a fresh local D1 with the existing migration, optionally applies a
// test-only fault, then launches the actual Pages runtime and waits until it genuinely serves functions.
async function startPagesRuntime({ fault } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "majandus-p9-"));
  const persistDir = join(stateDir, "persist");
  const assetsDir = join(stateDir, "assets");
  const projectDir = join(stateDir, "project");
  const functionsLink = join(projectDir, "functions");
  mkdirSync(assetsDir);
  mkdirSync(projectDir);
  symlinkSync(functionsDir, functionsLink, process.platform === "win32" ? "junction" : "dir");

  const runtime = { stateDir, persistDir, functionsLink, child: undefined, port: undefined, log: "", stopped: false };

  runtime.stop = async () => {
    if (runtime.stopped) return;
    runtime.stopped = true;
    const { child } = runtime;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
      killTree(child.pid);
      await Promise.race([exited, delay(15_000)]);
    }
    if (child) liveChildren.delete(child);
    for (let attempt = 0; attempt < 20 && runtime.port && (await portAcceptsConnections(runtime.port)); attempt += 1) {
      await delay(250);
    }
  };

  runtime.dispose = async () => {
    await runtime.stop();
    // Remove the link itself first. A non-recursive rmdir cannot delete a real non-empty directory,
    // so this can never reach into the repository's functions/ tree.
    if (existsSync(functionsLink)) rmdirSync(functionsLink);
    assert.equal(existsSync(join(functionsDir, "api/auth/session.js")), true, "repository functions/ must survive cleanup");
    await removeTempDirectoryWithRetry(stateDir);
  };

  try {
    runWrangler([
      "d1", "migrations", "apply", TEST_DATABASE_NAME, "--local", "--config", TEST_CONFIG, "--persist-to", persistDir,
    ]);
    if (fault) d1(persistDir, fault);

    runtime.port = await freePort();
    const inspectorPort = await freePort();
    const child = spawn(process.execPath, [
      wranglerBin, "pages", "dev", assetsDir,
      "--d1", `DB=${TEST_DATABASE_ID}`,
      "--persist-to", persistDir,
      "--ip", "127.0.0.1",
      "--port", String(runtime.port),
      "--inspector-port", String(inspectorPort),
      "--compatibility-date", COMPATIBILITY_DATE,
      "--show-interactive-dev-session=false",
      "--log-level", "warn",
      "--cwd", projectDir,
    ], { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    runtime.child = child;
    liveChildren.add(child);
    child.once("exit", () => liveChildren.delete(child));
    child.stdout.on("data", (chunk) => { runtime.log += chunk; });
    child.stderr.on("data", (chunk) => { runtime.log += chunk; });

    runtime.base = `http://127.0.0.1:${runtime.port}`;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      assert.equal(child.exitCode, null, `wrangler pages dev exited early\n${runtime.log}`);
      try {
        const probe = await fetch(runtime.base + SESSION_PATH);
        await probe.arrayBuffer();
        // Readiness means the session function is serving, not merely that a socket is open.
        ready = probe.status === 401;
      } catch {
        await delay(300);
      }
    }
    assert.equal(ready, true, `wrangler pages dev did not become ready within ${READY_TIMEOUT_MS} ms\n${runtime.log}`);
    return runtime;
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

async function request(runtime, method, path, { headers, body } = {}) {
  const response = await fetch(runtime.base + path, { method, headers, body });
  const text = method === "HEAD" ? null : await response.text();
  return {
    status: response.status,
    allow: response.headers.get("allow"),
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    wwwAuthenticate: response.headers.get("www-authenticate"),
    corsOrigin: response.headers.get("access-control-allow-origin"),
    text,
  };
}

function assertCanonicalError(observed, status, envelope, label) {
  assert.equal(observed.status, status, label);
  assert.equal(observed.contentType, JSON_CONTENT_TYPE, label);
  assert.equal(observed.cacheControl, "no-store", label);
  assert.equal(observed.corsOrigin, null, `${label}: no permissive CORS`);
  // HEAD responses carry no client-visible body by HTTP semantics; routing is judged by status/headers.
  if (observed.text !== null) assert.deepEqual(JSON.parse(observed.text), envelope, label);
}

function postCreate(runtime, input = validInput) {
  return fetch(runtime.base + CREATE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if ([".js", ".jsx", ".mjs", ".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function importSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

function git(args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stderr}`);
  return result.stdout;
}

const repoStatusBefore = git(["status", "--porcelain", "--untracked-files=all"]);
const wranglerDirExistedBefore = existsSync(join(root, ".wrangler"));

test("uses the already-installed Wrangler 4.135.0 without remote access", () => {
  const installed = JSON.parse(readFileSync(resolve(root, "node_modules/wrangler/package.json"), "utf8")).version;
  assert.equal(installed, EXPECTED_WRANGLER_VERSION);
  assert.equal(runWrangler(["--version"]).trim().split(/\s+/).at(-1), EXPECTED_WRANGLER_VERSION);
});

describe("actual Pages routing against a clean migrated local D1", () => {
  let runtime;
  let created;

  before(async () => {
    runtime = await startPagesRuntime();
  }, { timeout: 240_000 });

  after(async () => {
    await runtime?.dispose();
  }, { timeout: 60_000 });

  test("serves this repository's own functions/ tree through the runtime project link", () => {
    assert.equal(realpathSync(runtime.functionsLink), realpathSync(functionsDir));
  });

  test("create-household non-POST methods are dispatched to the generic 405 with Allow: POST", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]) {
      const observed = await request(runtime, method, CREATE_PATH);
      assertCanonicalError(observed, 405, METHOD_NOT_ALLOWED, `${method} ${CREATE_PATH}`);
      assert.equal(observed.allow, "POST", `${method} ${CREATE_PATH}`);
      assert.equal(observed.wwwAuthenticate, null, `${method} ${CREATE_PATH}`);
    }
  });

  test("session non-GET methods, including HEAD, are dispatched to the generic 405 with Allow: GET", async () => {
    for (const method of ["POST", "HEAD", "OPTIONS", "PUT", "DELETE"]) {
      const observed = await request(runtime, method, SESSION_PATH);
      assertCanonicalError(observed, 405, METHOD_NOT_ALLOWED, `${method} ${SESSION_PATH}`);
      assert.equal(observed.allow, "GET", `${method} ${SESSION_PATH}`);
      assert.equal(observed.wwwAuthenticate, null, `${method} ${SESSION_PATH}`);
    }
  });

  test("GET session reaches onRequestGet, not the generic handler: unauthenticated GET is the canonical 401", async () => {
    const observed = await request(runtime, "GET", SESSION_PATH);
    assertCanonicalError(observed, 401, UNAUTHORIZED, `GET ${SESSION_PATH} without Authorization`);
    assert.equal(observed.wwwAuthenticate, "Bearer");
    assert.equal(observed.allow, null, "a 405 Allow header would mean the generic handler answered GET");
  });

  test("POST create-household reaches onRequestPost and returns the exact public creation result", async () => {
    const response = await postCreate(runtime);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("content-type"), JSON_CONTENT_TYPE);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("allow"), null);
    created = await response.json();

    assert.deepEqual(Object.keys(created).sort(), ["account", "deviceSession", "household", "recovery"]);
    assert.deepEqual(Object.keys(created.account).sort(), ["displayName", "role", "userId"]);
    assert.deepEqual(Object.keys(created.household).sort(), ["address", "createdAt", "id", "name", "revision", "updatedAt"]);
    assert.deepEqual(Object.keys(created.deviceSession).sort(), ["createdAt", "deviceName", "id", "token"]);
    assert.deepEqual(Object.keys(created.recovery).sort(), ["code"]);
    // Booleans only, so a failure never prints a credential.
    assert.equal(DEVICE_TOKEN.test(created.deviceSession.token), true, "device token must be canonical");
    assert.equal(RECOVERY_CODE.test(created.recovery.code), true, "recovery code must be canonical");
    assert.equal(CANONICAL_INSTANT.test(created.household.createdAt), true);
    assert.deepEqual(
      [created.household.updatedAt, created.deviceSession.createdAt],
      [created.household.createdAt, created.household.createdAt],
    );
    assert.deepEqual(
      [created.account.displayName, created.account.role, created.household.name, created.household.address, created.household.revision, created.deviceSession.deviceName],
      [validInput.userName, "OWNER", validInput.householdName, validInput.householdAddress, 1, validInput.deviceName],
    );
  });

  test("the token returned by routed creation authenticates routed GET session and yields the exact projection", async () => {
    assert.ok(created, "requires the routed creation result");
    const response = await fetch(runtime.base + SESSION_PATH, {
      headers: { authorization: `Bearer ${created.deviceSession.token}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), JSON_CONTENT_TYPE);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), {
      session: {
        id: created.deviceSession.id,
        deviceName: created.deviceSession.deviceName,
        createdAt: created.deviceSession.createdAt,
        lastSeenAt: created.deviceSession.createdAt,
      },
      account: created.account,
      household: created.household,
    });
    assert.equal(text.includes(created.deviceSession.token), false, "session body must not echo the bearer token");
    assert.equal(text.includes(created.recovery.code), false, "session body must not expose recovery material");
    assert.equal(text.includes(sha256Hex(`majandus:v1:device-session:${created.deviceSession.token}`)), false);
  });

  test("HEAD session with a valid bearer is still the generic 405 and never the GET metadata path", async () => {
    assert.ok(created, "requires the routed creation result");
    const observed = await request(runtime, "HEAD", SESSION_PATH, {
      headers: { authorization: `Bearer ${created.deviceSession.token}` },
    });
    assertCanonicalError(observed, 405, METHOD_NOT_ALLOWED, `authenticated HEAD ${SESSION_PATH}`);
    assert.equal(observed.allow, "GET");
    assert.equal(observed.wwwAuthenticate, null);
  });

  test("runtime D1 holds exactly the routed creation: hashes correspond, no plaintext, sync tables empty, read-only session", async () => {
    assert.ok(created, "requires the routed creation result");
    await runtime.stop();
    assert.equal(await portAcceptsConnections(runtime.port), false, "stopped runtime must not keep listening");

    const [tableRows] = d1(runtime.persistDir,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
    const tables = tableRows.map(({ name }) => name);
    for (const table of FUTURE_SYNC_TABLES) assert.ok(tables.includes(table), `${table} must exist`);

    const dumps = d1(runtime.persistDir, tables.map((table) => `SELECT * FROM "${table}"`).join("; "));
    const byTable = Object.fromEntries(tables.map((table, index) => [table, dumps[index]]));

    assert.deepEqual(byTable.households.map(({ id, name, address, owner_member_id, revision, created_at, updated_at }) => (
      { id, name, address, owner_member_id, revision, created_at, updated_at }
    )), [{
      id: created.household.id,
      name: validInput.householdName,
      address: validInput.householdAddress,
      owner_member_id: created.account.userId,
      revision: 1,
      created_at: created.household.createdAt,
      updated_at: created.household.updatedAt,
    }]);
    assert.deepEqual(byTable.users.map(({ id, household_id, role, revoked_at }) => ({ id, household_id, role, revoked_at })), [{
      id: created.account.userId, household_id: created.household.id, role: "OWNER", revoked_at: null,
    }]);
    assert.equal(byTable.device_sessions.length, 1);
    assert.equal(byTable.household_recovery.length, 1);
    const [session] = byTable.device_sessions;
    const [recovery] = byTable.household_recovery;
    assert.deepEqual(
      [session.id, session.user_id, session.revoked_at, recovery.household_id],
      [created.deviceSession.id, created.account.userId, null, created.household.id],
    );
    // Independent hash oracle over the credentials returned through routing (production hashSecret is not used).
    assert.equal(session.token_hash === sha256Hex(`majandus:v1:device-session:${created.deviceSession.token}`), true,
      "persisted token_hash must correspond to the returned device token");
    assert.equal(recovery.recovery_hash === sha256Hex(`majandus:v1:household-recovery:${created.recovery.code}`), true,
      "persisted recovery_hash must correspond to the returned recovery code");
    // Phase 8 is read-only: the routed GET must not have advanced last_seen_at.
    assert.equal(session.last_seen_at, created.deviceSession.createdAt);

    const everything = JSON.stringify(byTable);
    assert.equal(everything.includes(created.household.id), true, "positive control: the dump contains the creation");
    assert.equal(everything.includes(created.deviceSession.token), false, "plaintext device token must not be persisted");
    assert.equal(everything.includes(created.recovery.code), false, "plaintext recovery code must not be persisted");

    for (const table of [...FUTURE_SYNC_TABLES, "one_time_tokens"]) {
      assert.deepEqual(byTable[table], [], `${table} must stay empty after creation`);
    }
  });
});

test("dispose stops a live Pages runtime before removing its isolated state", async () => {
  const runtime = await startPagesRuntime();
  const { child, port, stateDir } = runtime;
  let firstFailure;

  try {
    assert.equal(await portAcceptsConnections(port), true, "runtime must still be serving before dispose");
    await runtime.dispose();
  } catch (error) {
    firstFailure = error;
    // Keep a red TDD run from leaking its own temp state when the first Windows removal is transiently denied.
    await delay(300);
    try {
      await runtime.dispose();
    } catch {
      // Preserve the first failure; the post-dispose assertions below still expose any surviving state.
    }
  }

  assert.equal(firstFailure, undefined, "dispose must succeed while the Pages runtime is live");
  assert.equal(existsSync(stateDir), false, "dispose must remove the isolated state directory");
  assert.equal(await portAcceptsConnections(port), false, "dispose must close the runtime listener");
  assert.notEqual(child.exitCode, null, "dispose must wait for the Wrangler child to exit");
  assert.equal(liveChildren.has(child), false, "disposed Wrangler child must no longer be registered");
}, { timeout: 240_000 });

describe("actual Pages routing with an injected fourth-statement batch failure", () => {
  let runtime;

  before(async () => {
    // Test-local fault only: abort household_recovery inserts, the fourth statement of the creation batch.
    runtime = await startPagesRuntime({
      fault: "CREATE TRIGGER p9_inject_batch_failure BEFORE INSERT ON household_recovery "
        + "WHEN (SELECT name FROM households WHERE id = NEW.household_id) = 'P9 atomicity fault' "
        + "BEGIN SELECT RAISE(ABORT, 'p9 injected batch failure'); END",
    });
  }, { timeout: 240_000 });

  after(async () => {
    await runtime?.dispose();
  }, { timeout: 60_000 });

  test("routed fault POST is followed by one successful creation in the same runtime", async () => {
    const faultInput = { ...validInput, householdName: "P9 atomicity fault" };
    const response = await postCreate(runtime, faultInput);
    const observed = {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      corsOrigin: response.headers.get("access-control-allow-origin"),
      text: await response.text(),
    };
    assertCanonicalError(observed, 500, INTERNAL_ERROR, `POST ${CREATE_PATH} with injected batch failure`);
    assert.equal(observed.text.includes("p9 injected batch failure"), false, "raw injected D1 error text must not reach the client");

    const controlResponse = await postCreate(runtime, {
      ...validInput,
      householdName: "P9 atomicity control",
    });
    const controlBody = await controlResponse.json();
    assert.equal(controlResponse.status, 201, "the same runtime and D1 must accept a normal creation after the injected fault");
    assert.equal(controlBody.household.name, "P9 atomicity control");

    await runtime.stop();
    assert.equal(await portAcceptsConnections(runtime.port), false, "stopped runtime must not keep listening");
    const [[counts]] = d1(runtime.persistDir,
      "SELECT (SELECT COUNT(*) FROM households) AS households, (SELECT COUNT(*) FROM users) AS users, "
      + "(SELECT COUNT(*) FROM device_sessions) AS sessions, (SELECT COUNT(*) FROM household_recovery) AS recoveries, "
      + "(SELECT COUNT(*) FROM households WHERE name = 'P9 atomicity fault') AS fault_households, "
      + "(SELECT COUNT(*) FROM households WHERE name = 'P9 atomicity control') AS control_households");
    assert.deepEqual(counts, {
      households: 1,
      users: 1,
      sessions: 1,
      recoveries: 1,
      fault_households: 0,
      control_households: 1,
    });
    assert.equal(counts.fault_households, 0, "the fault transaction must leave no fault household");
    assert.equal(counts.control_households, 1, "the same D1 must persist exactly one normal control household");
  });
});

test("backend foundation leaves the client runtime dormant: no src/ change and no cross-runtime import", () => {
  assert.equal(git(["diff", "--name-only", BACKEND_BASELINE, "--", "src"]), "", "tracked src/ must be unchanged since the backend baseline");
  assert.equal(git(["ls-files", "--others", "--exclude-standard", "--", "src"]), "", "no untracked src/ file may appear");

  for (const file of sourceFiles(resolve(root, "src"))) {
    const source = readFileSync(file, "utf8");
    const label = relative(root, file);
    for (const specifier of importSpecifiers(source)) {
      assert.equal(/(^|\/)functions\//.test(specifier), false, `${label} must not import backend code (${specifier})`);
    }
    assert.equal(source.includes("/api/auth/"), false, `${label} must not call the backend auth API`);
  }
  for (const file of sourceFiles(functionsDir)) {
    const label = relative(root, file);
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      assert.equal(/(^|\/)src\//.test(specifier), false, `${label} must not import client runtime code (${specifier})`);
    }
  }
});

test("the integration run leaves no Git-visible or repository-local runtime state", () => {
  assert.equal(liveChildren.size, 0, "no Wrangler process may remain registered");
  assert.equal(existsSync(join(root, ".wrangler")), wranglerDirExistedBefore, "runtime bundles must stay out of the repository");
  assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), repoStatusBefore);
});
