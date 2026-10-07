import "server-only";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/http/errors";

export function paymentConfiguration() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !/^(sk|rk)_(test|live)_/.test(secret) || !webhookSecret?.startsWith("whsec_")) {
    throw new AppError(503, "Stripe credentials are not configured", "PAYMENT_CONFIGURATION");
  }
  return { secret, webhookSecret, live: secret.includes("_live_") };
}

export function checkoutConfiguration() {
  const configuration = paymentConfiguration();
  const successUrl = process.env.STRIPE_SUCCESS_URL;
  const cancelUrl = process.env.STRIPE_CANCEL_URL;
  for (const value of [successUrl, cancelUrl]) {
    let url: URL;
    try { url = new URL(value ?? ""); } catch {
      throw new AppError(503, "Stripe return URLs are not configured", "PAYMENT_CONFIGURATION");
    }
    if (url.username || url.password || (url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
      throw new AppError(503, "Stripe return URLs must use HTTPS", "PAYMENT_CONFIGURATION");
    }
  }
  return { ...configuration, successUrl: successUrl!, cancelUrl: cancelUrl! };
}

// Explicit two-decimal currencies avoid silently mischarging zero/three-decimal currencies.
export function amountInMinorUnits(amount: Prisma.Decimal, currency: string) {
  if (!["BDT", "USD", "EUR", "GBP"].includes(currency)) {
    throw new AppError(422, "Supported payment currencies are BDT, USD, EUR and GBP", "UNSUPPORTED_CURRENCY");
  }
  const minor = amount.times(100);
  if (!minor.isInteger() || minor.lte(0) || minor.gt(99_999_999)) {
    throw new AppError(422, "Payment amount is outside the supported range", "INVALID_PAYMENT_AMOUNT");
  }
  return minor.toNumber();
}

export function stripeClient() {
  return new Stripe(paymentConfiguration().secret, { timeout: 15000, maxNetworkRetries: 1 });
}

export interface PaymentGateway {
  create(params: Stripe.Checkout.SessionCreateParams, key: string): Promise<Stripe.Checkout.Session>;
  retrieve(id: string): Promise<Stripe.Checkout.Session>;
  intent(id: string): Promise<Stripe.PaymentIntent>;
  refunds(intentId: string): Promise<Stripe.Refund[]>;
}

// Dependency injection is for tests; application routes always use the real Stripe SDK.
export function stripeGateway(client = stripeClient()): PaymentGateway {
  return {
    create: (params, idempotencyKey) => client.checkout.sessions.create(params, { idempotencyKey }),
    retrieve: (id) => client.checkout.sessions.retrieve(id),
    intent: (id) => client.paymentIntents.retrieve(id),
    refunds: (payment_intent) => client.refunds.list({ payment_intent, limit: 100 }).autoPagingToArray({ limit: 1000 }),
  };
}

export function verifyStripeEvent(raw: Buffer, signature: string | null): Stripe.Event {
  const config = paymentConfiguration();
  if (!signature) throw new AppError(400, "Stripe signature is required", "INVALID_SIGNATURE");
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, signature, config.webhookSecret, 300);
  } catch {
    throw new AppError(400, "Invalid Stripe webhook signature or payload", "INVALID_SIGNATURE");
  }
  if (event.livemode !== config.live || event.account) {
    throw new AppError(400, "Stripe event account or mode does not match", "INVALID_STRIPE_EVENT");
  }
  return event;
}

export async function readWebhookBody(request: Request) {
  const limit = 256 * 1024;
  if (Number(request.headers.get("content-length")) > limit) {
    throw new AppError(413, "Webhook body is too large", "REQUEST_TOO_LARGE");
  }
  if (!request.body) throw new AppError(400, "Webhook body is required", "INVALID_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError(413, "Webhook body is too large", "REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}
