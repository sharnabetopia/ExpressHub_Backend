# ExpressHub Project Implementation Flow

## 1. Project Goal

এই প্রজেক্টের মূল উদ্দেশ্য হলো Courier & Logistics Management System-এর জন্য একটি production-grade backend API তৈরি করা।

- Fixed primary roles: Customer, Courier, Admin
- Core business: shipment request, pickup, courier assignment, transit, delivery, payment, tracking
- Requirement অনুযায়ী 3টি fixed primary role এবং 20+ meaningful endpoint implement করতে হবে
- Backend focus, frontend দরকার নেই

---

## 2. Project Scope and Requirements Summary

### 2.1 Tech stack

- Runtime and framework: Node.js + TypeScript + Next.js App Router
- API: Next.js Route Handlers
- Database: PostgreSQL + Prisma ORM
- Auth: JWT + bcryptjs
- Validation: Zod
- Security: Next.js security headers, explicit CORS policy, and API rate limiting
- Payment: Stripe / SSLCommerz / bKash
- Documentation: Postman / Swagger

### 2.2 Functional requirements

- User registration/login/logout/refresh token
- Role-based access control
- Shipment creation and lifecycle management
- Courier assignment and tracking
- Payment initiation and verification
- Admin dashboard and audit log
- Soft delete instead of hard delete
- Search, filter, sort and pagination
- Response format consistency
- Secure protected routes

---

## 3. Step-by-Step Development Flow

### Step 1: Finalize business model

এই ধাপে business scope ও নিয়মগুলো স্থির করা হলো। পরের ধাপগুলোতে schema/API ডিজাইন করার সময় এই সিদ্ধান্তগুলোই source of truth হবে।

#### 1.1 Problem and solution

ছোট ও মাঝারি courier operation-এ booking, courier assignment, hub transfer, delivery tracking, payment verification এবং failed delivery একাধিক জায়গায় ছড়ানো থাকে। ExpressHub একটি কেন্দ্রীয় backend API দিয়ে shipment-এর পুরো lifecycle এবং সংশ্লিষ্ট operation পরিচালনা করবে।

**সমাধানের সীমা:** এই assignment backend-focused; customer-facing UI বানানো scope-এ নেই। API Postman/Swagger দিয়ে পরীক্ষা ও প্রদর্শন করা হবে।

#### 1.2 Fixed roles and responsibilities

Requirement অনুযায়ী ঠিক **৩টি primary role** থাকবে। Hub Manager আলাদা role হবে না; hub operations Admin পরিচালনা করবে।

| Role | অনুমোদিত কাজ |
|---|---|
| `CUSTOMER` | নিজের profile দেখা/সম্পাদনা, shipment তৈরি, নিজের shipment ও tracking দেখা, payment শুরু/দেখা, pickup-এর আগে নিজের shipment cancel করা |
| `COURIER` | নিজের কাছে assign হওয়া shipment দেখা, pickup/delivery attempt ও status update করা, delivery confirmation জমা দেওয়া |
| `ADMIN` | user ও role পরিচালনা, courier assignment, hub ও shipment operation পরিচালনা, failed delivery/return সিদ্ধান্ত, payment/audit/analytics দেখা |

সব role check server-side হবে। Client পাঠানো role বা user ID-কে authorization-এর প্রমাণ হিসেবে বিশ্বাস করা যাবে না। Public registration-এ role নির্বাচন গ্রহণ করা হবে না; নতুন account হবে `CUSTOMER`। `COURIER`/`ADMIN` role কেবল Admin নির্দিষ্ট permission দিয়ে assign করবে। Hub Manager-এর operational কাজ `ADMIN` role-এর আওতায় থাকবে।

#### 1.3 Core shipment lifecycle

```text
CREATED -> PICKED_UP -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED
                                      \-> FAILED
FAILED -> IN_TRANSIT (Admin retry/reschedule) অথবা RETURNED
CREATED -> CANCELLED (Customer বা Admin; pickup-এর আগে)
```

- `FAILED` মানে delivery attempt সফল হয়নি; Admin retry বা return নির্ধারণ করবে।
- `RETURNED`, `DELIVERED`, `CANCELLED` terminal state; ভুল সংশোধনের জন্য status overwrite নয়, Admin audit-সহ আলাদা correction operation লাগবে।
- Pickup schedule `pickupScheduledAt` timestamp হবে; এটি আলাদা shipment status নয়।
- প্রতিটি status change-এ actor, সময়, আগের/নতুন status এবং optional note shipment history-তে থাকবে; critical পরিবর্তন audit log-এও থাকবে।

#### 1.4 End-to-end business workflows

**A. Booking ও payment**
1. Customer account তৈরি করে/login করে।
2. Pickup/recipient contact ও address, parcel weight/dimensions এবং pickup time দেয়।
3. Server Zod validation ও pricing rules প্রয়োগ করে quote/amount নির্ধারণ করে; client-প্রেরিত amount বিশ্বাস করে না।
4. Shipment `CREATED` হিসেবে unique tracking number-সহ তৈরি হয়।
5. Payment provider-এ online payment intent/session শুরু হয়; payment record `PENDING` রাখা হয়।
6. Provider-এর verified callback/webhook payment নিশ্চিত করলে shipment payment status `PAID` হয়।
7. Payment সফল না হলে shipment unpaid থাকে; unpaid shipment pickup/dispatch-এ যাবে না।

**B. Courier assignment, pickup ও delivery**
1. Admin active `COURIER`-কে shipment assign করে।
2. Assigned courier pickup-এর পর `PICKED_UP`, transit-এ `IN_TRANSIT`, delivery attempt-এ `OUT_FOR_DELIVERY` দেয়।
3. সফল হলে courier delivery confirmation দেয়; server অনুমোদন যাচাই করে `DELIVERED` করে।
4. প্রতিটি update tracking timeline ও audit trail-এ রেকর্ড হয়।

**C. Hub transfer**
1. Admin Hub record ও active/inactive অবস্থা পরিচালনা করে।
2. Admin shipment-কে পরবর্তী hub-এ transfer হিসেবে রেকর্ড করে।
3. Transfer event-এ origin/destination hub, সময় ও actor রাখা হয়; public tracking-এ সংবেদনশীল internal note প্রকাশ করা হবে না।

