import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Run after npm run build. No real database or provider credentials are needed.
const port = process.env.ERROR_TEST_PORT ?? "3196";
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", port], {
  env: { ...process.env, NODE_ENV: "production", ALLOWED_ORIGIN: base,
    DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test?connect_timeout=1", JWT_ACCESS_SECRET: "test-only-secret-at-least-thirty-two-characters" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (data) => { logs = (logs + data).slice(-4000); });
child.stderr.on("data", (data) => { logs = (logs + data).slice(-4000); });
const exited = new Promise((resolve) => child.once("exit", resolve));
async function check(path, status, code, method = "GET", headers = {}) {
  const response = await fetch(`${base}${path}`, { method, headers });
  assert.equal(response.status, status, path);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.errors[0].code, code);
  return response;
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${base}/api/v1/users/me`)).status === 401) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, logs);
  for (const path of ["/api", "/api/v1", "/api/unknown", "/api/v1/not-a-route", "/api/v1/users/me/unknown"]) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) await check(path, 404, "ENDPOINT_NOT_FOUND", method);
    const head = await fetch(`${base}${path}`, { method: "HEAD" });
    assert.equal(head.status, 404);
    assert.equal(await head.text(), "");
  }
  // The catch-all must not shadow real static or dynamic endpoints.
  for (const path of ["/api/v1/users/me", "/api/v1/users/cm123456789012345678901234", "/api/v1/shipments/search", "/api/v1/admin/audit-logs"]) {
    await check(path, 401, "UNAUTHENTICATED");
  }
  for (const path of ["/api/health", "/api/v1/health"]) await check(path, 503, "DATABASE_UNAVAILABLE");
  await check("/api/v1/users", 403, "ORIGIN_NOT_ALLOWED", "OPTIONS", { origin: "https://foreign.example" });
  const cors = await check("/api/v1/not-a-route", 404, "ENDPOINT_NOT_FOUND", "GET", { origin: base });
  assert.equal(cors.headers.get("access-control-allow-origin"), base);
  assert.equal((await fetch(`${base}/api/v1/users`, { method: "OPTIONS", headers: { origin: base } })).status, 204);
  console.info("Error HTTP integration passed: JSON fallback across methods, HEAD semantics, existing-route precedence, health failures and CORS rejection.");
} finally {
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
