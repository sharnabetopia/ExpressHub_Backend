# Security controls (Step 14)

ExpressHub uses Next.js headers and Proxy for HTTP controls, with authentication, validation and authorization inside Route Handlers/services. Express Helmet middleware is not used in the App Router.

## Headers and CORS

Global responses set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, restricted Permissions-Policy, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin` and disabled DNS prefetching. Production adds HSTS. Next.js's powered-by header is disabled.

API paths also set `Cross-Origin-Resource-Policy: same-origin` and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. This policy is intended for JSON endpoints, not future Swagger HTML; interactive documentation will need an appropriately scoped policy. Approved CORS fetches can read JSON; cross-origin no-CORS embedding is restricted.

`ALLOWED_ORIGIN` is one exact browser origin, including scheme/port, without a trailing slash. Local development defaults to `http://localhost:3000` when unset. Production has no default. A supplied Origin that does not match is rejected with JSON 403 before route execution, including on actual POST/PATCH/DELETE requests. No wildcard credentialed origins are allowed.

Preflights allow GET, HEAD, POST, PATCH, DELETE and OPTIONS with Authorization, Content-Type, X-CSRF-Token and Idempotency-Key. Supplied unsupported methods/headers return 403. Approved preflight responses are empty 204 with a 600-second cache lifetime. `Vary: Origin` is set on passed-through responses. Requests without Origin remain supported for server clients and provider webhooks; cookie auth endpoints additionally reject cross-site fetch metadata. CORS is not a substitute for authentication.

## Rate limits

| Scope | Limit per 15 minutes | Identity |
|---|---|---|
| Register | 5 | Trusted ingress IP or shared `unknown` bucket |
| Login | 10 | Same |
| Refresh / logout | 30 each | Same |
| All authenticated API routes combined | 300 | Verified JWT subject |
| Payment initiation | 20 additional | Current authenticated user |

The shared authenticated quota runs after signature/expiry verification and before database account lookup. Rotating a token or changing client IP cannot reset its user quota. A quota rejection returns JSON 429, `Retry-After` and `Cache-Control: no-store`. Current database role/activity checks still authorize every accepted request; the token's role alone grants no access.

Production requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Missing configuration, network failures and Upstash's timeout response fail closed with 503 for protected/auth requests. In particular, the SDK's timeout-success response is not accepted as permission. Development/test can use a process-local fixed-window fallback, which is not a distributed production limit. Each local policy, scope and identifier has a separate bucket.

Health probes, unmatched routes, invalid/missing bearer tokens and signed Stripe webhooks are not subject to the authenticated quota. Webhooks retain signature verification and their bounded body parser; provider retries must remain possible. Deployment-level ingress limits are still needed for network abuse, invalid-token floods and health probes.

### Trusted client IP setup

By default, arbitrary `X-Real-IP` and `X-Forwarded-For` values are ignored. Anonymous auth requests share an `unknown` bucket until a trusted ingress is configured. This can limit multiple users together; configure deployment ingress before public use.

Set `RATE_LIMIT_IP_HEADER` to `x-real-ip` or `x-forwarded-for` **only if** the ingress overwrites that header with one validated client IP and the application cannot be reached around the ingress. Comma-separated forwarding chains, missing/invalid IPs and unsupported header settings fall back to `unknown`. The application cannot infer whether an upstream proxy is trustworthy; setting the variable without this deployment guarantee permits spoofing. IPv4 and IPv6 addresses are validated, but equivalent IPv6 textual forms are not normalized; ingress should emit a canonical address.

## Existing application protections

- bcryptjs password hashing; generic login failures with dummy-hash comparison for missing accounts.
- Short-lived, signed access JWTs with issuer/audience/type/algorithm checks; random refresh tokens stored as hashes, rotated and revoked transactionally.
- HttpOnly, SameSite=Lax refresh cookies restricted to the auth path and Secure in production.
- Current active/non-deleted user and fixed role/ownership checks; Admin authority rechecked in critical mutation transactions.
- Strict Zod input schemas, bounded streamed JSON/raw webhook bodies, server-calculated prices and allow-listed sorting.
- Serializable critical writes, payment idempotency and signature verification, soft-deletion gates and atomic audits.
- Shared safe errors and no-store JSON responses. Unexpected errors and rate-limit failures do not dump raw exception objects into logs.
- `.env` and private environment variants are ignored; `.env.example` contains placeholders only. Do not expose secrets through NEXT_PUBLIC variables or commit deployment credentials.

## Verification and deployment

```bash
npm run test:security
npm run test:auth
npm run test:payments
npm run test:errors
npm run build
npm run test:errors:integration
```

The security suite models backend timeout/network responses without connecting to Redis and exercises real guard/response logic. Production HTTP tests verify headers, actual-origin rejection, preflight restrictions and missing-limiter failures alongside API routing. No real Redis outage or deployment ingress configuration is tested locally.

Before deployment, set a private JWT secret, exact allowed origin, Upstash credentials and payment credentials; ensure HTTPS and trusted ingress behavior. Local checks do not establish that external deployment settings are correct. No database migration is required for this step.
