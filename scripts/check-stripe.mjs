import "dotenv/config";
import Stripe from "stripe";

// Read-only diagnostics. Never print keys, signing secrets, raw provider errors or payloads.
const required = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL", "JWT_ACCESS_SECRET", "DATABASE_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing configuration: ${missing.join(", ")}`);
  process.exit(1);
}
const secret = process.env.STRIPE_SECRET_KEY;
if (!/^(sk|rk)_test_/.test(secret)) {
  console.error("This verification command requires a Stripe test key.");
  process.exit(1);
}
const events = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired", "charge.refunded", "refund.created", "refund.updated", "refund.failed"];
try {
  for (const key of ["STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL"]) {
    const url = new URL(process.env[key]);
    if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
      throw new Error("RETURN_URL");
    }
  }
  const stripe = new Stripe(secret, { timeout: 15000, maxNetworkRetries: 1 });
  await stripe.balance.retrieve();
  console.info("Stripe test API authentication: OK");
  const successUrl = new URL(process.env.STRIPE_SUCCESS_URL);
  if (["localhost", "127.0.0.1"].includes(successUrl.hostname)) {
    console.info("Local return URL configured. Use Stripe CLI forwarding; endpoint signing-secret delivery must be tested separately.");
  } else {
    const expected = `${successUrl.origin}/api/v1/payments/webhook`;
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 }).autoPagingToArray({ limit: 1000 });
    const endpoint = endpoints.find((item) => item.url === expected && item.status === "enabled" && !item.livemode);
    if (!endpoint) throw new Error("WEBHOOK_ENDPOINT");
    const absent = endpoint.enabled_events.includes("*") ? [] : events.filter((event) => !endpoint.enabled_events.includes(event));
    if (absent.length) {
      console.error(`Webhook subscription missing: ${absent.join(", ")}`);
      process.exitCode = 1;
    } else console.info("Public webhook URL and event subscriptions: OK");
  }
  console.info("Signing-secret correctness, deployed environment and payment settlement still require a real delivered event.");
} catch (error) {
  const reasons = { RETURN_URL: "Return URLs must use HTTPS (localhost HTTP is allowed for development).", WEBHOOK_ENDPOINT: "No enabled test webhook matches the return URL origin and /api/v1/payments/webhook." };
  console.error(reasons[error.message] ?? `Stripe check failed (${error.type ?? "configuration/network error"}; HTTP ${error.statusCode ?? "unavailable"}).`);
  process.exitCode = 1;
}
