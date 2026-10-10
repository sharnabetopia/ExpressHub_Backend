# ExpressHub API documentation (Step 15)

Import [the Postman v2.1 collection](postman/ExpressHub.postman_collection.json).
It contains all 32 implemented method/path combinations, plus a separate
cancellation example using the shipment status endpoint. Saved responses are
illustrative examples, not records from a running database.

## Setup and authentication

1. Use Node.js 24, install dependencies with `npm ci`, and copy `.env.example`
   to your private `.env`. Configure PostgreSQL `DATABASE_URL`, a private
   `JWT_ACCESS_SECRET` of at least 32 bytes, and `ALLOWED_ORIGIN`.
2. Run `npm run prisma:migrate:deploy` and `npm run dev`. Production additionally
   requires HTTPS and Upstash configuration; see [security](security.md).
3. Import the collection in Postman. Set its `baseUrl` (no trailing slash),
   `email`, and `password` variables locally. Passwords for registration require
   at least 12 characters and at most 72 UTF-8 bytes. No credentials ship with
   the collection. Avoid environment variables with the same names: they
   override the collection values that scripts update.
4. Send Register or Login. Its post-response script saves `data.accessToken`
   to the collection's `accessToken`. Protected requests inherit Bearer auth.
   Keep the cookie jar enabled: refresh and logout use `expresshub_refresh`,
   not the bearer token. Refresh saves the rotated access token automatically.
5. Set `userId` and `courierId` to actual IDs from your database/API. Create
   shipment saves `shipmentId` automatically. IDs are CUIDs, not email addresses.
   Login as the appropriate account before sending a request for a different
   role. Logout clears the collection token, but server-side access JWTs remain
   valid until expiry unless the account is deactivated/deleted.

Send requests individually in the order appropriate to the account and resource.
This collection is a reference, not a whole-collection automated scenario:
role changes, cancellation and deletion modify records and have prerequisites.
Keep populated tokens/passwords private when exporting or sharing it.

## Payment-free walkthrough

Payment provider setup and real Checkout acceptance are deferred. This walkthrough
works without starting a payment attempt:

1. Check Health, register/login a Customer, fetch and update the profile.
2. Configure one matching active pricing rule as described in
   [shipments](shipments.md), then create a shipment. List, search and inspect it.
3. Bootstrap an Admin using the documented [authentication setup](authentication.md).
   Register a separate prospective courier account, login as Admin, and set that
   account's role to COURIER. Use its ID as `courierId`.
4. Assign the courier with `expectedCourierId: null`; inspect the Admin dashboard,
   shipment list and audit log. Login as Courier to inspect assigned shipments.
5. Login as the owning Customer and send Cancel uncollected shipment. Login as
   Admin to soft-delete that cancelled shipment and inspect its retained audit.

Pickup and delivery still require verified payment. Skipping payment work does
not bypass that business rule. The collection's payment folder documents existing
endpoints for completeness; omit it from this walkthrough. Actual Checkout,
signed webhook delivery and refunds remain a separate [payment acceptance](payments.md)
task. The webhook sample is deliberately unsigned and cannot confirm payment.

## Request and response contract

JSON writes require `Content-Type: application/json`; ordinary JSON bodies are
limited to 16 KiB. Strict schemas reject unknown fields. Lists reject unknown or
duplicate parameters, allow only supported sort fields, and default to page 1,
limit 20 (maximum 100). See the [complete query matrix](list-queries.md).

Successful JSON responses use `{ "success": true, "message": "…", "data": … }`.
Creation returns 201; other successful operations return 200. Lists expose their
named array and `pagination: { page, limit, total, totalPages }`. Decimal monetary
and parcel values serialize as strings. Errors use
`{ "success": false, "message": "…", "errors": […] }`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid input, query or webhook |
| 401 | Missing/expired token or inactive/deleted account |
| 403 | Role or origin denied |
| 404 | Missing, deleted or out-of-scope record; unknown API path |
| 409 | Duplicate email, stale state, invalid transition or deletion guard |
| 413 / 415 | Oversized body / unsupported media type |
| 429 | Rate limit; observe `Retry-After` |
| 500 | Unexpected server error; internal details hidden |
| 502 / 503 | Provider failure / unavailable dependency or configuration |

JSON responses are `no-store`. HEAD is bodyless; CORS preflight is empty 204.
Unsupported methods on existing routes use Next.js's automatic 405. Unknown API
paths use the JSON catch-all. See [validation and errors](validation-errors.md).

## Endpoint reference

The collection supplies request bodies, query examples, per-request access rules,
and representative saved success/error responses. Detailed contracts:

| Area | Reference |
| --- | --- |
| Register, login, refresh, logout | [Authentication](authentication.md) |
| Profiles, user listing, role and activity | [Users](users.md) |
| Booking, assignment, timeline and lifecycle | [Shipments](shipments.md) |
| Dashboard, monitoring and audit queries | [Admin](admin.md) |
| Archival guards and retained history | [Soft deletion and audit](soft-delete-audit.md) |
| Search, filters, sorting and pagination | [List queries](list-queries.md) |
| Existing payment endpoints (deferred) | [Payments](payments.md) |
| CORS, quotas, credentials and deployment | [Security](security.md) |

Health is public at both `GET /api/v1/health` and `GET /api/health`; it checks
database connectivity and returns 503 when unavailable. There are no implemented
hub-management, pricing-management, public-tracking or manual payment-status APIs.
