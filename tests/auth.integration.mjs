import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

// Run only against a development/test database. Creates and removes one unique fixture.
const prisma = new PrismaClient();
const port = process.env.AUTH_TEST_PORT ?? "3197";
const base = `http://localhost:${port}`;
const email = `auth-test-${randomBytes(12).toString("hex")}@example.com`;
const password = randomBytes(24).toString("hex");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", port], {
  env: {
    ...process.env,
    NODE_ENV: "development",
    JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
    ALLOWED_ORIGIN: base,
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (data) => { logs = (logs + data).slice(-8000); });
child.stderr.on("data", (data) => { logs = (logs + data).slice(-8000); });
const exited = new Promise((resolve) => child.once("exit", resolve));

async function call(path, { body, cookie, token, method = "POST" } = {}) {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${logs}`);
    try {
      const response = await fetch(`${base}/api/v1/users/me`);
      if (response.status === 401) { ready = true; break; }
    } catch { /* Wait for server startup. */ }
    await delay(250);
  }
  assert.ok(ready, `Test server did not start: ${logs}`);
  const registered = await call("auth/register", { body: { name: "Auth Test", email, password } });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  assert.equal(registered.body.data.user.role, "CUSTOMER");
  assert.equal(registered.body.data.user.passwordHash, undefined);
  assert.ok(registered.cookie);
  const token = registered.body.data.accessToken;
  const userId = registered.body.data.user.id;
  const profile = await call("users/me", { method: "GET", token });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.user.id, userId);
  assert.equal((await call("auth/register", { body: { name: "Auth Test", email, password } })).status, 409);
  const stored = await prisma.refreshToken.findFirstOrThrow({ where: { userId } });
  assert.notEqual(stored.tokenHash, registered.cookie.split("=")[1]);
  assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);

  // Competing requests must consume the original refresh token exactly once.
  const rotations = await Promise.all([
    call("auth/refresh-token", { cookie: registered.cookie }),
    call("auth/refresh-token", { cookie: registered.cookie }),
  ]);
  assert.deepEqual(rotations.map((result) => result.status).sort(), [200, 401]);
  const rotated = rotations.find((result) => result.status === 200);
  assert.notEqual(rotated.cookie, registered.cookie);
  assert.equal((await call("auth/refresh-token", { cookie: registered.cookie })).status, 401);
  assert.equal((await call("auth/logout", { cookie: rotated.cookie })).status, 200);
  assert.equal((await call("auth/refresh-token", { cookie: rotated.cookie })).status, 401);
  assert.equal((await call("auth/refresh-token")).status, 401);
  assert.equal((await call("auth/login", { body: { email, password: "wrong-password" } })).status, 401);
  const login = await call("auth/login", { body: { email, password } });
  assert.equal(login.status, 200);
  await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
  assert.equal((await call("users/me", { method: "GET", token })).status, 401);
  assert.equal((await call("auth/refresh-token", { cookie: login.cookie })).status, 401);
  assert.equal((await call("auth/login", { body: { email, password } })).status, 401);
  console.info("Auth integration passed: registration, profile, duplicate email, concurrent rotation, replay rejection, logout, login, inactive account.");
} finally {
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  try {
    const fixture = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (fixture) {
      await prisma.$transaction([
        prisma.auditLog.deleteMany({ where: { actorId: fixture.id } }),
        prisma.refreshToken.deleteMany({ where: { userId: fixture.id } }),
        prisma.user.delete({ where: { id: fixture.id } }),
      ]);
    }
  } finally {
    await prisma.$disconnect();
  }
}
