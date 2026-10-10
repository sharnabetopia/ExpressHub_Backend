# ExpressHub Payment Adaptation from RentNest

## Changed files
- `services/payment.controller.ts` — added controller-style shared handlers.
- `app/api/v1/payments/create/route.ts` — new `POST /create` alias for RentNest-style creation.
- `app/api/v1/payments/route.ts` — new `GET /payments` alias for history.
- `app/api/v1/payments/initiate/route.ts` — delegates to shared creation handler.
- `app/api/v1/payments/my-payments/route.ts` — delegates to shared history handler.
- `docs/payments.md` — updated API reference and rationale.

## Intentional compatibility decisions
- `shipmentId` replaces RentNest's `rentalRequestId`.
- `CUSTOMER` replaces RentNest's `TENANT` role.
- `Idempotency-Key` UUID header remains REQUIRED; retry with the same key.
- No client-driven payment confirmation: only verified Stripe webhook settlement.
- Existing ExpressHub payment records, Prisma schema, and secure Stripe implementation are preserved.
- Existing routes `/initiate`, `/my-payments`, `/:id`, `/webhook` remain intact.

## Quick test
```bash
# Requires a running configured app and customer bearer token
curl -X POST http://localhost:3000/api/v1/payments/create \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"shipmentId":"<shipment-id>"}'

curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  'http://localhost:3000/api/v1/payments?page=1&limit=10'
```

Run `npm ci`, `npm run typecheck`, `npm run test:payments`, and `npm run build` before deployment. Set Stripe secrets privately.
