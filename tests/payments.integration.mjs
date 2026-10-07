import "dotenv/config";
import "./helpers/typescript.mjs";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { NextRequest } from "next/server.js";
import Stripe from "stripe";

// Real development/test PostgreSQL, isolated fixtures, injected provider only.
// This never contacts Stripe or charges a card. HTTP routes retain the real SDK.
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = randomUUID().repeat(2);
process.env.STRIPE_SECRET_KEY = "sk_test_payment_integration";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_payment_integration";
process.env.STRIPE_SUCCESS_URL = "http://localhost:3000/success";
process.env.STRIPE_CANCEL_URL = "http://localhost:3000/cancel";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";
const { default: prisma } = await import("../lib/prisma.ts");
const { initiatePayment, processStripeEvent, getPayment } = await import("../services/payment.service.ts");
const { updateShipmentStatus } = await import("../services/shipment.service.ts");
const { signAccessToken } = await import("../lib/auth/tokens.ts");
const detailRoute = await import("../app/api/v1/payments/[id]/route.ts");
const listRoute = await import("../app/api/v1/payments/my-payments/route.ts");
const initiateRoute = await import("../app/api/v1/payments/initiate/route.ts");
const webhookRoute = await import("../app/api/v1/payments/webhook/route.ts");
const users = [], shipments = [], eventIds = [];
const sessions = new Map(), intents = new Map(), refunds = new Map(), keys = new Map();
let failCreate = false;
const gateway = {
  async create(params, key) {
    assert.deepEqual(params.allowed_payment_method_types, ["card"]);
    let session = keys.get(key);
    if (!session) {
      session = { id: `cs_test_${randomUUID()}`, mode: "payment", livemode: false,
        metadata: params.metadata, client_reference_id: params.client_reference_id,
        amount_total: params.line_items[0].price_data.unit_amount, currency: params.line_items[0].price_data.currency,
        status: "open", payment_status: "unpaid", payment_intent: null,
        url: "https://checkout.stripe.com/test-fixture", expires_at: params.expires_at };
      keys.set(key, session);
      sessions.set(session.id, session);
    }
    // Emulate Stripe having created a session before a network timeout.
    if (failCreate) throw new Error("simulated provider timeout");
    return structuredClone(session);
  },
  async retrieve(id) { assert.ok(sessions.has(id)); return structuredClone(sessions.get(id)); },
  async intent(id) { assert.ok(intents.has(id)); return structuredClone(intents.get(id)); },
  async refunds(id) { return structuredClone(refunds.get(id) ?? []); },
};
async function user(role) {
  const row = await prisma.user.create({ data: { name: "Payment Test", email: `${randomUUID()}@example.com`, passwordHash: "not-a-login-hash", role } });
  users.push(row.id);
  return row;
}
async function shipment(customer) {
  const row = await prisma.shipment.create({ data: { customerId: customer.id, trackingNumber: `TEST-${randomUUID()}`,
    pickupContactName: "Sender", pickupContactPhone: "01700000000", pickupAddress: "Test pickup",
    deliveryContactName: "Recipient", deliveryContactPhone: "01800000000", deliveryAddress: "Test delivery",
    parcelWeightKg: 1, price: "100.29", currency: "BDT" } });
  shipments.push(row.id);
  return row;
}
function event(type, object) {
  const value = { id: `evt_${randomUUID()}`, type, livemode: false, data: { object } };
  eventIds.push(value.id);
  return value;
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const processEvent = (value, provider = gateway) => processStripeEvent(value, hash(value), provider);
async function pay(paymentId) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const session = sessions.get(payment.providerReference);
  session.status = "complete";
  session.payment_status = "paid";
  session.payment_intent = `pi_${randomUUID()}`;
  intents.set(session.payment_intent, { id: session.payment_intent, status: "succeeded", amount: session.amount_total,
    amount_received: session.amount_total, currency: session.currency, metadata: session.metadata, livemode: false });
  return session;
}
const request = (path, actor, body, headers = {}) => new NextRequest(`http://localhost/api/v1/payments/${path}`, {
  method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...headers,
    ...(actor ? { authorization: `Bearer ${signAccessToken({ userId: actor.id, role: actor.role })}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
async function state(id, expected) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id }, include: { shipment: true } });
  assert.equal(payment.status, expected);
  assert.equal(payment.shipment.paymentStatus, expected);
  return payment;
}
try {
  await prisma.$connect();
  const customer = await user("CUSTOMER"), other = await user("CUSTOMER"), courier = await user("COURIER"), admin = await user("ADMIN");
  const booking = await shipment(customer), secondBooking = await shipment(customer);
  await assert.rejects(initiatePayment(other, booking.id, randomUUID(), gateway), { status: 404 });
  await assert.rejects(initiatePayment(courier, booking.id, randomUUID(), gateway), { status: 403 });
  const key = randomUUID();
  const concurrent = await Promise.allSettled([initiatePayment(customer, booking.id, key, gateway), initiatePayment(customer, booking.id, key, gateway)]);
  for (const result of concurrent) if (result.status === "rejected") assert.equal(result.reason.status, 409);
  const initial = await initiatePayment(customer, booking.id, key, gateway);
  const id = initial.payment.id;
  assert.ok(initial.checkoutUrl);
  assert.equal(keys.size, 1);
  assert.equal(await prisma.payment.count({ where: { shipmentId: booking.id } }), 1);
  await state(id, "PENDING");
  assert.equal((await prisma.payment.findUnique({ where: { id } })).amount.toString(), "100.29");
  await assert.rejects(initiatePayment(customer, secondBooking.id, key, gateway), { status: 409 });
  await assert.rejects(initiatePayment(customer, booking.id, randomUUID(), gateway), { status: 409 });
  await assert.rejects(updateShipmentStatus(customer, booking.id, { status: "CANCELLED", expectedStatus: "CREATED" }), { status: 409 });
  await assert.rejects(getPayment(other, id), { status: 404 });
  assert.equal((await getPayment(admin, id)).id, id);
  const context = { params: Promise.resolve({ id }) };
  assert.equal((await detailRoute.GET(request(id), context)).status, 401);
  assert.equal((await detailRoute.GET(request(id, courier), context)).status, 403);
  assert.equal((await detailRoute.GET(request(id, other), context)).status, 404);
  const detail = await detailRoute.GET(request(id, customer), context);
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get("cache-control"), "no-store");
  const safe = (await detail.json()).data.payment;
  for (const field of ["checkoutRequest", "idempotencyKey", "providerReference", "checkoutUrl"]) assert.equal(safe[field], undefined);
  assert.equal((await listRoute.GET(request("my-payments?page=1&page=2", customer))).status, 400);
  assert.equal((await listRoute.GET(request("my-payments?limit=101", customer))).status, 400);
  const list = await listRoute.GET(request("my-payments?limit=1", customer));
  assert.equal((await list.json()).data.pagination.total, 1);
  const empty = await listRoute.GET(request("my-payments", other));
  assert.equal((await empty.json()).data.pagination.total, 0);
  assert.equal((await initiateRoute.POST(request("initiate", customer, { shipmentId: booking.id }))).status, 400);
  assert.equal((await initiateRoute.POST(request("initiate", customer, { shipmentId: booking.id, amount: 1 }, { "idempotency-key": randomUUID() }))).status, 400);

  const session = await pay(id);
  const completed = event("checkout.session.completed", { id: session.id });
  session.amount_total += 1;
  await assert.rejects(processEvent(completed), { status: 400 });
  await state(id, "PENDING");
  session.amount_total -= 1;
  await processEvent(completed);
  await state(id, "PAID");
  assert.equal((await processEvent(completed)).duplicate, true);
  await assert.rejects(processStripeEvent(completed, "changed-body", gateway), { status: 400 });
  assert.equal(await prisma.auditLog.count({ where: { paymentId: id, action: "PAYMENT_STATUS_UPDATED" } }), 1);
  assert.equal((await initiatePayment(customer, booking.id, key, gateway)).checkoutUrl, null);

  // A stale PAID observation must not overwrite a concurrently accepted refund.
  let release, observed;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { observed = resolve; });
  const staleEvent = event("checkout.session.completed", { id: session.id });
  const stale = processEvent(staleEvent, { ...gateway, async refunds() { observed(); await gate; return []; } });
  const staleResult = stale.then(() => null, (error) => error);
  await started;
  refunds.set(session.payment_intent, [{ payment_intent: session.payment_intent, currency: "bdt", amount: 10029, status: "pending" }]);
  await processEvent(event("refund.created", { payment_intent: session.payment_intent }));
  release();
  assert.equal((await staleResult).status, 503);
  await state(id, "REFUND_PENDING");
  await processEvent(staleEvent);
  await state(id, "REFUND_PENDING");
  refunds.get(session.payment_intent)[0].status = "failed";
  await processEvent(event("refund.failed", { payment_intent: session.payment_intent }));
  await state(id, "PAID");
  refunds.set(session.payment_intent, [{ payment_intent: session.payment_intent, currency: "bdt", amount: 5029, status: "succeeded" }]);
  await processEvent(event("charge.refunded", { payment_intent: session.payment_intent }));
  await state(id, "REFUND_PENDING");
  refunds.get(session.payment_intent).push({ payment_intent: session.payment_intent, currency: "bdt", amount: 5000, status: "succeeded" });
  await processEvent(event("refund.updated", { payment_intent: session.payment_intent }));
  const refunded = await state(id, "REFUNDED");
  assert.ok(refunded.paidAt && refunded.refundedAt);
  await processEvent(event("checkout.session.expired", { id: session.id }));
  await state(id, "REFUNDED");

  const uncertainKey = randomUUID();
  failCreate = true;
  await assert.rejects(initiatePayment(customer, secondBooking.id, uncertainKey, gateway), { status: 502 });
  await assert.rejects(initiatePayment(customer, secondBooking.id, randomUUID(), gateway), { status: 409 });
  failCreate = false;
  const recovered = await initiatePayment(customer, secondBooking.id, uncertainKey, gateway);
  assert.equal(keys.size, 2);
  const recoveredPayment = await state(recovered.payment.id, "PENDING");
  const expiredSession = sessions.get(recoveredPayment.providerReference);
  expiredSession.status = "expired";
  const expiredEvent = event("checkout.session.expired", { id: expiredSession.id });
  await processEvent(expiredEvent);
  await state(recovered.payment.id, "FAILED");
  const retried = await initiatePayment(customer, secondBooking.id, randomUUID(), gateway);
  assert.notEqual(retried.payment.id, recovered.payment.id);
  await processEvent(event("checkout.session.expired", { id: expiredSession.id }));
  await state(retried.payment.id, "PENDING");

  // Route-level signature checking, ignored events and durable deduplication.
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const ignored = event("customer.created", { id: "cus_test" });
  const raw = JSON.stringify(ignored);
  const signed = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const webhookRequest = (signature) => new Request("http://localhost/api/v1/payments/webhook", { method: "POST", body: raw,
    headers: signature ? { "stripe-signature": signature } : {} });
  assert.equal((await webhookRoute.POST(webhookRequest())).status, 400);
  const accepted = await webhookRoute.POST(webhookRequest(signed));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).data.ignored, true);
  assert.equal((await (await webhookRoute.POST(webhookRequest(signed))).json()).data.duplicate, true);
  await prisma.user.update({ where: { id: customer.id }, data: { isActive: false } });
  assert.equal((await detailRoute.GET(request(id, customer), context)).status, 401);
  console.info("Payment integration passed: routes, ownership, idempotency, concurrent initiation, cancellation guard, exact pricing, mismatch rejection, webhook replay, stale observations, refunds, expiry and uncertain-provider recovery.");
} finally {
  try {
    await prisma.$transaction([
      prisma.paymentWebhookEvent.deleteMany({ where: { providerEventId: { in: eventIds } } }),
      prisma.auditLog.deleteMany({ where: { shipmentId: { in: shipments } } }),
      prisma.payment.deleteMany({ where: { shipmentId: { in: shipments } } }),
      prisma.shipment.deleteMany({ where: { id: { in: shipments } } }),
      prisma.user.deleteMany({ where: { id: { in: users } } }),
    ]);
  } finally { await prisma.$disconnect(); }
}
