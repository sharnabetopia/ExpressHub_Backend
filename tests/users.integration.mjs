import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

// Run only against a development/test database. Creates and removes unique fixtures.
const prisma = new PrismaClient();
const port = process.env.USER_TEST_PORT ?? "3198";
const base = `http://localhost:${port}`;
const email = `users-test-${randomBytes(12).toString("hex")}@example.com`;
const password = randomBytes(24).toString("hex");
const fixtureIds = [];
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

async function call(path, { body, cookie, token, method = "GET" } = {}) {
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
  async function fixture(role, suffix) {
    const bcrypt = (await import("bcryptjs")).default;
    const user = await prisma.user.create({ data: {
      name: `User Test ${suffix}`, email: `${suffix}-${email}`, role,
      passwordHash: await bcrypt.hash(password, 4),
    } });
    fixtureIds.push(user.id);
    const login = await call("auth/login", { method: "POST", body: { email: user.email, password } });
    assert.equal(login.status, 200);
    return { ...user, token: login.body.data.accessToken, cookie: login.cookie };
  }
  const admin = await fixture("ADMIN", "admin");
  const customer = await fixture("CUSTOMER", "customer");
  const courier = await fixture("COURIER", "courier");
  const request = (path, user, body) => call(path, { token: user.token, ...(body ? { method: "PATCH", body } : {}) });
  const me = await request("users/me", customer);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.phone, null);
  assert.equal(me.body.data.user.passwordHash, undefined);
  assert.equal((await call("users")).status, 401);
  assert.equal((await request("users", customer)).status, 403);
  assert.equal((await request("users", courier)).status, 403);
  assert.equal((await request(`users/${customer.id}`, customer)).status, 200);
  assert.equal((await request(`users/${courier.id}`, customer)).status, 404);
  assert.equal((await request(`users/${customer.id}`, courier)).status, 404);
  assert.equal((await request(`users/${customer.id}`, admin)).status, 200);
  assert.equal((await request("users/invalid", admin)).status, 400);

  const edited = await request("users/me", customer, { name: " Updated Customer ", phone: "123456789" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.user.name, "Updated Customer");
  assert.equal(edited.body.data.user.phone, "123456789");
  assert.equal((await request("users/me", customer, { phone: null })).body.data.user.phone, null);
  for (const body of [{}, { role: "ADMIN" }, { isActive: false }, { password: "new-password" }, { name: " " }]) {
    assert.equal((await request("users/me", customer, body)).status, 400);
  }
  assert.equal((await request("users/me", customer, { email: admin.email })).status, 409);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).email, customer.email);
  const renamedEmail = `changed-${email}`;
  assert.equal((await request("users/me", customer, { email: ` ${renamedEmail.toUpperCase()} ` })).body.data.user.email, renamedEmail);

  const query = `users?q=${encodeURIComponent(email)}&limit=1&page=1&sortBy=email&order=asc`;
  const page1 = await request(query, admin);
  const page2 = await request(query.replace("page=1", "page=2"), admin);
  assert.equal(page1.status, 200);
  assert.equal(page1.body.data.pagination.total, 3);
  assert.equal(page1.body.data.pagination.totalPages, 3);
  assert.notEqual(page1.body.data.users[0].id, page2.body.data.users[0].id);
  const filtered = await request(`users?q=${email}&role=COURIER&isActive=true`, admin);
  assert.equal(filtered.body.data.pagination.total, 1);
  assert.equal(filtered.body.data.users[0].id, courier.id);
  for (const query of ["limit=101", "page=0", "page=1.2", "isActive=yes", "sortBy=passwordHash", "role=OWNER", "limit=1&limit=2", "unexpected=x"]) {
    assert.equal((await request(`users?${query}`, admin)).status, 400, query);
  }

  assert.equal((await request(`users/${customer.id}/role`, customer, { role: "ADMIN" })).status, 403);
  assert.equal((await request(`users/${customer.id}/status`, courier, { isActive: false })).status, 403);
  assert.equal((await request(`users/${customer.id}/role`, admin, { role: "OWNER" })).status, 400);
  assert.equal((await request(`users/${customer.id}/status`, admin, { isActive: "false" })).status, 400);
  assert.equal((await request(`users/${admin.id}/role`, admin, { role: "CUSTOMER" })).status, 409);
  assert.equal((await request(`users/${admin.id}/status`, admin, { isActive: false })).status, 409);
  assert.equal((await request(`users/${customer.id}/role`, admin, { role: "COURIER" })).status, 200);
  assert.equal((await request("users/me", customer)).body.data.user.role, "COURIER");
  assert.equal((await call("auth/refresh-token", { method: "POST", cookie: customer.cookie })).status, 401);

  assert.equal((await request(`users/${courier.id}/status`, admin, { isActive: false })).status, 200);
  assert.equal((await request("users/me", courier)).status, 401);
  assert.equal((await call("auth/refresh-token", { method: "POST", cookie: courier.cookie })).status, 401);
  assert.equal((await request(`users?q=${email}&isActive=false`, admin)).body.data.pagination.total, 1);
  assert.equal((await request(`users/${courier.id}/status`, admin, { isActive: true })).status, 200);
  assert.equal((await call("auth/refresh-token", { method: "POST", cookie: courier.cookie })).status, 401);

  // Demotion must immediately invalidate Admin authorization even with an old JWT.
  assert.equal((await request(`users/${customer.id}/role`, admin, { role: "ADMIN" })).status, 200);
  assert.equal((await request("users", customer)).status, 200);
  assert.equal((await request(`users/${customer.id}/role`, admin, { role: "CUSTOMER" })).status, 200);
  assert.equal((await request("users", customer)).status, 403);
  await prisma.user.update({ where: { id: courier.id }, data: { deletedAt: new Date() } });
  assert.equal((await request(`users/${courier.id}`, admin)).status, 404);
  assert.equal((await request(`users/${courier.id}/role`, admin, { role: "CUSTOMER" })).status, 404);
  assert.equal((await request(`users/${courier.id}/status`, admin, { isActive: false })).status, 404);
  assert.equal((await request(`users?q=${email}`, admin)).body.data.pagination.total, 2);
  const audit = await prisma.auditLog.findMany({ where: { entityId: { in: fixtureIds } } });
  for (const action of ["USER_PROFILE_UPDATED", "USER_ROLE_UPDATED", "USER_STATUS_UPDATED"]) {
    assert.ok(audit.some((entry) => entry.action === action && entry.details.before && entry.details.after), action);
  }
  assert.equal(audit.filter((entry) => entry.action === "USER_ROLE_UPDATED").length, 3);
  // Two Admins cannot concurrently demote each other using stale permissions.
  assert.equal((await request(`users/${customer.id}/role`, admin, { role: "ADMIN" })).status, 200);
  const competing = await Promise.all([
    request(`users/${customer.id}/role`, admin, { role: "CUSTOMER" }),
    request(`users/${admin.id}/role`, customer, { role: "CUSTOMER" }),
  ]);
  assert.deepEqual(competing.map((result) => result.status).sort(), [200, 403]);
  assert.equal(await prisma.user.count({ where: { id: { in: fixtureIds }, role: "ADMIN", isActive: true } }), 1);
  console.info("User integration passed: ownership, profile edits, validation, pagination/filtering, role/status guards, session revocation, soft-delete exclusion and audit logging.");
} finally {
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  try {
    if (fixtureIds.length) {
      await prisma.$transaction([
        prisma.auditLog.deleteMany({ where: { actorId: { in: fixtureIds } } }),
        prisma.refreshToken.deleteMany({ where: { userId: { in: fixtureIds } } }),
        prisma.user.deleteMany({ where: { id: { in: fixtureIds } } }),
      ]);
    }
  } finally {
    await prisma.$disconnect();
  }
}