**D. ব্যর্থ delivery/return**
1. Courier attempt ব্যর্থ হলে reason-সহ `FAILED` রেকর্ড করে।
2. Admin retry/reschedule করলে shipment পুনরায় operational flow-তে যায়; ফেরত পাঠালে `RETURNED` হয়।
3. Refund প্রযোজ্য কি না payment-provider policy ও Admin-অনুমোদিত business rule অনুযায়ী নির্ধারিত হবে; status হাতে করে `PAID` করা যাবে না।

#### 1.5 Pricing and payment policy

- Payment integration বাধ্যতামূলক; Stripe, SSLCommerz অথবা bKash-এর মধ্যে একটি real provider বাস্তবায়নের আগে নির্বাচন করতে হবে।
- Cash on Delivery, pay-later এবং fake/manual “paid” status গ্রহণযোগ্য নয়।
- Server-side quote-এ অন্তত base delivery fee ও weight tier থাকবে; zone/distance surcharge যোগ করার আগে Admin-configured rate ব্যবহার হবে।
- Quote-এ amount ও currency স্পষ্ট থাকবে; shipment/payment-এ amount snapshot রাখা হবে, যাতে পরের rate পরিবর্তন পুরনো order বদলে না দেয়।
- Payment initiation এবং provider API call-এর মধ্যে database transaction খোলা রাখা হবে না। Provider callback signature যাচাই ও idempotency key/reference দিয়ে duplicate callback নিরাপদে handle করতে হবে।
- Failed payment-এর পর নতুন attempt করা যাবে; একই shipment-এ একাধিক confirmed successful payment গ্রহণ করা যাবে না। Refund provider-এর মাধ্যমে initiate/verify করতে হবে।

#### 1.6 Core data entities and relationships

- `User`: profile, password hash, fixed role, active/deleted timestamps; customer/courier হিসেবে shipment সম্পর্ক।
- `Shipment`: unique tracking number, customer, optional assigned courier, pickup/delivery details, package dimensions/weight, price/currency snapshot, current status/payment status, schedule, delivered/deleted timestamps।
- `Hub`: unique code/name, address/zone, active status; shipment-এর origin/current/destination association প্রয়োজন অনুযায়ী।
- `ShipmentEvent`: shipment timeline; status/transfer event, actor, timestamp, public tracking note এবং internal note আলাদা রাখার সুযোগ।
- `Payment`: shipment, payer, provider, provider reference, amount/currency, status, idempotency/reference data।
- `AuditLog`: actor, action, target, before/after বা structured details, timestamp; critical changes-এর immutable record।
- `RefreshToken`/session: token hash, user, expiry, revoked timestamp; raw refresh token database-এ রাখা হবে না।

সম্পর্ক: এক customer-এর বহু shipment; এক courier-এর বহু assigned shipment; এক shipment-এর বহু event/payment/audit record; Hub-এর সঙ্গে বহু shipment transfer event যুক্ত হতে পারে।

#### 1.7 Authorization and business invariants

- Customer কেবল নিজের shipment, payment ও profile দেখতে/পরিবর্তন করতে পারবে।
- Courier কেবল নিজের assigned shipment-এর অনুমোদিত status update করতে পারবে।
- Admin সব operation-এর access পাবে; sensitive role change/assignment audit হবে।
- Inactive বা soft-deleted user login করতে পারবে না; inactive courier-কে নতুন shipment assign করা যাবে না।
- Tracking number unique হবে; conflict হলে নিরাপদে নতুন number generate/retry হবে।
- Shipment create-এ valid customer, address, parcel detail এবং server-calculated price আবশ্যক।
- Pickup/dispatch-এর আগে payment confirmed থাকতে হবে।
- Status transition allow-list মেনে চলবে; একই concurrent update যেন state নষ্ট না করে, transaction/conditional update ব্যবহার করতে হবে।
- Destructive user/shipment action হবে soft delete। Payment ও audit history hard delete করা হবে না।
- Shipment-এর payment callback অবশ্যই shipment ও payment reference-এর সঙ্গে মেলাতে হবে।

#### 1.8 Authentication and authorization model

- Email/password; password bcryptjs দিয়ে hash হবে।
- স্বল্প-মেয়াদি access JWT ও ঘূর্ণায়মান refresh token ব্যবহার হবে।
- Browser/client উপযোগী হলে refresh token `HttpOnly`, `Secure` (production), `SameSite` cookie-তে; access token-এর storage ও transport বাস্তব client/API policy অনুযায়ী নির্ধারিত হবে।
- Logout/refresh-এ refresh session revoke/rotate হবে; access token expiry সীমিত হবে।
- প্রতিটি protected request-এ server token যাচাই, account active check, তারপর resource ownership ও role authorization করবে।

#### 1.9 Transaction boundaries and external operations

- Shipment create + initial `ShipmentEvent` + audit entry এক database transaction-এ।
- Courier assignment + assignment event + audit entry এক transaction-এ।
- Status transition + timeline event + audit entry এক transaction-এ।
- Verified payment result process করে Payment ও Shipment payment status + audit entry এক transaction-এ।
- Refund provider operation transaction-এর বাইরে; provider result যাচাইয়ের পর database state atomically update হবে।
- Redis/provider/network call database transaction-এর ভিতরে চলবে না। Concurrent assignment/payment/status update idempotency ও database constraints/transaction দিয়ে সামলাতে হবে।

#### 1.10 Soft delete, audit, search and performance

- User ও Shipment soft delete: `deletedAt`; সাধারণ query-তে deleted row বাদ।
- Payment, ShipmentEvent ও AuditLog retention policy ছাড়া delete নয়।
- Critical action: role/active change, courier assignment, status transition, cancellation/return, payment/refund update—সব audit হবে।
- Shipment list/tracking search-এ pagination, status/date/role-appropriate filtering এবং sorting থাকবে।
- Index candidate: user email/role, tracking number, shipment customer/courier/status/createdAt, payment provider reference/status, event shipmentId/createdAt।
- Redis optional; কেবল read-heavy tracking/dashboard summary-তে short TTL ও invalidation strategy থাকলে ব্যবহার। Auth secret/payment state cache করা হবে না।

