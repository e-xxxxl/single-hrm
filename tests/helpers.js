/**
 * Test harness: an isolated API on a random port, backed by a throwaway
 * in-memory MongoDB, seeded with the demo organizations.
 */
import { MongoMemoryServer } from "mongodb-memory-server";

export const PASSWORD = "Test@Pass123";

let mongo;
let server;
export let BASE;

export async function startApp() {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 120_000 } });
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = mongo.getUri("hrm_test");
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.AUTH_CACHE_TTL_MS = "0";
  process.env.BCRYPT_ROUNDS = "4";
  process.env.UPLOAD_DIR = `${process.cwd()}/.test-uploads`;
  process.env.STORAGE_DRIVER = "local";
  process.env.GEOCODE_PROVIDER = "none"; // no network calls from tests

  const { start } = await import("../app.js");
  server = await start({ port: 0 });
  BASE = `http://127.0.0.1:${server.address().port}/api`;

  const { seed } = await import("../scripts/seed.js");
  await seed({ password: PASSWORD, demo: true });
}

export async function stopApp() {
  const { closeDatabase } = await import("../config/db.js");
  server?.closeAllConnections?.();
  await new Promise((r) => (server ? server.close(r) : r()));
  await closeDatabase().catch(() => {});
  // mongod can be slow to exit on Windows; don't fail the suite over teardown.
  await mongo?.stop({ doCleanup: true, force: true }).catch(() => {});
  const fs = await import("node:fs/promises");
  await fs.rm(`${process.cwd()}/.test-uploads`, { recursive: true, force: true });
}

/** Minimal API client. Returns { status, body, headers, text }. */
export async function call(method, path, { token, body, raw = false, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  if (!raw) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { status: res.status, body: parsed, headers: res.headers, text };
}

export const get = (path, token, opts = {}) => call("GET", path, { token, ...opts });
export const post = (path, token, body, opts = {}) => call("POST", path, { token, body, ...opts });
export const patch = (path, token, body) => call("PATCH", path, { token, body });
export const del = (path, token) => call("DELETE", path, { token });

/** Sign in and return { token, session, cookie }. Throws on failure. */
export async function login(email, password = PASSWORD) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(body)}`);
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  return { token: body.data.accessToken, session: body.data.session, user: body.data.user, cookie };
}
