# Payments (Step 9)

ExpressHub uses Stripe-hosted Checkout for shipment payments. Application routes always call the real Stripe SDK. Only a signed webhook followed by server-side Stripe verification can confirm payment; redirects and client-supplied status/amount never do.

## Setup

1. Apply committed migrations with `npm run prisma:migrate:deploy`. The `20261005090000_stripe_checkout` migration adds Checkout storage and a partial unique index that permits only one pending/accepted payment per shipment. Retain this index in future migrations (Prisma 5 cannot describe it in the schema).
2. Set private `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` values. Use one Stripe test account/sandbox for development. Set `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` to your client's return pages. The example URLs are placeholders; this backend does not implement those pages. Production URLs require HTTPS. Never commit secrets.
3. Configure a **snapshot** webhook destination for your own Stripe account at `POST /api/v1/payments/webhook`, subscribing to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`
   - `refund.created`
   - `refund.updated`
   - `refund.failed`
4. Locally, run `stripe listen --forward-to localhost:3000/api/v1/payments/webhook` and use the printed `whsec_...` secret. Restart the application after changing its environment.
5. Configure the existing JWT and Upstash settings for production. Payment initiation is limited to 20 requests per customer per 15 minutes; development uses an in-process fallback.

The installed Stripe 23 SDK uses `allowed_payment_method_types` for Checkout creation. Checkout is card-only, with adaptive pricing disabled. Supported currencies are BDT, USD, EUR and GBP, subject to your Stripe account's actual currency/amount eligibility. Fees and prices come from the shipment's stored server quote and are converted with decimal arithmetic, never floating-point multiplication.

Provider references: [Stripe webhooks](https://docs.stripe.com/webhooks), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [refunds](https://docs.stripe.com/refunds). The raw webhook body is signature-checked before processing, as required by Stripe; events may be duplicated or delivered out of order.

## Endpoints

Protected routes require `Authorization: Bearer <access-token>` and return `Cache-Control: no-store`.

| Method | Path | Access / input |
|---|---|---|
| POST | `/api/v1/payments/initiate` | Customer owning an undeleted CREATED shipment; JSON `{ "shipmentId": "<id>" }`; UUID `Idempotency-Key` header required |
| GET | `/api/v1/payments/:id` | Paying customer or Admin; another customer gets 404, Courier gets 403 |
| GET | `/api/v1/payments/my-payments` | Customer/Admin's own payments; `page`, `limit` (max 100), optional `status` and `shipmentId` |
| POST | `/api/v1/payments/webhook` | No bearer token; requires a valid Stripe signature on the original request body |

```bash
curl -X POST http://localhost:3000/api/v1/payments/initiate \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $PAYMENT_REQUEST_UUID" \
  -d '{"shipmentId":"<shipment-id>"}'
```

Keep the same UUID for retries of that payment attempt. A successful response has the normal envelope:

```json
{
  "success": true,
  "message": "Payment checkout prepared",
  "data": {
    "payment": {
      "id": "<payment-id>",
      "shipmentId": "<shipment-id>",
      "payerId": "<customer-id>",
      "provider": "STRIPE",
      "amount": "100.29",
      "currency": "BDT",
      "status": "PENDING",
      "paidAt": null,
      "refundedAt": null,
      "createdAt": "<timestamp>",
      "updatedAt": "<timestamp>"
    },
    "checkoutUrl": "https://checkout.stripe.com/..."
  }
}
```

Open `checkoutUrl` to pay, then query payment detail for its verified status. `checkoutUrl` is null once the payment/session is no longer pending/open. Lists return `data.payments` and `data.pagination` (`page`, `limit`, `total`, `totalPages`). Payment reads retain financial history even when the associated shipment is soft-deleted; ownership still applies. Provider payloads, internal references and idempotency keys are excluded from read responses.

## Consistency and failure handling

- The database transaction reserves a PENDING attempt and saves immutable Checkout parameters, then the provider call runs outside the transaction. Retrying uses the same Stripe idempotency key and parameters. A new UUID cannot create a second active checkout for the same shipment.
- Timeouts return 502 and leave the reservation pending because Stripe might already have created the session. Retry the original UUID. Unresolved attempts without a saved reference older than 23 hours return 409 for operator reconciliation, avoiding recreation after provider idempotency retention.
- Server-side verification checks Checkout mode, payment/shipment/payer metadata, reference, exact amount, currency and test/live mode; accepted charges also require a successful matching PaymentIntent.
- Webhook event IDs and payload hashes provide durable deduplication. Payment/shipment status and audit entries commit together. Transient processing failures return 503 for retry, while invalid signatures or mismatched payment details return 400. Investigate mismatches; do not manually mark payments paid.
- Concurrent observations cannot overwrite a newer database result: the handler rejects a stale observation and asks Stripe to retry. Delayed unpaid/failed events cannot regress a paid/refunded payment. A late failure from an old attempt cannot overwrite a newer attempt.
- Leaving Checkout or reaching the cancel URL does not prove failure. The session stays PENDING until verified expiry/failure. A declined card can be retried within the same Checkout session. After verified FAILED status, initiate with a new UUID.
- Shipment cancellation is blocked while a payment is PENDING. Expire an open session in Stripe and allow its verified webhook to settle first. Cancelling a paid shipment does not automatically refund it.
- An authorized operator can issue refunds in Stripe Dashboard. This module reconciles provider-confirmed refunds; there is no manual status-update or refund-initiation API. A partial successful refund or outstanding refund maps conservatively to REFUND_PENDING, blocking dispatch. A full successful refund maps to REFUNDED. If all refunds fail/cancel and nothing was refunded, payment returns to PAID. Operational refund approval remains with Admin.
- Refund processing reads up to 1,000 provider refund records; exceeding that bound requires operator reconciliation rather than accepting an incomplete total. No new charge is allowed for a refunded shipment.

## Verification

```bash
npm run test:payments
npm run test:payments:integration
npm run typecheck
npm run build
```

Requires Node.js 24. Integration tests use the configured **development/test PostgreSQL database**, create uniquely identified fixtures, then remove them. They exercise actual services, transactions and Route Handlers with an injected in-memory Stripe gateway; they never make real charges or expose a fake provider through HTTP routes. Unit tests cover signature validation, exact amounts, bounded bodies, input validation and CORS.

Before deployment, complete a real Stripe **test-mode** acceptance check:

1. Start the API and Stripe CLI listener, configure its signing secret, and book a shipment using valid pricing.
2. Initiate payment, retain its UUID, open the returned Checkout URL and complete a Stripe test-card payment.
3. Verify both payment and shipment become PAID, exactly one status audit is recorded, and duplicate event delivery has no additional effect.
4. Exercise a declined card, abandon/expire a session, confirm FAILED, and initiate a new attempt with a new UUID.
5. Issue test partial/full refunds in Stripe Dashboard and confirm REFUND_PENDING/REFUNDED locally.

Automated tests do not substitute for this account-specific provider acceptance check. Live charging and a real Stripe test-mode checkout were not performed as part of local automated verification.
