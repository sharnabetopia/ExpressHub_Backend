# Admin dashboard and operations (Step 10)

All endpoints require `Authorization: Bearer <access-token>` for a current, active, non-deleted `ADMIN`. Missing/invalid authentication and inactive/deleted accounts return 401; Customer/Courier accounts return 403, even if their token still claims ADMIN after demotion. Responses use the normal `{ success, message, data }` envelope and `Cache-Control: no-store`.

| Method | Endpoint | Response data |
|---|---|---|
| GET | `/api/v1/admin/dashboard-stats` | `users`, `shipments`, `payments` aggregates |
| GET | `/api/v1/admin/users` | `users`, `pagination` |
| PATCH | `/api/v1/admin/users/:id/role` | `user` |
| GET | `/api/v1/admin/shipments` | `shipments`, `pagination` |
| GET | `/api/v1/admin/audit-logs` | `auditLogs`, `pagination` |

## Dashboard

```bash
curl http://localhost:3000/api/v1/admin/dashboard-stats \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

No query parameters are accepted. Aggregates are computed in one repeatable-read database transaction:

- `users`: `total`, `active`, `inactive`, and `byRole` counts for CUSTOMER, COURIER and ADMIN. Soft-deleted users are excluded. Inactive users remain in total and role counts.
- `shipments`: `total`, `active`, and `byStatus` counts for all eight statuses. Soft-deleted shipments are excluded. Active means CREATED, PICKED_UP, IN_TRANSIT, OUT_FOR_DELIVERY or FAILED. DELIVERED, RETURNED and CANCELLED are terminal.
- `payments`: `total`, `byStatus`, and `amounts`. All retained payment attempts are counted, including those associated with deleted shipments/users. Each `amounts` entry contains `currency`, `status`, `count`, and a two-decimal string `amount`, for example `{ "currency": "BDT", "status": "PAID", "count": 2, "amount": "10.40" }`. Empty groups are omitted from `amounts`; status/role count maps include zeros.

Currencies are never combined. Amounts are sums of the original payment-attempt amounts in each current status, **not net revenue or actual refunded amounts**. Failed retries count as separate attempts; REFUND_PENDING can include partial refunds. This summary is an operational overview, not a financial ledger.

## Users and role assignment

The Admin-prefixed user routes reuse the existing protected user handlers and service. See [user API details](users.md).

`GET /admin/users` accepts `page`, `limit` (1–100), `role`, `isActive` (`true`/`false`), `q` (name/email/phone search), `sortBy` (`createdAt`, `name`, `email`), and `order` (`asc`/`desc`). Lists exclude soft-deleted users and never return password hashes or refresh sessions.

```bash
curl 'http://localhost:3000/api/v1/admin/users?role=COURIER&isActive=true&limit=20' \
  -H "Authorization: Bearer $ACCESS_TOKEN"

curl -X PATCH "http://localhost:3000/api/v1/admin/users/$USER_ID/role" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role":"COURIER"}'
```

Role bodies accept exactly one role: CUSTOMER, COURIER or ADMIN. Changing one's own role returns 409. Deleted targets return 404. A real change rechecks Admin authority inside the serializable transaction, revokes the target's refresh sessions, and writes a before/after audit entry atomically. Repeating the same role is a no-op with no additional audit entry.

Activation/deactivation remains available through the existing `PATCH /api/v1/users/:id/status` Admin operation.

## Shipment monitoring

`GET /admin/shipments` uses the existing shipment list service, with an explicit Admin guard before processing inputs. It lists all non-deleted shipments across customers. Query parameters: `page`, `limit` (1–100), `status`, `paymentStatus`, `q`, `from`, `to`, `sortBy` (`createdAt`, `updatedAt`, `price`), and `order`. Dates are inclusive ISO timestamps with timezone; search matches tracking number, contact names and addresses. See [shipment API details](shipments.md) for existing assignment and status-change operations.

```bash
curl 'http://localhost:3000/api/v1/admin/shipments?status=FAILED&sortBy=updatedAt&order=desc' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Audit inspection

`GET /admin/audit-logs` supports these filters, combined with AND:

| Query | Accepted value |
|---|---|
| `page`, `limit` | Positive integers; defaults 1/20, maximum limit 100 |
| `actorId` | Actor's CUID |
| `entityType` | USER, SHIPMENT, PAYMENT, HUB or PRICING_RULE |
| `entityId`, `shipmentId`, `paymentId` | Corresponding CUID |
| `action` | Exact, case-sensitive action name, maximum 100 characters |
| `from`, `to` | Inclusive ISO timestamps with timezone; from must not exceed to |
| `sortBy` | `createdAt` (default) or `action` |
| `order` | `desc` (default) or `asc` |

```bash
curl "http://localhost:3000/api/v1/admin/audit-logs?actorId=$USER_ID&action=USER_ROLE_UPDATED&limit=20" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Each record contains `id`, nullable `actorId`, `entityType`, `entityId`, nullable `shipmentId`/`paymentId`, `action`, `details` and `createdAt`. System/provider events may have no actor. Details contain the stored before/after values and may include operational information intended only for Admins. Full user/session/payment objects are not joined into the response.

Audit history remains visible when an actor or target is soft-deleted. No update/delete audit endpoint is exposed. Results and count share one database snapshot, with ascending ID as the sort tie-breaker. Pagination returns `page`, `limit`, `total`, `totalPages`; out-of-range pages are empty. Unknown or duplicate query parameters and invalid filters return 400. Concurrent inserts between separate page requests can still shift offset pagination.

## Verification

```bash
npm run test:admin:integration
npm run typecheck
npm run build
```

The integration suite requires Node.js 24 and the configured development/test PostgreSQL database. It calls actual Route Handlers/services, uses uniquely identified fixtures, and removes them afterward. It covers all five route guards, stale-token demotion, counts across shipment/payment statuses, currency-separated exact amounts, soft-delete and retention rules, safe user output, filters, tied-timestamp pagination, role validation, audit records and refresh-session revocation. No schema migration or new environment variables are needed.