#### 1.11 Admin reporting

Admin দেখতে পারবে:
- shipment count by status ও time range
- payment success/failure/refund totals
- delivery success/failure rate এবং average delivery time
- courier-wise assigned/delivered/failed shipment counts
- hub-wise transfer/distribution summary
- paginated audit log

সব analytics server-side aggregation দিয়ে হবে এবং deleted/test data policy স্পষ্টভাবে মানবে।

#### 1.12 Edge cases and handling

- Duplicate email: `409 Conflict`; DB unique constraint-ও থাকবে।
- Cross-user record access: তথ্য ফাঁস না করে `404` বা policy-defined `403`।
- Unassigned/wrong courier update: reject, কোনো state change নয়।
- Invalid status transition বা terminal status update: reject এবং audit-worthy security event হলে log।
- Concurrent courier assignment: একটিমাত্র assignment সফল; অন্য request conflict পাবে।
- Duplicate/late webhook: signature যাচাই, idempotent processing; already-final payment পুনরায় প্রয়োগ নয়।
- Payment amount/currency/reference mismatch: reject, shipment unpaid থাকবে, alert/audit তৈরি হবে।
- Payment success কিন্তু shipment update failure: retryable/idempotent reconciliation path থাকতে হবে।
- Duplicate tracking number: uniqueness constraint ও bounded regeneration retry।
- Pickup-এর পর customer cancellation: সরাসরি cancel নয়; Admin return/refund policy flow।
- Courier/user inactive হওয়া: existing event history থাকবে; নতুন assignment/operation নিষিদ্ধ।
- Failed delivery-এর পর retry limit ও return decision Admin policy দিয়ে নির্ধারিত হবে।
- Public tracking response-এ password, phone/email, internal notes বা payment-sensitive data প্রকাশ নয়।

#### 1.13 Out of scope for initial delivery

- Frontend/user dashboard
- Social login, notifications/email, file/image upload
- Live GPS tracking ও route optimization
- Multiple organization/tenant billing
- Courier earnings/payout calculation
- Automatic hub/zone matching algorithm

এসব feature core 20+ API, real payment, RBAC, shipment workflow, audit, validation ও documentation সম্পূর্ণ হওয়ার পরে বিবেচনা করা হবে।

#### 1.14 Step-1 acceptance checklist

- [x] Problem, product scope ও backend-only delivery নির্ধারিত।
- [x] ঠিক ৩টি role: `CUSTOMER`, `COURIER`, `ADMIN`; Hub Manager আলাদা role নয়।
- [x] Shipment lifecycle, exception, cancel, retry ও return policy নির্ধারিত।
- [x] Real online payment policy, amount source, webhook/idempotency নিয়ম নির্ধারিত।
- [x] Core entities/relationships, soft delete, event history ও audit scope নির্ধারিত।
- [x] Ownership/RBAC, transaction boundary, concurrency ও প্রধান edge cases নির্ধারিত।
- [x] Out-of-scope feature আলাদা করা হয়েছে যাতে initial build manageable থাকে।

**নির্বাচন বাকি:** implementation-এর আগে একটি payment provider (Stripe/SSLCommerz/bKash), currency এবং deployment/runtime limits নিশ্চিত করতে হবে। এগুলো payment provider ও deployment অনুযায়ী বদলায়; provider credentials কখনো repository-তে রাখা যাবে না।

---

### Step 2: Define project architecture

এই প্রকল্পটি backend-only **modular monolith** হবে: এক Next.js application, একটি PostgreSQL database, এবং পৃথক feature module। Next.js App Router-এর Route Handlers হবে versioned REST API surface; UI/page তৈরি এই scope-এ নেই।

#### 2.1 Runtime and architectural decisions

- Framework: Next.js App Router, TypeScript; API endpoint হবে `app/api/**/route.ts`।
- Database: PostgreSQL এবং Prisma Client; database access কেবল server-side service-এ।
- Execution runtime: Node.js runtime—Prisma ও payment provider integration-এর জন্য। Edge runtime ব্যবহার করা হবে না।
- Application shape: এক deployable application, আলাদা microservice নয়। প্রয়োজন হলে পরে service extraction করা যাবে।
- API versioning: সব business endpoint `/api/v1/...`-এর অধীনে।
- Frontend: এই assignment-এ নেই; API Postman/Swagger থেকে ব্যবহার হবে।
- Public API কেবল Route Handler দিয়ে উন্মুক্ত হবে; `services`, `lib`, `validators` সরাসরি network route নয়।

#### 2.2 Folder structure

```txt
app/
  api/
    v1/
      health/route.ts
      auth/
        register/route.ts
        login/route.ts
        logout/route.ts
        refresh-token/route.ts
      users/
        route.ts
        me/route.ts
        [userId]/route.ts
        [userId]/role/route.ts
      shipments/
        route.ts
        search/route.ts
        my-shipments/route.ts
        [shipmentId]/route.ts
        [shipmentId]/status/route.ts
        [shipmentId]/courier/route.ts
      payments/
        route.ts
        my-payments/route.ts
        webhook/route.ts
        [paymentId]/route.ts
      admin/
        dashboard-stats/route.ts
        audit-logs/route.ts
        analytics/
          shipments/route.ts
          payments/route.ts
lib/
  prisma.ts
  auth/
    tokens.ts
    require-user.ts
    permissions.ts
  http/
    responses.ts
    errors.ts
  rate-limit.ts
  payment-provider.ts
services/
  auth.service.ts
  user.service.ts
  shipment.service.ts
  payment.service.ts
  hub.service.ts
  admin.service.ts
validators/
  common.ts
  auth.ts
  user.ts
  shipment.ts
  payment.ts
  admin.ts
utils/
  tracking-number.ts
  pricing.ts
types/
  auth.ts
proxy.ts
prisma/
  schema.prisma
  migrations/
```

শুধু প্রয়োজন হলে module-এর ভিতরে আরও ফাইল যোগ হবে; শুরুতেই অতিরিক্ত layer বা ফাঁকা directory তৈরি করা হবে না।

