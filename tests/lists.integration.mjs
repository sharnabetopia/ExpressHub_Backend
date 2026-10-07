import "dotenv/config";
import "./helpers/typescript.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server.js";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = randomUUID().repeat(2);
const { default: prisma } = await import("../lib/prisma.ts");
const { signAccessToken } = await import("../lib/auth/tokens.ts");
const routes = {};
for (const path of ["shipments", "shipments/search", "shipments/my-shipments", "users", "payments/my-payments", "admin/shipments", "admin/users", "admin/audit-logs"]) {
  routes[path] = await import(`../app/api/v1/${path}/route.ts`);
}
const userIds = [], shipmentIds = [];
const marker = `list-${randomUUID()}`;
const at = new Date("2026-02-10T12:00:00Z");
async function user(role) {
  const value = await prisma.user.create({ data: { name: marker, email: `${randomUUID()}@example.com`, passwordHash: "fixture-only", role } });
  userIds.push(value.id);
  return value;
}
async function call(path, actor, query = {}) {
  const response = await routes[path].GET(new NextRequest(`http://localhost/api/v1/${path}?${typeof query === "string" ? query : new URLSearchParams(query)}`, {
    headers: { authorization: `Bearer ${signAccessToken({ userId: actor.id, role: actor.role })}` },
  }));
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, ...(await response.json()) };
}
try {
  const admin = await user("ADMIN"), customer = await user("CUSTOMER"), other = await user("CUSTOMER"), courier = await user("COURIER");
  async function shipment(extra = {}) {
    const value = await prisma.shipment.create({ data: { customerId: customer.id, courierId: courier.id,
      trackingNumber: `${marker}-${shipmentIds.length}`, pickupContactName: "Sender", pickupContactPhone: "01700000000",
      pickupAddress: "Dhaka central", deliveryContactName: "Recipient", deliveryContactPhone: "01800000000",
      deliveryAddress: "Chattogram", parcelWeightKg: 1, price: "20.10", currency: "BDT", status: "IN_TRANSIT", paymentStatus: "PAID", createdAt: at, ...extra } });
    shipmentIds.push(value.id);
    return value;
  }
  const first = await shipment(), second = await shipment();
  await shipment({ status: "CREATED" });
  await shipment({ paymentStatus: "PENDING" });
  await shipment({ createdAt: new Date("2026-02-11T12:00:00Z") });
  await shipment({ deletedAt: at });
  const foreign = await shipment({ customerId: other.id, courierId: null });
  const filter = { q: `  ${marker.toUpperCase()}  `, status: "IN_TRANSIT", paymentStatus: "PAID",
    from: "2026-02-10T18:00:00+06:00", to: at.toISOString(), sortBy: "price", order: "asc", limit: "1" };
  for (const path of ["shipments", "shipments/search", "shipments/my-shipments"]) {
    for (const actor of [customer, courier]) {
      const pages = [];
      for (const page of [1, 2]) {
        const result = await call(path, actor, { ...filter, page: String(page) });
        assert.equal(result.status, 200);
        assert.deepEqual(result.data.pagination, { page, limit: 1, total: 2, totalPages: 2 });
        pages.push(result.data.shipments[0].id);
      }
      assert.deepEqual(pages, [first.id, second.id].sort());
      const empty = await call(path, actor, { ...filter, page: "3" });
      assert.equal(empty.data.shipments.length, 0);
      assert.equal(empty.data.pagination.total, 2);
    }
  }
  const across = await call("admin/shipments", admin, { ...filter, limit: "100" });
  assert.equal(across.data.pagination.total, 3);
  assert.ok(across.data.shipments.some((row) => row.id === foreign.id));
  assert.equal((await call("shipments/my-shipments", admin, filter)).data.pagination.total, 0);
  assert.equal((await call("shipments/search", customer)).status, 400);
  assert.equal((await call("shipments/search", customer, { q: foreign.trackingNumber })).data.pagination.total, 0);
  assert.equal((await call("shipments/search", courier, { q: foreign.trackingNumber })).data.pagination.total, 0);
  const expensive = await shipment({ price: "100.01" });
  for (const [order, expected] of [["asc", expensive.id], ["desc", first.id]]) {
    const result = await call("shipments", customer, { q: marker, sortBy: "price", order, limit: "100" });
    if (order === "asc") assert.equal(result.data.shipments.at(-1).id, expected);
    else assert.equal(result.data.shipments[0].id, expensive.id);
  }
  for (const path of ["users", "admin/users"]) {
    const result = await call(path, admin, { q: marker.toUpperCase(), role: "CUSTOMER", isActive: "true", limit: "1", sortBy: "name", order: "asc" });
    assert.equal(result.data.pagination.total, 2);
    assert.equal(result.data.users[0].id, [customer.id, other.id].sort()[0]);
  }
  // Query validation must agree across all list handlers, including Admin aliases.
  for (const path of Object.keys(routes)) {
    const actor = path.startsWith("admin/") || path === "users" ? admin : customer;
    for (const query of ["page=0", "page=-1", "page=1.5", "page=1e2", "page=1000001", "limit=101", "limit=", "limit=01", "page=1&page=2", "unknown=1"]) {
      assert.equal((await call(path, actor, query)).status, 400, `${path}?${query}`);
    }
  }
  for (const query of [{ q: " " }, { sortBy: "customerId" }, { order: "up" }, { from: "yesterday" },
    { from: "2026-02-11T00:00:00Z", to: "2026-02-10T00:00:00Z" }]) {
    assert.equal((await call("shipments", customer, query)).status, 400);
  }
  console.info("List integration passed: combined search/status/payment/date filters, timezone boundaries, numeric sorting, tied pagination, role scopes, deletion exclusion and consistent query rejection across eight routes.");
} finally {
  try {
    if (userIds.length) await prisma.$transaction([
      prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    ]);
  } finally { await prisma.$disconnect(); }
}
