# Soft deletion and audit history (Step 12)

ExpressHub archives users and shipments by setting `deletedAt`. Application deletion never hard-deletes a row, cascades into related records, changes a shipment's delivery status or issues a refund. No restore endpoint is provided.

## Endpoints

| Method | Endpoint | Access | Successful `data` |
|---|---|---|---|
| DELETE | `/api/v1/users/:id` | Active Admin | `{ "user": { "id": "...", "deletedAt": "<ISO timestamp>" } }` |
| DELETE | `/api/v1/shipments/:id` | Active Admin | `{ "shipment": { "id": "...", "deletedAt": "<ISO timestamp>" } }` |

Both require Bearer authentication and `Content-Type: application/json`. The body must contain only `reason`, a trimmed string of 3–1000 characters. The server sets the deletion timestamp.

```bash
curl -X DELETE "http://localhost:3000/api/v1/shipments/$SHIPMENT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Archive completed shipment after operational review"}'
```

Responses use the usual `{ success, message, data }` envelope with HTTP 200 and `Cache-Control: no-store`. Invalid IDs/reasons/unknown body fields return 400; missing authentication or inactive/deleted actors return 401; non-Admins return 403. Missing or already-deleted targets return 404. Repeating a deletion cannot add a second deletion audit entry. Business conflicts return 409.

## User deletion safeguards

- An Admin cannot delete their own account. Another current active Admin must manage it.
- Resolve all non-deleted, nonterminal shipments owned by or assigned to the target. FAILED is nonterminal: it still needs a retry/return decision. A courier may be reassigned through the existing assignment operation where that transition is allowed.
- Resolve the target's PENDING payments and REFUND_PENDING refunds before deletion.
- The transaction sets `deletedAt`, sets `isActive=false`, revokes all unrevoked refresh sessions and writes `USER_SOFT_DELETED` with the actor, reason and before/after values.
- Old bearer tokens fail the current-account lookup. Login and refresh reject the deleted account. Profile/role/status changes cannot restore it, and ordinary user lists/details omit it.
- The account's email remains reserved by its unique constraint. Deletion is archival, not erasure/anonymization. Existing shipment, financial and audit records are retained.

## Shipment deletion safeguards

Only DELIVERED, RETURNED or CANCELLED shipments can be archived. Cancel an unused booking through its status endpoint first. CREATED, PICKED_UP, IN_TRANSIT, OUT_FOR_DELIVERY and FAILED return 409.

Actual PENDING/REFUND_PENDING payment attempts block archival, as does a shipment-level REFUND_PENDING flag. A cancelled unpaid booking with the default PENDING summary but **no payment attempt** can be archived. A resolved PAID/FAILED/REFUNDED attempt is retained. Archival does not automatically refund a paid shipment; use the existing approved provider refund process when appropriate.

The transaction sets `deletedAt` and writes `SHIPMENT_SOFT_DELETED`, including reason, actor, shipment ID, prior status and before/after deletion timestamps. Existing status/events are unchanged because archival is an administrative action, not a delivery transition.

Deleted shipments disappear from detail, search, own/Admin shipment lists and operational dashboard counts. Assignment/status updates and new payment attempts cannot operate on them. Existing payment records remain readable under payment authorization, and provider webhooks can still reconcile retained financial history.

## Audit guarantees and retention exceptions

Deletion operations reuse serializable transactions with bounded conflict retries and recheck current Admin authority inside the transaction. Audit failure rolls back the deletion and session changes. Concurrent duplicate deletes result in one deletion/audit; a competing request sees a missing target after retry (or a 409 if retry limits are exhausted).

Existing transactional audit coverage is preserved:

| Operation | Audit action |
|---|---|
| User profile edit | `USER_PROFILE_UPDATED` |
| Role / activation change | `USER_ROLE_UPDATED` / `USER_STATUS_UPDATED` |
| Shipment creation | `SHIPMENT_CREATED` |
| Courier assignment | `SHIPMENT_COURIER_ASSIGNED` |
| Shipment status, cancellation, delivery | `SHIPMENT_STATUS_UPDATED` (before/after status identifies the transition) |
| Payment initiation / verified status update | `PAYMENT_INITIATED` / `PAYMENT_STATUS_UPDATED` |
| User / shipment archival | `USER_SOFT_DELETED` / `SHIPMENT_SOFT_DELETED` |

The schema uses `actorId` for the plan's acting `userId`. `shipmentId` is present for shipment/payment actions and null for unrelated user actions. System/provider actions can have a null actor. Every audit record has action, target, structured details and creation time. Passwords and refresh tokens are not written to these audit details.

Ordinary user/shipment reads exclude `deletedAt != null`. **Payments, webhook reconciliation and Admin audit queries intentionally retain history**, including references to deleted targets; a blanket deletion filter would lose that history. Audit history is read-only through the API and is available at `GET /api/v1/admin/audit-logs`. The database schema does not enforce append-only access against a privileged database operator.

## Verification

Run `npm run test:soft-delete:integration` using Node.js 24 and a development/test PostgreSQL database. The suite creates/removes unique fixtures, exercises actual Route Handlers/services, and tests authorization, input validation, active-work/payment conflicts, all terminal states, concurrent deletes, forced audit-failure rollback, session revocation, login/refresh rejection, hidden records and retained payment/event/audit history. Test cleanup hard-deletes only its own fixtures.

No schema migration, credentials or environment changes are required.