#### 2.3 Module boundaries and responsibilities

| অংশ | দায়িত্ব | যা করবে না |
|---|---|---|
| `app/api/v1/**/route.ts` | HTTP method, request/query/params parsing, auth guard, input validation invoke, service call, status code ও JSON response | business rules বা দীর্ঘ Prisma query রাখা |
| `services/*.service.ts` | use case, ownership/role policy, business rules, state transition, transaction orchestration, Prisma query | Next.js `Request`/`Response`-এর ওপর নির্ভর করা |
| `validators/*.ts` | Zod body/query/params schema এবং input normalization | database write বা authorization |
| `lib/prisma.ts` | application process-এ reusable Prisma Client instance | client-side import |
| `lib/auth/**` | token sign/verify, current-user resolution এবং reusable permission check | client-side role check-কে security হিসেবে ধরা |
| `lib/http/**` | একরূপ success/error envelope ও application error-to-HTTP mapping | error গোপন করে success response বানানো |
| `lib/payment-provider.ts` | নির্বাচিত provider-এর server-side API/callback integration | credentials expose করা বা unverified callback বিশ্বাস করা |
| `prisma/schema.prisma` | entities, relations, indexes, enums, unique constraints | business workflow orchestration |

Prisma operation feature service/use-case-এ থাকবে। আলাদা data-access abstraction layer যোগ করা হবে না। Prisma instance, JWT secret, provider secret—সবই server-only; secret environment variable-এ `NEXT_PUBLIC_` prefix ব্যবহার করা যাবে না।

#### 2.4 Standard request lifecycle

```text
Client
  -> Next.js Route Handler
  -> method / content-type / request-size checks
  -> authenticate (public route হলে বাদ)
  -> validate and normalize body, query, route params
  -> authorize role + record ownership
  -> feature service executes business rules and Prisma operations
  -> transaction for coupled database changes
  -> map known application errors to HTTP status
  -> JSON response using the standard envelope
```

Validation সবসময় business operation-এর আগে হবে। Data-dependent authorization service-এ পুনরায় নিশ্চিত হবে। Protected route-এর security শুধু `middleware`/routing proxy-এর ওপর নির্ভর করবে না।

#### 2.5 API contract and HTTP behavior

- Success response: `{ "success": true, "message": "...", "data": ... }`
- Error response: `{ "success": false, "message": "...", "errors": [...] }`
- Input error: `400`; missing/invalid authentication: `401`; permission denied: `403`; missing resource: `404`; duplicate/conflicting state: `409`; unexpected server failure: `500`।
- List endpoint-এ `page`, capped `limit`, allow-listed `sortBy`/`order`, domain filter এবং relevant search parameter থাকবে; response data-তে items ও pagination metadata থাকবে।
- Request body/query/path parameter-এর জন্য পৃথক Zod schema ব্যবহার হবে; Prisma error বা stack trace client-কে পাঠানো হবে না।
- Provider webhook-এর সফল acknowledgement provider protocol অনুসরণ করবে; callback-এর business update idempotent হবে এবং internal errors log/monitor হবে।

#### 2.6 Authentication and authorization boundary

- Public: health, register, login, refresh (valid refresh credential আবশ্যক), provider webhook (signature যাচাই আবশ্যক)।
- Protected: users, shipments, payments ও admin API; protected route-এ server-side token validation বাধ্যতামূলক।
- Access token `Authorization: Bearer <token>` দিয়ে পাঠানো হবে। Refresh token opaque/random token হিসেবে `HttpOnly`, `Secure` (production), `SameSite` cookie-তে রাখা এবং database-এ hash করে সংরক্ষণ করা হবে।
- `requireUser()` token থেকে trusted user ID/role বের করবে, active/deleted account যাচাই করবে। Client payload-এর role বা user ID দিয়ে পরিচয়/permission নির্ধারিত হবে না।
- `requireRole()` coarse role permission যাচাই করবে; ownership/courier assignment/hub scope-এর মতো record-specific rule feature service-এ যাচাই হবে।
- CSRF protection refresh/logout cookie-based endpoint-এ প্রযোজ্য হবে; CORS allow-list এবং cookie policy deployment/client origin অনুযায়ী নির্ধারণ হবে।

#### 2.7 Transaction, external service and concurrency policy

- একাধিক DB record একসাথে বদলালে Prisma transaction: shipment + initial event/audit, assignment + event/audit, status + event/audit, verified payment + shipment payment state।
- Transaction-এর মধ্যে payment provider/Redis/email/network call করা হবে না।
- Payment process: transaction-এ pending attempt সংরক্ষণ -> provider API call -> provider signature/reference যাচাই -> idempotent transaction-এ payment/shipment update।
- Concurrent assignment/status/payment-এ DB unique constraint, conditional update, idempotency key/provider reference এবং conflict response ব্যবহার হবে।
- Redis optional; deployment-এ shared Redis-backed limiter/cache বেছে না নেওয়া পর্যন্ত in-memory rate limit একাধিক serverless instance-এ global guarantee দেয় না।
- Shipment tracking/dashboard cache করলে short TTL, sensitive-field exclusion এবং mutation-এর পরে invalidation বাধ্যতামূলক।

#### 2.8 Route and responsibility map

Dynamic segment-এর folder name (`[userId]`, `[shipmentId]`) Next.js route parameter হবে। Static folders যেমন `search` ও `my-shipments` dynamic route-এর পাশাপাশি আলাদা Route Handler।

