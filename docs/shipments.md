# Shipment APIs (Step 8)

All endpoints require `Authorization: Bearer <accessToken>`. Writes require
`Content-Type: application/json`. Customers see their own shipments, Couriers see
their assigned shipments, and Admins see all non-deleted shipments. Unauthorized
record lookup returns 404. Contact/address details are only available within that
scope; these are not public tracking endpoints.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/v1/shipments` | Customer creates a shipment |
| GET | `/api/v1/shipments` | List within the caller's access scope |
| GET | `/api/v1/shipments/:id` | Shipment detail within that scope |
| PATCH | `/api/v1/shipments/:id/assign-courier` | Admin assignment/reassignment |
| PATCH | `/api/v1/shipments/:id/status` | Authorized lifecycle change |
| GET | `/api/v1/shipments/my-shipments` | Own Customer shipments or assigned Courier shipments; Admin's own historical bookings |
| GET | `/api/v1/shipments/search?q=keyword` | Search within the caller's scope |

## Pricing setup

Before booking, configure `PricingRule` records in the development database using
your database administration tooling (for example, `npx prisma studio`). The API
requires exactly one active rule covering the parcel weight at booking time.
`minWeightKg` and `maxWeightKg` are inclusive; configure adjacent tiers without
overlap (e.g. 0.001–1.000 and 1.001–2.000). `effectiveFrom` is inclusive and
`effectiveTo` is exclusive (null means no end). Overlapping or missing rules return
503 `PRICING_UNAVAILABLE`; no fallback price is invented.

The rule must specify a nonnegative base fee and additional-per-kg fee, and a
three-uppercase-letter currency. The final price must be positive and fit the
database amount field. Calculation uses decimal arithmetic:

```text
price = baseFee + ceil(weightKg - minWeightKg) × additionalPerKgFee
```

For example, a rule with minimum 1 kg, base fee 100 and additional fee 20 quotes
120 for 1.5 kg. This is an illustrative configuration, not an installed rate.
The shipment stores the quoted amount and currency; later rate edits do not
change existing bookings. The creation audit records the pricing-rule ID.
No schema migration or production pricing change is performed by this step.

## Create

```http
POST /api/v1/shipments
Authorization: Bearer <customerAccessToken>
Content-Type: application/json

{
  "pickupContactName": "Example Sender",
  "pickupContactPhone": "+8801700000000",
  "pickupAddress": "123 Example Road, Dhaka",
  "deliveryContactName": "Example Recipient",
  "deliveryContactPhone": "+8801800000000",
  "deliveryAddress": "456 Example Road, Chattogram",
  "parcelWeightKg": 1.5,
  "packageDescription": "Books",
  "parcelLengthCm": 30,
  "parcelWidthCm": 20,
  "parcelHeightCm": 10
}
```

Names require 2–100 characters, phones 5–30, addresses 5–500, and optional package
description 1–1000. Weight must be positive with at most three decimal places;
dimensions must be positive with at most two. Supply all three dimensions or omit
all of them. Optional `pickupScheduledAt` accepts a future ISO timestamp with a
timezone. Unknown fields—including price, currency, customerId, courierId and
paymentStatus—return 400. Only Customers can book.

Creation returns 201 with `data.shipment`, a unique `EH-` tracking number,
`status: CREATED`, and `paymentStatus: PENDING`. Decimal values serialize as
strings. Shipment, initial event and audit entry are saved atomically. Tracking
collisions are retried within a bounded three-attempt transaction loop.

## Assign

```json
{"courierId":"<activeCourierId>","expectedCourierId":null}
```

Send this to `PATCH /shipments/:id/assign-courier` as Admin. Initial assignment
expects null; reassignment must supply the existing courier ID. A stale expected
value returns 409. Assignment is allowed only in CREATED or FAILED and only to
an active, non-deleted COURIER. Repeating the current assignment produces no
duplicate event. Assignment may precede payment; pickup cannot.

## Status changes

```json
{"expectedStatus":"CREATED","status":"PICKED_UP"}
```

Send to `PATCH /shipments/:id/status`. `expectedStatus` is required; stale values
return 409. The permitted transitions are:

```text
CREATED → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
CREATED → CANCELLED
OUT_FOR_DELIVERY → FAILED
FAILED → IN_TRANSIT (Admin retry) or RETURNED (Admin)
```

Customers can only cancel their own CREATED shipments. Assigned Couriers handle
pickup, transit and delivery attempts; Admins can perform operational changes,
cancellation, retries and returns. All transitions except cancellation and return
require PAID and an active assigned Courier. DELIVERED, RETURNED and CANCELLED
are terminal, including for Admins.

DELIVERED requires a `note` confirming receipt; FAILED and RETURNED require a
reason in `note` (3–1000 characters). Delivery sets `deliveredAt` server-side.
Notes are stored as internal event details and are not exposed by shipment reads.
Every successful transition writes actor, time, old/new status and audit history
in the same transaction. Serializable retries and expected-state checks prevent
duplicate transitions and competing assignment overwrites.

No client-facing endpoint can manually mark a shipment paid. Newly booked shipments
cannot progress to pickup until the existing payment webhook verifies settlement.
Returns and cancellations do not automatically initiate refunds.

## Lists and search

Supported query parameters on all three list routes:

- `page`: default 1, maximum 1,000,000; `limit`: default 20, maximum 100.
- `status` and `paymentStatus`: exact enum values.
- `q`: 1–100 trimmed characters; required on `/search`. Matches tracking number,
  pickup/delivery contact names and addresses case-insensitively.
- `from` and `to`: ISO timestamps with timezone, filtering creation time inclusively.
- `sortBy`: createdAt (default), updatedAt or price; `order`: desc (default) or asc.

Unknown and duplicate parameters are rejected. Results return `data.shipments`
and `data.pagination: { page, limit, total, totalPages }`. Lists use a stable ID
tie-breaker and a consistent snapshot for rows and count. All reads and writes
exclude soft-deleted shipments.

## Verification

`npm run test:shipments:integration` uses Node.js 24, the configured development
database, and a local Next server on port 3199 (`SHIPMENT_TEST_PORT` override).
It creates and removes temporary users, pricing rules, shipments, sessions,
events and audits. Paid/failed states are isolated database test fixtures; they
do not represent real payment verification. Do not run on production or alongside
another `next dev` process in the checkout. The test's weight tier 9876–9877 kg
must not overlap an existing active rule.
