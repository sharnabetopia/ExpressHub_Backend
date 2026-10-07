import "./helpers/typescript.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server.js";

process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_local_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_fixture";
process.env.STRIPE_SUCCESS_URL = "http://localhost:3000/success";
process.env.STRIPE_CANCEL_URL = "http://localhost:3000/cancel";
process.env.ALLOWED_ORIGIN = "http://localhost:3000";
const { amountInMinorUnits, checkoutConfiguration, verifyStripeEvent, readWebhookBody, stripeGateway } = await import("../lib/payments/stripe.ts");
const { initiatePaymentSchema, listPaymentsSchema, paymentIdempotencySchema } = await import("../validators/payment.ts");
const { proxy } = await import("../proxy.ts");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sign = (payload, timestamp) => stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET, timestamp });

test("decimal amounts are exact and unsupported currencies/amounts fail closed", () => {
  assert.equal(amountInMinorUnits(new Prisma.Decimal("100.29"), "BDT"), 10029);
  for (const [amount, currency] of [["0", "USD"], ["-1", "USD"], ["1.001", "USD"], ["1000000", "USD"], ["100", "JPY"]]) {
    assert.throws(() => amountInMinorUnits(new Prisma.Decimal(amount), currency), { status: 422 });
  }
});

test("checkout configuration requires credentials and safe server return URLs", () => {
  assert.equal(checkoutConfiguration().live, false);
  const previous = process.env.STRIPE_SUCCESS_URL;
  for (const value of ["invalid", "javascript:alert(1)", "http://external.example/success", "https://user:pass@example.com/"]) {
    process.env.STRIPE_SUCCESS_URL = value;
    assert.throws(checkoutConfiguration, { status: 503 });
  }
  process.env.STRIPE_SUCCESS_URL = previous;
  process.env.NODE_ENV = "production";
  assert.throws(checkoutConfiguration, { status: 503 });
  process.env.NODE_ENV = "test";
  const secret = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "";
  assert.throws(checkoutConfiguration, { status: 503 });
  process.env.STRIPE_SECRET_KEY = secret;
});

test("webhooks require the original signed body, a recent signature and the matching mode/account", () => {
  const event = { id: "evt_test", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test" } } };
  const raw = JSON.stringify(event);
  assert.equal(verifyStripeEvent(Buffer.from(raw), sign(raw)).id, event.id);
  for (const [body, signature] of [[raw, null], [raw + " ", sign(raw)], [raw, sign(raw, 1)]]) {
    assert.throws(() => verifyStripeEvent(Buffer.from(body), signature), { status: 400 });
  }
  for (const override of [{ livemode: true }, { account: "acct_other" }]) {
    const body = JSON.stringify({ ...event, ...override });
    assert.throws(() => verifyStripeEvent(Buffer.from(body), sign(body)), { status: 400 });
  }
});

test("webhook stream has a size bound even without Content-Length", async () => {
  const request = (body, headers) => new Request("http://localhost", { method: "POST", body, headers });
  assert.equal((await readWebhookBody(request('{"hello":1}'))).toString(), '{"hello":1}');
  await assert.rejects(readWebhookBody(request("x".repeat(262145))), { status: 413 });
  await assert.rejects(readWebhookBody(request("x", { "content-length": "262145" })), { status: 413 });
  await assert.rejects(readWebhookBody(request()), { status: 400 });
});

test("payment input rejects price/status injection and unbounded pagination", () => {
  const shipmentId = "cm123456789012345678901234";
  assert.equal(initiatePaymentSchema.safeParse({ shipmentId }).success, true);
  for (const extra of [{ amount: 1 }, { status: "PAID" }, { payerId: shipmentId }]) {
    assert.equal(initiatePaymentSchema.safeParse({ shipmentId, ...extra }).success, false);
  }
  assert.equal(paymentIdempotencySchema.safeParse("reuse-me").success, false);
  for (const query of [{ page: "0" }, { limit: "101" }, { status: "SUCCESS" }, { payerId: shipmentId }]) {
    assert.equal(listPaymentsSchema.safeParse(query).success, false);
  }
});

test("CORS permits the Idempotency-Key used by browser checkout requests", () => {
  const response = proxy(new NextRequest("http://localhost/api/v1/payments/initiate", {
    method: "OPTIONS", headers: { origin: process.env.ALLOWED_ORIGIN, "access-control-request-headers": "idempotency-key" },
  }));
  assert.equal(response.status, 204);
  assert.match(response.headers.get("access-control-allow-headers"), /Idempotency-Key/);
});

test("Stripe adapter passes the provider idempotency key and retrieves all refund pages", async () => {
  const client = {
    checkout: { sessions: { create: async (params, options) => ({ params, options }), retrieve: async (id) => id } },
    paymentIntents: { retrieve: async (id) => id },
    refunds: { list: (params) => ({ autoPagingToArray: async (options) => ({ params, options }) }) },
  };
  const gateway = stripeGateway(client);
  assert.deepEqual(await gateway.create({ mode: "payment" }, "key"), { params: { mode: "payment" }, options: { idempotencyKey: "key" } });
  assert.deepEqual(await gateway.refunds("pi_test"), { params: { payment_intent: "pi_test", limit: 100 }, options: { limit: 1000 } });
});