| Route | Method | Access | Service/use case |
|---|---|---|---|
| `/api/v1/health` | GET | Public | database/app health |
| `/api/v1/auth/register` | POST | Public | customer account creation |
| `/api/v1/auth/login` | POST | Public | credentials verify + tokens |
| `/api/v1/auth/logout` | POST | Refresh credential | revoke session |
| `/api/v1/auth/refresh-token` | POST | Refresh credential | rotate refresh token |
| `/api/v1/users/me` | GET, PATCH | Any authenticated role | own profile |
| `/api/v1/users` | GET | Admin | filtered/paginated user list |
| `/api/v1/users/[userId]` | GET, DELETE | Owner or Admin | user read / soft delete |
| `/api/v1/users/[userId]/role` | PATCH | Admin | role/activation change + audit |
| `/api/v1/shipments` | POST, GET | Customer create; role-filtered list | booking/list |
| `/api/v1/shipments/search` | GET | Public tracking-safe fields or authenticated search | tracking/search |
| `/api/v1/shipments/my-shipments` | GET | Customer/Courier | own/assigned shipment list |
| `/api/v1/shipments/[shipmentId]` | GET, PATCH, DELETE | Owner, assigned Courier, or Admin by operation | details / allowed edit / soft delete |
| `/api/v1/shipments/[shipmentId]/status` | PATCH | Assigned Courier or Admin | transition + event + audit |
| `/api/v1/shipments/[shipmentId]/courier` | PATCH | Admin | assignment + event + audit |
| `/api/v1/payments` | POST | Authenticated Customer | initiate real payment |
| `/api/v1/payments/my-payments` | GET | Customer | own payment history |
| `/api/v1/payments/[paymentId]` | GET | Payer or Admin | authorized payment detail |
| `/api/v1/payments/webhook` | POST | Provider signature | verify/process callback |
| `/api/v1/admin/dashboard-stats` | GET | Admin | operational aggregates |
| `/api/v1/admin/audit-logs` | GET | Admin | filtered/paginated audit records |
| `/api/v1/admin/analytics/shipments` | GET | Admin | shipment reporting |
| `/api/v1/admin/analytics/payments` | GET | Admin | payment reporting |

একই path-এর একাধিক method আলাদা API operation হিসেবে documentation ও testing-এ গণ্য হবে। এই map ২০টির বেশি অর্থবহ operation দেয়; requirement পূরণ দেখানোর জন্য dummy/duplicate route যোগ করা যাবে না।

#### 2.9 Deployment and operational boundary

- Next.js app Node.js runtime-এ deploy হবে; platform অনুযায়ী connection pooling/serverless-compatible PostgreSQL ও Prisma configuration লাগতে পারে।
- Long-running courier jobs বা guaranteed retries প্রয়োজন হলে deployment step-এ queue/background worker আলাদা করে নির্ধারণ করতে হবে; serverless request-এ in-process job চালু রেখে নির্ভর করা যাবে না।
- Rate limiting, CORS, security headers, request size limit, secret management ও logging environment/deployment config-এ হবে।
- Health endpoint database availability এবং application readiness আলাদা করে report করবে; credentials বা internal connection details প্রকাশ করবে না।

#### 2.10 Step-2 completion criteria

- [x] Next.js App Router + Node.js Route Handlers-কে API architecture হিসেবে নির্ধারণ।
- [x] Modular-monolith boundary এবং folder/module responsibility নির্ধারণ।
- [x] Server-side Prisma/auth boundaries এবং ৩-role authorization pattern নির্ধারণ।
- [x] Request lifecycle, response envelope, HTTP error semantics নির্ধারণ।
- [x] Core route map, transaction/concurrency, payment callback ও caching/rate-limit constraints নির্ধারণ।
- [x] Deployment/runtime assumptions ও background work limitation চিহ্নিত।

এই Step-2 documentation architecture-কে স্থির করে; repository-র runtime conversion বা feature implementation এখনো করে না। Step-3-তে Next.js project setup/conversion, package scripts, environment validation, security config ও health route বাস্তবায়ন করতে হবে। Existing Express entrypoint/package dependencies conversion-এর সময় সরাতে বা বদলাতে হবে।

---

### Step 3: Environment and project setup

Step 3-এর কাজ হলো Step 2-এ নির্ধারিত architecture-কে runnable Next.js App Router project-এ রূপান্তর করা।

#### 3.1 Framework and package setup

- Next.js App Router + React + TypeScript dependencies ও scripts configure করো।
- Prisma Client, Zod, bcryptjs, jsonwebtoken এবং Upstash Redis rate-limit dependencies রাখো।
- Express server/router এবং Express-only middleware/dependencies সরিয়ে ফেলো; Next.js server-ই API host করবে।
- Prisma generation/build, development, production start এবং typecheck-এর reproducible npm scripts রাখো।

Configured commands:

```bash
npm run dev
npm run typecheck
npm run build
npm start
npm run prisma:generate
npm run prisma:migrate
```

#### 3.2 Next.js and TypeScript configuration

- App Router source path project root-এর `app/` directory হবে; `src/` directory থাকবে না।
- `next.config.ts`-এ `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` এবং production HTTPS-এর জন্য HSTS থাকবে।
- `tsconfig.json` Next.js plugin, JSX, bundler module resolution, strict type checking এবং `@/*` source alias configure করবে।
- `.next`, build output, dependency folders এবং local secret `.env*` Git থেকে ignore হবে; শুধু `.env.example` tracked থাকবে।

#### 3.3 Environment variables and secret handling

1. `.env.example` copy করে `.env` বানাও।
2. নিজের PostgreSQL connection string দিয়ে `DATABASE_URL` পূরণ করো।
3. Cross-origin client থাকলে `ALLOWED_ORIGIN`-এ সুনির্দিষ্ট origin দাও; wildcard origin + credentials ব্যবহার করা যাবে না।
4. Distributed rate limiting-এর জন্য Upstash account থেকে `UPSTASH_REDIS_REST_URL` এবং `UPSTASH_REDIS_REST_TOKEN` local/deployment secret store-এ configure করো।
5. `.env` commit বা log-এ প্রকাশ করা যাবে না; secret-এর নাম `NEXT_PUBLIC_` prefix দিয়ে রাখা যাবে না।

Rate-limit helper configuration না থাকলে fail-closed হবে; production endpoint-এ helper ব্যবহার করার আগে Upstash variables configure করতে হবে।

#### 3.4 Prisma client bootstrap

- `lib/prisma.ts`-এ server-only Prisma singleton থাকবে এবং Next.js development hot reload-এ duplicate client তৈরি হওয়া রোধ করবে।
- Database query Route Handler/service-এর server runtime-এ হবে; Edge runtime বা browser bundle-এ Prisma ব্যবহার করা যাবে না।
- Schema migration Step 5-এ হবে; setup যাচাইয়ের জন্য connection health check চলবে।

