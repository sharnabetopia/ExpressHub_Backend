import "dotenv/config";
import "./helpers/typescript.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server.js";
import bcrypt from "bcryptjs";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = randomUUID().repeat(2);
const { default: prisma } = await import("../lib/prisma.ts");
const { signAccessToken, hashRefreshToken } = await import("../lib/auth/tokens.ts");
const { loginUser, rotateRefreshToken } = await import("../services/auth.service.ts");
const { softDeleteUser, updateUserAccess } = await import("../services/user.service.ts");
const { softDeleteShipment, updateShipmentStatus, assignCourier } = await import("../services/shipment.service.ts");
const { getPayment } = await import("../services/payment.service.ts");
const routes = {
  users: await import("../app/api/v1/users/[id]/route.ts"),
  shipments: await import("../app/api/v1/shipments/[id]/route.ts"),
};
const userList = await import("../app/api/v1/users/route.ts");
const shipmentList = await import("../app/api/v1/shipments/route.ts");
const auditList = await import("../app/api/v1/admin/audit-logs/route.ts");
const userIds = [], shipmentIds = [];
let rejectAudit = false;
prisma.$use(async (params, next) => {
  if (rejectAudit && params.model === "AuditLog" && params.action === "create" && params.args.data.action.endsWith("SOFT_DELETED")) {
    throw new Error("Test-only simulated audit write failure");
  }
  return next(params);
});
const password = randomUUID();
async function user(role) {
  const value = await prisma.user.create({ data: { name: "Deletion Test", email: `${randomUUID()}@example.com`, role, passwordHash: await bcrypt.hash(password, 4) } });
  userIds.push(value.id);
  return value;
}
function request(actor, method = "GET", body, url = "http://localhost/api/v1/users") {
  return new NextRequest(url, { method, headers: { "content-type": "application/json",
    ...(actor ? { authorization: `Bearer ${signAccessToken({ userId: actor.id, role: actor.role })}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function call(resource, actor, id, method = "DELETE", body = { reason: "Archive resolved record" }) {
  const response = await routes[resource][method](request(actor, method, method === "GET" ? undefined : body), { params: Promise.resolve({ id }) });
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, ...(await response.json()) };
}
async function shipment(customer, courier, status = "CANCELLED") {
  const value = await prisma.shipment.create({ data: { customerId: customer.id, courierId: courier?.id, status,
    trackingNumber: `TEST-${randomUUID()}`, pickupContactName: "Sender", pickupContactPhone: "01700000000", pickupAddress: "Test pickup",
    deliveryContactName: "Recipient", deliveryContactPhone: "01800000000", deliveryAddress: "Test delivery", parcelWeightKg: 1, price: "10.00", currency: "BDT" } });
  shipmentIds.push(value.id);
  return value;
}
try {
  const admin = await user("ADMIN"), customer = await user("CUSTOMER"), courier = await user("COURIER");
  const booking = await shipment(customer, courier, "CREATED");
  for (const [resource, id] of [["users", customer.id], ["shipments", booking.id]]) {
    assert.equal((await call(resource, null, id)).status, 401);
    for (const actor of [customer, courier]) assert.equal((await call(resource, actor, id)).status, 403);
    for (const body of [{}, { reason: " " }, { reason: "x".repeat(1001) }, { reason: "Remove", deletedAt: "2026-01-01" }]) {
      assert.equal((await call(resource, admin, id, "DELETE", body)).status, 400);
    }
    assert.equal((await call(resource, admin, "bad-id")).status, 400);
  }
  assert.equal((await call("users", admin, admin.id)).status, 409);
  assert.equal((await call("users", admin, customer.id)).status, 409);
  assert.equal((await call("users", admin, courier.id)).status, 409);
  assert.equal((await call("shipments", admin, booking.id)).status, 409);
  // Every nonterminal state is protected, including FAILED awaiting intervention.
  for (const status of ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "FAILED"]) {
    await prisma.shipment.update({ where: { id: booking.id }, data: { status } });
    assert.equal((await call("shipments", admin, booking.id)).status, 409);
  }
  await prisma.shipment.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
  const payment = await prisma.payment.create({ data: { shipmentId: booking.id, payerId: customer.id, provider: "STRIPE", amount: 10, currency: "BDT", idempotencyKey: randomUUID() } });
  for (const status of ["PENDING", "REFUND_PENDING"]) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status } });
    assert.equal((await call("shipments", admin, booking.id)).status, 409);
    assert.equal((await call("users", admin, customer.id)).status, 409);
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
  const event = await prisma.shipmentEvent.create({ data: { shipmentId: booking.id, actorId: customer.id, type: "CUSTOMER_CANCELLED", toStatus: "CANCELLED" } });
  rejectAudit = true;
  await assert.rejects(softDeleteShipment(admin, booking.id, "Archive test"), /simulated audit/);
  assert.equal((await prisma.shipment.findUnique({ where: { id: booking.id } })).deletedAt, null);
  rejectAudit = false;
  const results = await Promise.all([call("shipments", admin, booking.id), call("shipments", admin, booking.id)]);
  assert.deepEqual(results.map((value) => value.status).sort(), [200, 404]);
  assert.ok((await prisma.shipment.findUnique({ where: { id: booking.id } })).deletedAt);
  assert.ok(await prisma.shipmentEvent.findUnique({ where: { id: event.id } }));
  assert.equal((await getPayment(admin, payment.id)).id, payment.id);
  assert.equal((await call("shipments", admin, booking.id, "GET")).status, 404);
  assert.equal((await call("shipments", admin, booking.id)).status, 404);
  await assert.rejects(assignCourier(admin, booking.id, { courierId: courier.id, expectedCourierId: courier.id }), { status: 404 });
  await assert.rejects(updateShipmentStatus(admin, booking.id, { expectedStatus: "CANCELLED", status: "PICKED_UP" }), { status: 404 });
  const listed = await shipmentList.GET(request(admin, "GET", undefined, `http://localhost/api/v1/shipments?q=${booking.trackingNumber}`));
  assert.equal((await listed.json()).data.pagination.total, 0);
  for (const status of ["DELIVERED", "RETURNED"]) {
    const terminal = await shipment(customer, courier, status);
    assert.equal((await call("shipments", admin, terminal.id)).status, 200);
    assert.equal((await prisma.shipment.findUnique({ where: { id: terminal.id } })).status, status);
  }

  const refresh = randomUUID();
  const session = await prisma.refreshToken.create({ data: { userId: customer.id, tokenHash: hashRefreshToken(refresh), expiresAt: new Date(Date.now() + 60000) } });
  rejectAudit = true;
  await assert.rejects(softDeleteUser(admin, customer.id, "Archive test"), /simulated audit/);
  assert.equal((await prisma.user.findUnique({ where: { id: customer.id } })).deletedAt, null);
  assert.equal((await prisma.refreshToken.findUnique({ where: { id: session.id } })).revokedAt, null);
  rejectAudit = false;
  const deletions = await Promise.all([call("users", admin, customer.id), call("users", admin, customer.id)]);
  assert.deepEqual(deletions.map((value) => value.status).sort(), [200, 404]);
  const stored = await prisma.user.findUnique({ where: { id: customer.id } });
  assert.ok(stored.deletedAt);
  assert.equal(stored.isActive, false);
  assert.ok((await prisma.refreshToken.findUnique({ where: { id: session.id } })).revokedAt);
  await assert.rejects(loginUser({ email: customer.email, password }), { status: 401 });
  await assert.rejects(rotateRefreshToken(refresh), { status: 401 });
  assert.equal((await call("users", customer, customer.id, "GET")).status, 401);
  assert.equal((await call("users", admin, customer.id, "GET")).status, 404);
  await assert.rejects(updateUserAccess(admin, customer.id, { isActive: true }), { status: 404 });
  const listedUsers = await userList.GET(request(admin, "GET", undefined, `http://localhost/api/v1/users?q=${customer.email}`));
  assert.equal((await listedUsers.json()).data.pagination.total, 0);
  for (const [entityId, action] of [[booking.id, "SHIPMENT_SOFT_DELETED"], [customer.id, "USER_SOFT_DELETED"]]) {
    const audits = await auditList.GET(request(admin, "GET", undefined, `http://localhost/api/v1/admin/audit-logs?entityId=${entityId}&action=${action}`));
    const data = (await audits.json()).data;
    assert.equal(data.pagination.total, 1);
    assert.equal(data.auditLogs[0].actorId, admin.id);
    assert.equal(data.auditLogs[0].details.reason, "Archive resolved record");
    assert.equal(data.auditLogs[0].details.before.deletedAt, null);
    assert.ok(data.auditLogs[0].details.after.deletedAt);
  }
  // Services recheck authority inside the write transaction, even for stale callers.
  await prisma.user.update({ where: { id: admin.id }, data: { role: "CUSTOMER" } });
  await assert.rejects(softDeleteUser(admin, courier.id, "Stale admin"), { status: 403 });
  await assert.rejects(softDeleteShipment(admin, booking.id, "Stale admin"), { status: 403 });
  console.info("Soft-delete integration passed: Admin guards, reasons, active-work/payment gates, terminal archival, rollback, concurrent deletes, session revocation, hidden records and retained payment/event/audit history.");
} finally {
  rejectAudit = false;
  try {
    if (userIds.length) await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { shipmentId: { in: shipmentIds } }] } }),
      prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } }),
      prisma.payment.deleteMany({ where: { shipmentId: { in: shipmentIds } } }),
      prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }),
      prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ]);
  } finally { await prisma.$disconnect(); }
}
