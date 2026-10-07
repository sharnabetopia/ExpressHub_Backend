# Search, filtering, sorting and pagination (Step 11)

List routes require Bearer authentication and preserve their role/ownership rules. Search and filters narrow that authorized scope; they cannot expand it. Responses use `Cache-Control: no-store`.

## Query contract

- `page`: positive decimal integer, default `1`, maximum `1000000`.
- `limit`: positive decimal integer, default `20`, maximum `100`.
- Zero, negatives, fractions, scientific notation, leading zeros and empty values are rejected.
- Unsupported and duplicate parameters return 400, even when duplicate values are identical.
- Where supported, `q` is trimmed, must contain 1–100 characters, and matches case-insensitively across the endpoint's search fields. The database uses substring/LIKE search; `%` and `_` have PostgreSQL wildcard semantics, not full-text search semantics.
- Where supported, `from`/`to` are inclusive ISO timestamps with timezone, applied to `createdAt`. They can be supplied individually; `from` must not exceed `to`. Date-only strings are rejected. URL-encode `+` in positive timezone offsets (or use `curl --data-urlencode`).
- Sorting fields are allow-listed per endpoint. Configurable sorting defaults to `sortBy=createdAt&order=desc`. IDs ascending break ties in either direction.
- Multiple filters are combined with AND; search fields within `q` are combined with OR.

| Routes under `/api/v1` | Search | Filters | Sort fields |
|---|---|---|---|
| `/users`, `/admin/users` | `q`: name, email, phone | `role`, `isActive` (`true`/`false`) | `createdAt`, `name`, `email` |
| `/shipments`, `/shipments/search`, `/shipments/my-shipments`, `/admin/shipments` | `q`: tracking number, pickup/delivery contact names and addresses | `status`, `paymentStatus`, `from`, `to` | `createdAt`, `updatedAt`, `price` |
| `/payments/my-payments` | None | `status`, `shipmentId` | Fixed `createdAt desc`, then `id asc`; no sort parameters |
| `/admin/audit-logs` | None | `actorId`, `entityType`, `entityId`, `shipmentId`, `paymentId`, exact `action`, `from`, `to` | `createdAt`, `action` |

`/shipments/search` requires `q`. Other searchable lists allow it to be omitted. User lists and Admin-prefixed lists require Admin. Customers see their own shipments; Couriers see assigned shipments; Admins see all shipments except `/shipments/my-shipments`, which is limited to shipments they own. Payment lists always use the actor's payer ID, including for Admins; Couriers cannot access them.

Operational user/shipment lists exclude soft-deleted records. Financial and audit history retain the behavior documented in [payments](payments.md) and [Admin APIs](admin.md).

## Response and pagination

```json
{
  "success": true,
  "message": "Shipments fetched successfully",
  "data": {
    "shipments": [],
    "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
  }
}
```

The array name is `users`, `shipments`, `payments` or `auditLogs`. `total` is the count **after** ownership, deletion, search and filters, before pagination. Out-of-range pages return an empty array with the actual total; pages are not silently clamped. Pagination uses `skip=(page-1)*limit` and `take=limit`.

Rows and count are read in a repeatable-read database transaction. The ID tie-breaker makes tied sorts deterministic for an unchanged dataset. Separate page requests do not share a snapshot: concurrent changes can shift offsets. Large offsets and substring searches can be expensive; this step does not introduce cursor pagination or a full-text search index.

## Examples

```bash
curl --get http://localhost:3000/api/v1/shipments/search \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-urlencode 'q=Dhaka' \
  --data-urlencode 'status=IN_TRANSIT' \
  --data-urlencode 'paymentStatus=PAID' \
  --data-urlencode 'from=2026-10-01T00:00:00+06:00' \
  --data-urlencode 'to=2026-10-07T23:59:59+06:00' \
  --data-urlencode 'sortBy=price' \
  --data-urlencode 'order=asc' \
  --data-urlencode 'page=1' \
  --data-urlencode 'limit=10'

curl 'http://localhost:3000/api/v1/admin/users?role=COURIER&isActive=true&sortBy=name&order=asc&limit=20' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Verification

`npm run test:lists:integration` uses Node.js 24 and the configured development/test PostgreSQL database. It creates/removes isolated fixtures and exercises actual Route Handlers, including Admin aliases. Coverage includes combined filters, timezone-equivalent inclusive boundaries, numeric price sorting, tied pagination, empty pages, role scoping, soft-delete exclusion and consistent malformed-query rejection across eight routes. No provider calls, new environment settings or database migration are required.