#### 3.5 Health and API bootstrap

- `GET /api/health` এবং `GET /api/v1/health` থাকবে।
- Health endpoint database readiness যাচাই করবে এবং consistent success/error JSON envelope দেবে।
- Database unavailable হলে HTTP `503` দেবে; credentials, connection URL বা raw stack trace response-এ প্রকাশ করবে না।

#### 3.6 CORS, security headers, and rate-limiting foundation

- API origin policy root-এর `proxy.ts`-এ exact `ALLOWED_ORIGIN` match করবে; preflight `OPTIONS` handle করবে। Allow-list-এ নেই এমন origin-কে access-control header দেওয়া হবে না।
- Security headers `next.config.ts` থেকে সব response-এ প্রয়োগ হবে।
- `lib/rate-limit.ts` Upstash Redis-backed shared rate limit তৈরি করবে—serverless/multi-instance deployment-এর জন্য in-memory counter নয়।
- Route-specific limits (login/register/webhook/general API) authentication/security implementation-এর সময় নির্ধারণ ও route-এ প্রয়োগ করতে হবে।

#### 3.7 Step-3 acceptance checklist

- [x] Express bootstrap সরিয়ে Next.js App Router runtime করা।
- [x] Next.js dev/build/start ও TypeScript validation scripts যোগ করা।
- [x] Next.js-compatible Prisma singleton এবং health routes যোগ করা।
- [x] `.env.example`, secret ignore rules, security headers, exact-origin CORS এবং shared rate-limit foundation যোগ করা।
- [x] বর্তমান local `DATABASE_URL` দিয়ে database health check সফল।
- [ ] Cross-origin client-এর প্রকৃত origin `ALLOWED_ORIGIN`-এ এবং distributed limiter চালুর আগে Upstash credentials configure করা।
- [ ] Migration ও domain schema validation Step 4/5-এ সম্পন্ন করা।

Step-3 source setup ও smoke-test complete। Local database connection যাচাই হয়েছে; deployment-origin/Upstash configuration এবং schema migration পরের setup ধাপগুলোতে বাকি।

---

### Step 4: Database data model design

Step-4-এ domain model ও database constraint নির্ধারণ করে `prisma/schema.prisma`-এ লেখা হয়েছে। এই schema-তেই migration তৈরি হবে; migration apply করা Step-5-এর কাজ।

#### 4.1 Models

| Model | উদ্দেশ্য |
|---|---|
| `User` | Customer/Courier/Admin identity, normalized email, password hash, active/soft-delete state |
| `Shipment` | tracking, customer/courier, pickup/delivery contacts and addresses, parcel dimensions/weight, price/currency snapshot, current shipment/payment status, scheduling |
| `Hub` | Admin-managed hub, code, address/zone এবং active/soft-delete state |
| `ShipmentEvent` | status change, courier assignment, hub transfer ও delivery attempt timeline; public ও internal note আলাদা |
| `Payment` | shipment/payer, provider, amount/currency, idempotency key, provider reference, payment/refund status ও timestamps |
| `PaymentWebhookEvent` | unique provider event ID, payload hash, processing state; duplicate webhook idempotency |
| `RefreshToken` | user-bound refresh-token hash, expiry, revocation ও last-used state |
| `PricingRule` | weight-tier base fee/per-kg fee, currency, validity window, active state এবং optional creator |
| `AuditLog` | actor, entity/action, optional shipment/payment link, structured before/after details |

#### 4.2 Enums and relationships

- `UserRole`: ঠিক `CUSTOMER`, `COURIER`, `ADMIN`।
- `ShipmentStatus`: `CREATED`, `PICKED_UP`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `RETURNED`, `CANCELLED`।
- `PaymentStatus`: `PENDING`, `PAID`, `FAILED`, `REFUND_PENDING`, `REFUNDED`।
- `PaymentProvider`: `STRIPE`, `SSLCOMMERZ`, `BKASH`; বাস্তবে একটিমাত্র provider Step-9-এ নির্বাচন/চালু হবে।
- `ShipmentEventType`, `AuditEntityType`, `WebhookProcessingStatus` timeline, audit এবং callback process-এর event category রাখে।
- User-এর customer/courier shipment relation আলাদা named relation।
- Shipment-এর origin/destination/current hub relation আলাদা named relation।
- Shipment-এর বহু event, payment ও audit log থাকতে পারে; payer ও actor nullable/set-null policy অনুযায়ী history অক্ষুণ্ণ থাকে।

#### 4.3 Database integrity, soft delete and indexes

- `id` primary key, tracking number, user email, hub code, refresh-token hash, payment idempotency key এবং provider reference-এ unique constraint।
- Webhook deduplication-এর জন্য `(provider, providerEventId)` composite unique constraint।
- User ও Shipment soft-delete timestamp দিয়ে archive হবে; Hub-ও soft-delete-capable। History/payment/audit record hard-delete করা হবে না।
- Foreign-key delete policy shipment/payment history রক্ষা করে: customer/payment reference restrict, courier/hub/actor reference প্রয়োজনে set-null, refresh session user delete-এ cascade।
- List/query pattern-এর জন্য role, customer, courier, shipment status, payment status, hub, event time, audit actor/entity এবং webhook processing state-এ index আছে।
- Email lowercase/trim করে service layer-এ save করতে হবে; এতে unique constraint একই email-এর case variants ঠেকাতে পারে।

#### 4.4 Domain rules যা Prisma schema একা enforce করতে পারে না

- Shipment status transitions এবং role/ownership authorization service-এ enforce হবে।
- একই shipment-এ একাধিক successful payment না হওয়া transaction ও business check দিয়ে enforce করতে হবে।
- Pricing rule weight range overlap বা multiple active match যেন না হয়, admin service-এ validate করতে হবে।
- Amount, weight, dimensions, currency এবং schedule-এর valid ranges Zod/service validation-এ enforce করতে হবে।
- User/Shipment/Hub soft delete query-তে `deletedAt: null` filter service-এ বাধ্যতামূলক হবে।
- Payment provider call schema transaction-এর অংশ নয়; verified callback-এর পরে DB state transaction-এ update হবে।

