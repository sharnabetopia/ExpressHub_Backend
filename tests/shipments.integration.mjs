import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

// Run only against a development/test database. Creates and removes unique fixtures.
const prisma = new PrismaClient();
const port = process.env.SHIPMENT_TEST_PORT ?? "3199";
const base = `http://localhost:${port}`;
const email = `shipments-test-${randomBytes(12).toString("hex")}@example.com`;
const password = randomBytes(24).toString("hex");
const fixtureIds = [];
const shipmentIds = [];
const pricingIds = [];
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
  const other = await fixture("CUSTOMER", "other");
  const courier = await fixture("COURIER", "courier");
  const courier2 = await fixture("COURIER", "courier2");
  const request = (path, user, body, method = body ? "PATCH" : "GET") => call(path, { token: user.token, body, method });
  const payload = {
    pickupContactName: "Sender Test", pickupContactPhone: "01700000000", pickupAddress: "Test pickup address",
    deliveryContactName: "Recipient Test", deliveryContactPhone: "01800000000", deliveryAddress: "Test delivery address",
    parcelWeightKg: 9876.543,
  };
  const rate = await prisma.pricingRule.create({ data: {
    name: email, minWeightKg: "9876", maxWeightKg: "9877", baseFee: "100", additionalPerKgFee: "20", currency: "BDT",
  } });
  pricingIds.push(rate.id);
  async function create(user = customer) {
    const result = await request("shipments", user, payload, "POST");
    assert.equal(result.status, 201, JSON.stringify(result.body));
    shipmentIds.push(result.body.data.shipment.id);
    return result.body.data.shipment;
  }
  const shipment = await create();
  assert.equal(shipment.status, "CREATED");
  assert.equal(shipment.paymentStatus, "PENDING");
  assert.equal(Number(shipment.price), 120);
  assert.equal(shipment.customerId, customer.id);
  assert.match(shipment.trackingNumber, /^EH-[A-F0-9]{24}$/);
  assert.equal(await prisma.shipmentEvent.count({ where: { shipmentId: shipment.id } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { shipmentId: shipment.id } }), 1);
  for (const body of [{ ...payload, price: 1 }, { ...payload, customerId: other.id }, { ...payload, paymentStatus: "PAID" },
    { ...payload, parcelWeightKg: 0 }, { ...payload, parcelLengthCm: 1 }, { ...payload, pickupScheduledAt: "2020-01-01T00:00:00Z" }]) {
    assert.equal((await request("shipments", customer, body, "POST")).status, 400);
  }
  assert.equal((await request("shipments", admin, payload, "POST")).status, 403);
  assert.equal((await request("shipments", courier, payload, "POST")).status, 403);
  assert.equal((await call("shipments")).status, 401);
  assert.equal((await request(`shipments/${shipment.id}`, other)).status, 404);
  assert.equal((await request(`shipments/${shipment.id}`, courier)).status, 404);
  assert.equal((await request(`shipments/${shipment.id}`, admin)).status, 200);
  assert.equal((await request(`shipments/search?q=${shipment.trackingNumber}`, other)).body.data.pagination.total, 0);
  assert.equal((await request("shipments/my-shipments", customer)).body.data.pagination.total, 1);
  for (const query of ["limit=101", "page=0", "sortBy=customerId", "from=invalid", "page=1&page=2", "status=WRONG", "customerId=x"]) {
    assert.equal((await request(`shipments?${query}`, customer)).status, 400);
  }
  assert.equal((await request("shipments/search", customer)).status, 400);
  // An ambiguous configuration must never silently select a price.
  const duplicate = await prisma.pricingRule.create({ data: {
    name: email, minWeightKg: "9876", maxWeightKg: "9877", baseFee: "1", currency: "BDT",
  } });
  pricingIds.push(duplicate.id);
  assert.equal((await request("shipments", customer, payload, "POST")).status, 503);
  await prisma.pricingRule.update({ where: { id: duplicate.id }, data: { isActive: false } });
  await prisma.pricingRule.update({ where: { id: rate.id }, data: { isActive: false } });
  assert.equal((await request("shipments", customer, payload, "POST")).status, 503);
  await prisma.pricingRule.update({ where: { id: rate.id }, data: { isActive: true, baseFee: "200" } });
  assert.equal(Number((await request(`shipments/${shipment.id}`, customer)).body.data.shipment.price), 120);

  const assign = (id, by, to, expectedCourierId = null) => request(`shipments/${id}/assign-courier`, by, { courierId: to.id, expectedCourierId });
  const status = (id, by, expectedStatus, next, note) => request(`shipments/${id}/status`, by, { status: next, expectedStatus, ...(note ? { note } : {}) });
  assert.equal((await assign(shipment.id, customer, courier)).status, 403);
  assert.equal((await assign(shipment.id, admin, customer)).status, 400);
  await prisma.user.update({ where: { id: courier2.id }, data: { isActive: false } });
  assert.equal((await assign(shipment.id, admin, courier2)).status, 400);
  await prisma.user.update({ where: { id: courier2.id }, data: { isActive: true } });
  const assignments = await Promise.all([assign(shipment.id, admin, courier), assign(shipment.id, admin, courier2)]);
  assert.deepEqual(assignments.map((r) => r.status).sort(), [200, 409]);
  const assignedId = assignments.find((r) => r.status === 200).body.data.shipment.courierId;
  const assigned = assignedId === courier.id ? courier : courier2;
  const wrong = assignedId === courier.id ? courier2 : courier;
  assert.equal((await request(`shipments/${shipment.id}`, assigned)).status, 200);
  assert.equal((await status(shipment.id, wrong, "CREATED", "PICKED_UP")).status, 404);
  assert.equal((await status(shipment.id, customer, "CREATED", "PICKED_UP")).status, 403);
  assert.equal((await status(shipment.id, assigned, "CREATED", "PICKED_UP")).status, 409);
  assert.equal((await status(shipment.id, admin, "CREATED", "PICKED_UP")).status, 409);

  // Test-only payment fixture: no API can mark shipments paid. Real verification is Step 9.
  await prisma.shipment.update({ where: { id: shipment.id }, data: { paymentStatus: "PAID" } });
  const pickups = await Promise.all([
    status(shipment.id, assigned, "CREATED", "PICKED_UP"), status(shipment.id, assigned, "CREATED", "PICKED_UP"),
  ]);
  assert.deepEqual(pickups.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await assign(shipment.id, admin, wrong, assigned.id)).status, 409);
  assert.equal((await status(shipment.id, customer, "PICKED_UP", "CANCELLED")).status, 409);
  assert.equal((await status(shipment.id, assigned, "PICKED_UP", "DELIVERED", "Received by recipient")).status, 409);
  assert.equal((await status(shipment.id, assigned, "PICKED_UP", "IN_TRANSIT")).status, 200);
  assert.equal((await status(shipment.id, assigned, "IN_TRANSIT", "OUT_FOR_DELIVERY")).status, 200);
  assert.equal((await status(shipment.id, assigned, "OUT_FOR_DELIVERY", "FAILED")).status, 400);
  assert.equal((await status(shipment.id, assigned, "OUT_FOR_DELIVERY", "FAILED", "Recipient unavailable")).status, 200);
  assert.equal((await status(shipment.id, assigned, "FAILED", "IN_TRANSIT")).status, 403);
  assert.equal((await status(shipment.id, admin, "FAILED", "IN_TRANSIT")).status, 200);
  assert.equal((await status(shipment.id, assigned, "IN_TRANSIT", "OUT_FOR_DELIVERY")).status, 200);
  const delivered = await status(shipment.id, assigned, "OUT_FOR_DELIVERY", "DELIVERED", "Confirmed receipt by recipient");
  assert.equal(delivered.status, 200);
  assert.ok(delivered.body.data.shipment.deliveredAt);
  assert.equal((await status(shipment.id, admin, "DELIVERED", "IN_TRANSIT")).status, 409);
  assert.equal(await prisma.shipmentEvent.count({ where: { shipmentId: shipment.id, toStatus: "PICKED_UP" } }), 1);
  const confirmation = await prisma.shipmentEvent.findFirst({ where: { shipmentId: shipment.id, toStatus: "DELIVERED" } });
  assert.equal(confirmation.internalNote, "Confirmed receipt by recipient");
  assert.equal((await request(`shipments/${shipment.id}`, customer)).body.data.shipment.internalNote, undefined);

  const cancelled = await create();
  assert.equal((await status(cancelled.id, customer, "CREATED", "CANCELLED")).status, 200);
  assert.equal((await assign(cancelled.id, admin, courier)).status, 409);
  assert.equal((await status(cancelled.id, admin, "CANCELLED", "PICKED_UP")).status, 409);
  const returned = await create();
  // Isolated failed-delivery fixture to exercise the Admin-only terminal return path.
  await prisma.shipment.update({ where: { id: returned.id }, data: { status: "FAILED", paymentStatus: "PAID", courierId: courier.id } });
  assert.equal((await status(returned.id, courier, "FAILED", "RETURNED", "Return requested")).status, 403);
  assert.equal((await status(returned.id, admin, "FAILED", "RETURNED", "Return requested")).status, 200);
  assert.equal((await status(returned.id, admin, "RETURNED", "CANCELLED")).status, 409);
  const page = await request("shipments?limit=1&page=2&sortBy=price&order=asc", customer);
  assert.equal(page.body.data.shipments.length, 1);
  assert.equal(page.body.data.pagination.total, 3);
  assert.equal((await request("shipments?status=DELIVERED&paymentStatus=PAID", customer)).body.data.pagination.total, 1);
  await prisma.shipment.update({ where: { id: cancelled.id }, data: { deletedAt: new Date() } });
  assert.equal((await request(`shipments/${cancelled.id}`, admin)).status, 404);
  assert.equal((await status(cancelled.id, admin, "CANCELLED", "PICKED_UP")).status, 404);
  assert.equal((await request("shipments", customer)).body.data.pagination.total, 2);
  assert.equal(await prisma.shipmentEvent.count({ where: { shipmentId: { in: shipmentIds } } }),
    await prisma.auditLog.count({ where: { shipmentId: { in: shipmentIds } } }));
  console.info("Shipment integration passed: pricing, snapshots, ownership, validation, assignment races, payment gate, lifecycle, confirmation, cancellation/return, pagination, audit and soft-delete exclusion.");
} finally {
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  try {
    if (fixtureIds.length || pricingIds.length) {
      await prisma.$transaction([
        prisma.auditLog.deleteMany({ where: { actorId: { in: fixtureIds } } }),
        prisma.shipmentEvent.deleteMany({ where: { shipment: { customerId: { in: fixtureIds } } } }),
        prisma.shipment.deleteMany({ where: { customerId: { in: fixtureIds } } }),
        prisma.refreshToken.deleteMany({ where: { userId: { in: fixtureIds } } }),
        prisma.pricingRule.deleteMany({ where: { id: { in: pricingIds } } }),
        prisma.user.deleteMany({ where: { id: { in: fixtureIds } } }),
      ]);
    }
  } finally {
    await prisma.$disconnect();
  }
}
