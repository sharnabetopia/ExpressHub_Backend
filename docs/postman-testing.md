# Role-wise API testing

Import `docs/postman/ExpressHub.postman_collection.json` and
`docs/postman/ExpressHub.local.postman_environment.json` into Postman. Select the
imported environment and set `baseUrl`, `email`, and `password` privately. Replace
an old imported collection/environment to avoid stale variable values. Do not
publish populated credentials or tokens. The existing public documentation is
not automatically updated by repository edits; republish the corrected collection
from your Postman workspace.

With **No Environment**, scripts save runtime values in Collection → Variables.
With an environment selected, they save in that environment instead. Login,
refresh, checkout keys, shipment IDs and role checks all use the same scope.

## Accounts and tokens

Register creates CUSTOMER only. Use the existing Admin bootstrap for the first
Admin. As Admin, promote a separate customer account to COURIER, then log in that
account again. Login each of CUSTOMER, COURIER and ADMIN before running the role
checks. Login saves the active `accessToken`, `currentUserId`, `currentRole`, and
the matching role token/ID. It never changes `userId`: that is the target account
for user administration, and must be set explicitly. Role checks use their own
role tokens; ordinary requests use the most recently logged-in account.

Keep the cookie jar enabled. It holds the last logged-in account's refresh
session for this origin, independently of the bearer token selected in a request.
Refresh identifies the account using `/users/me` and updates its saved role token.
Logout clears active token metadata; saved role access tokens can remain valid
until expiry. Log in again when tokens expire (15 minutes). Environments do not
provide separate cookie jars: login the intended account before refresh/logout.

## Test order

1. Check Health, then Customer profile update and shipment creation. Pricing must
   be configured (`npm run prisma:seed:pricing` installs the approved flat 100 BDT
   rate). Creation saves `shipmentId`.
2. Test lists with search, filters, sort and pagination. Invalid queries should
   return 400. Create a shipment under a second Customer and retain its ID as
   `foreignShipmentId`; log back in the first Customer before role checks.
3. Login all three primary roles. Run only the **Role access checks** folder:
   profile roles, Admin dashboard allow/deny, scoped Customer/Courier lists,
   missing token 401, and foreign shipment 404. Empty shipment lists do not prove
   scoping alone; populate owned and assigned fixtures before this test.
4. As the owning Customer, create Checkout and open `checkoutUrl`. Complete a
   Stripe test-mode payment; allow a real signed webhook to confirm PAID. Both
   creation aliases are documented; they represent the same operation.
5. As Admin assign an active courier (`expectedCourierId: null` initially). As
   that Courier advance CREATED → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY →
   DELIVERED, supplying the exact expected status and a delivery confirmation note.
6. Use separate shipments for cancellation and failed delivery/return. Confirm
   stale status and forbidden transitions fail. Admin retry/return needs a FAILED
   shipment; failure/return needs a note. Inspect audits and dashboard.
7. Soft-delete a terminal shipment with no unresolved payment, and a separate
   disposable user with no active shipments/payments. Confirm normal reads exclude
   them and Admin audits remain. Never use your current Admin as deletion target.

Do not run the entire reference collection in one batch: mutations require
specific roles, resource state and provider completion. Saved responses are
examples, not assertions that requests have passed. The read-only role folder
contains assertions; other business scenarios must be exercised in order.

## Payment attempt keys

The pre-request script creates a UUID for the first attempt and changes it when
`shipmentId` changes. Network retries reuse it. After a verified FAILED attempt,
clear `idempotencyKey` to start a new attempt on the same shipment. Do not clear it
for an unresolved attempt. Unsigned sample webhooks cannot settle a payment.

## Maintenance and verification

`node scripts/prepare-postman.mjs` refreshes collection scripts, aliases and role
checks and resets exported variables to empty values (no credentials are read).
The older `generate-api-docs.mjs` writes separate non-payment reference artifacts,
so it cannot overwrite this complete collection or its environment.

Run the repository integration suites against a development/test database for
transaction, concurrency and rollback coverage. Postman checks supplement those
suites; they do not replace real Stripe acceptance or deployment verification.