#### 4.5 Step-4 completion checklist

- [x] Step-1-এর fixed 3-role model-এ `HUB_MANAGER` বাদ।
- [x] Shipment lifecycle, tracking timeline, hub transfer ও soft delete-এর data model।
- [x] Real provider payment, callback idempotency, refresh-token hash ও audit history model।
- [x] Price/currency snapshot, weight-tier pricing, relational constraints සහ query indexes।
- [x] Prisma formatting, schema validation ও client generation সফল।
- [ ] Schema migration create/apply ও database-side verification Step-5-এ হবে।

Implemented schema: `prisma/schema.prisma`. Migration এখনো তৈরি/apply করা হয়নি।

---

### Step 5: Prisma migration and model setup

Initial Prisma migration তৈরি ও configured PostgreSQL database-এ apply করা হয়েছে।

Migration:

```bash
npm run prisma:migrate:status
npm run prisma:generate
```

Applied migration directory: `prisma/migrations/20261005051352_init/`.

Workflow for future schema changes:

```bash
# Local development: create and apply a named migration
npx prisma migrate dev --name describe_change

# Production: apply only checked-in migrations
npm run prisma:migrate:deploy
```

Production deployment never runs `prisma migrate dev`; migration SQL is reviewed and committed before deployment. Do not reset a database containing data to resolve migration-history errors. Back up the database and investigate/baseline its state instead.

Next.js + Prisma rules:
- Reuse the server-only Prisma singleton in `lib/prisma.ts`.
- Keep Prisma operations on the Node.js server runtime; never bundle Prisma into client code.
- `DATABASE_URL` must be configured privately in local/deployment environment.

Step-5 verification:
- [x] Migration generated and applied.
- [x] Prisma reports database schema up to date.
- [x] Expected domain tables are present in PostgreSQL.
- [x] Prisma client generation completed.
- [x] Application TypeScript check and production build pass.

---

### Step 6: Authentication and authorization setup

Implement the following:

#### Auth APIs
- POST /api/v1/auth/register
- POST /api/v1/auth/login
- POST /api/v1/auth/logout
- POST /api/v1/auth/refresh-token

#### Auth flow
1. User sends register payload
2. Validate input with Zod
3. Hash password using bcryptjs
4. Save user in DB via Prisma
5. Generate a short-lived access token and a random refresh token
6. Return the access token and safe user profile; set refresh token as an HttpOnly cookie and store only its hash

#### Protected route flow
1. Read access token from `Authorization: Bearer <token>`
2. Verify it server-side in the Route Handler/auth helper
3. Load/validate the active account and establish trusted user context
4. Check role and resource ownership in the service
5. Allow the operation or return a structured authorization error

Role guard examples:
- `requireRole('ADMIN')`
- `requireRole('COURIER')`

Refresh/logout routes use the HttpOnly refresh cookie, rotate/revoke the stored token hash, and apply CSRF protections. Protected API routes must verify auth server-side; do not rely on client-side checks or a routing proxy alone.

#### Implemented Step-6 behavior

- Registration accepts only name, email, password and optional phone; role is always `CUSTOMER`. Zod rejects unknown fields and normalizes email.
- Passwords use bcryptjs cost 12, with a 12-character minimum and bcrypt's 72-byte maximum.
- Access JWT is HS256, 15 minutes, and includes issuer/audience/type. `JWT_ACCESS_SECRET` must be at least 32 bytes.
- Refresh tokens are 256-bit random values; only SHA-256 hashes are stored. Tokens rotate atomically, expire after 30 days, and are revoked at logout.
- Refresh token is HttpOnly, SameSite=Lax, Secure in production, and scoped to `/api/v1/auth`.
- Login uses a generic invalid-credentials response, checks active/non-deleted account state, and records an audit event.
- `requireUser()` verifies the bearer token and reloads current user role/activity from PostgreSQL; `requireRole()` enforces allowed roles server-side.
- `/api/v1/users/me` is protected and returns only a safe user profile.
- Register/login/refresh/logout have per-client rate limits. Local development warns and uses an in-process fallback; production requires Upstash.
- Cookie endpoints validate any supplied Origin against `ALLOWED_ORIGIN` (local default: `http://localhost:3000`).
- A one-time Prisma seed provisions the first Admin from `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`; it refuses to promote an existing customer or create a second admin.
- The refresh endpoint returns 401 when its cookie is absent or invalid and clears invalid/expired cookies rather than returning a success-shaped response.
- `npm run prisma:seed` uses a PostgreSQL advisory lock to prevent concurrent first-admin bootstrap; configure temporary bootstrap credentials in the private environment and remove them afterward.
- Auth request bodies require `application/json` and are streamed with a 16 KiB maximum; missing production rate-limit configuration returns HTTP 503 rather than silently bypassing protection.
- Email is trimmed and lowercased before validation. Auth responses use `Cache-Control: no-store`; browser cookie requests without Origin reject cross-site fetch metadata, and rejected origins do not clear the refresh cookie.
- Repeatable verification: `npm run test:auth` (Node.js 24 helper regression tests), `npm run test:auth:integration` (development database/API lifecycle and concurrent rotation test), `npm run typecheck`, and `npm run build`. Integration tests create and remove a unique test account; use a development/test database.
- Setup and request examples: `docs/authentication.md`.

#### Step-6 acceptance checklist

- [x] Register/login/logout/refresh Route Handlers and input schemas.
- [x] Fixed-role registration, password hashing, safe user responses.
- [x] Access-token authentication and reusable role guard.
- [x] Hashed refresh-token storage, rotation, expiry, revocation and cookie handling.
- [x] Rate limits and cookie-origin check.
- [x] Protected `GET /api/v1/users/me`.
- [x] Safe one-time initial Admin bootstrap.
- [x] End-to-end register/profile/refresh rotation and replay rejection/login/logout/revocation tested using a temporary smoke-test account, then removed.
- [ ] Set a private `JWT_ACCESS_SECRET` in local/deployment environment and configure Upstash before production auth use.

---

### Step 7: User profile APIs

Implement:

- GET /api/v1/users/me
- PATCH /api/v1/users/me
- GET /api/v1/users/:id
- PATCH /api/v1/users/:id/role (Admin only)
- GET /api/v1/users (Admin only, with pagination/filter)

Responsibilities:
- fetch user profile
- edit profile details
- update role
- manage active/inactive status

---

### Step 8: Shipment module core logic

Implement shipment APIs:

- POST /api/v1/shipments
- GET /api/v1/shipments
- GET /api/v1/shipments/:id
- PATCH /api/v1/shipments/:id/status
- PATCH /api/v1/shipments/:id/assign-courier
- GET /api/v1/shipments/my-shipments
- GET /api/v1/shipments/search?q=keyword

Shipment flow:

1. Customer creates shipment with pickup and delivery address
2. Validate required data
3. Generate tracking number
4. Save shipment
5. Create shipment audit log
6. Assign courier if needed
7. Update shipment status through valid transition rules

Example valid transitions:
- CREATED -> PICKED_UP -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED
- FAILED -> RETURNED -> CANCELLED (depending on business rule)

---

### Step 9: Payment integration

Implement payment APIs:

- POST /api/v1/payments/initiate
- GET /api/v1/payments/:id
- GET /api/v1/payments/my-payments
- POST /api/v1/payments/webhook

Payment flow:

1. Customer initiates payment for shipment
2. Validate shipment and amount
3. Create payment record with status PENDING
4. Call Stripe / SSLCommerz / bKash API
5. Receive callback or webhook
6. Update payment status to PAID / FAILED / REFUNDED
7. Update shipment paymentStatus
8. Write audit log

Important:
- No fake manual payment update
- Payment flow must be real and secure

---

### Step 10: Admin dashboard and operations

Admin APIs:

- GET /api/v1/admin/dashboard-stats
- GET /api/v1/admin/users
- PATCH /api/v1/admin/users/:id/role
- GET /api/v1/admin/audit-logs
- GET /api/v1/admin/shipments

Admin responsibilities:
- view total users
- view active shipment count
- view payment status summary
- role assignment
- monitor shipment status
- inspect audit logs

---

### Step 11: Search, filter, sort, pagination

At least one list API must support these features.

Examples:

- GET /api/v1/shipments?page=1&limit=10
- GET /api/v1/shipments?status=IN_TRANSIT
- GET /api/v1/shipments?sortBy=createdAt&order=desc
- GET /api/v1/shipments/search?q=Dhaka

Implement logic:
- where conditions for filters
- sortBy orderBy
- skip/take for pagination
- search with matching fields

---

### Step 12: Soft delete and audit logging

#### Soft delete
- Instead of hard delete, set `deletedAt`
- All queries should include `deletedAt: null`

#### Audit log
Record critical changes:
- role change
- shipment status update
- payment status update
- courier assignment
- cancellation
- delivery completion

Every log should store:
- userId
- shipmentId
- action
- details
- createdAt

---

### Step 13: Validation and error structure

Use Zod for request validation.

All endpoints must return consistent format:

#### Success
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

#### Error
```json
{
  "success": false,
  "message": "Something went wrong",
  "errors": []
}
```

Implement:
- validation middleware
- global error handler
- not found route handler

---

### Step 14: Security implementation

Security checklist:

- Helmet for security headers
- CORS configuration
- Rate limiting
- Password hashing with bcryptjs
- JWT for auth
- Role checks
- No secret leakage
- Input validation
- Database transactions for critical actions

---

### Step 15: Documentation

Create API docs using:
- Postman collection
- Swagger/OpenAPI
- Request examples and response examples

Document all endpoints and auth token usage.

---

### Step 16: Testing and verification

Before final submission:

1. Test register/login/logout
2. Test auth guard for protected routes
3. Test shipment creation and status changes
4. Test courier assignment
5. Test payment initiation and callback
6. Test admin dashboard
7. Test invalid role access
8. Test soft delete
9. Test pagination/filter/search
10. Test error responses

---

### Step 17: Final project readiness

Before final submission confirm:

- 3 fixed roles exist
- 20+ meaningful APIs implemented
- Payment integration works
- Auth + RBAC is enforced
- Pagination/filter/search implemented
- Soft delete used
- Audit logs implemented
- Response format standardized
- Security protections enabled
- Postman/Swagger docs ready
- Next.js App Router patterns used consistently
- Prisma schema and queries verified against the database

---

## 4. Final Recommended Execution Order

1. Setup project structure and environment
2. Define Prisma schema and migration
3. Create auth flow and JWT
4. Implement user APIs
5. Implement shipment APIs
6. Add payment flow
7. Add admin APIs
8. Add audit logs and soft delete
9. Add validation and security
10. Add documentation and testing
11. Final deployment prep

---

## 5. Minimum Endpoint Checklist

### Authentication
- POST /api/v1/auth/register
- POST /api/v1/auth/login
- POST /api/v1/auth/logout
- POST /api/v1/auth/refresh-token

### User
- GET /api/v1/users/me
- PATCH /api/v1/users/me
- GET /api/v1/users/:id
- PATCH /api/v1/users/:id/role

### Shipment
- POST /api/v1/shipments
- GET /api/v1/shipments
- GET /api/v1/shipments/:id
- PATCH /api/v1/shipments/:id/status
- PATCH /api/v1/shipments/:id/assign-courier
- GET /api/v1/shipments/my-shipments
- GET /api/v1/shipments/search

### Payment
- POST /api/v1/payments/initiate
- GET /api/v1/payments/:id
- GET /api/v1/payments/my-payments
- POST /api/v1/payments/webhook

### Admin
- GET /api/v1/admin/dashboard-stats
- GET /api/v1/admin/users
- PATCH /api/v1/admin/users/:id/role
- GET /api/v1/admin/audit-logs

This is the minimum meaningful set, and more can be added based on actual business needs.

---

## 6. Final Outcome

Project complete হলে backend API-টি should be:

- secure
- scalable
- role-based
- transaction-safe
- payment capable
- audit-driven
- real logistics workflow oriented

This implementation will satisfy the project requirements and give a strong base for future deployment.
