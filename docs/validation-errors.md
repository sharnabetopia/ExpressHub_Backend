# Validation and error responses (Step 13)

Application Route Handlers use the shared response helpers in `lib/http/responses.ts`. `toErrorResponse` in `lib/http/errors.ts` is the central application-error formatter; the existing `handleRouteError` delegates to it. Route Handlers catch their own errors because Next.js does not use Express-style global error middleware.

## Response contract

Success: `{ "success": true, "message": "Operation successful", "data": {} }`.

Application error:

```json
{
  "success": false,
  "message": "Authentication required",
  "errors": [{ "code": "UNAUTHENTICATED" }]
}
```

Zod validation error:

```json
{
  "success": false,
  "message": "Request validation failed",
  "errors": [{ "path": "reason", "message": "Too small: expected string to have >=3 characters" }]
}
```

Validation entries include dotted field paths (including array indexes) and messages; application errors normally use codes. Do not depend on exact Zod wording. All shared JSON responses, health responses, unknown-endpoint errors and rejected CORS preflights use `Cache-Control: no-store`.

| Status | Meaning / examples |
|---|---|
| 400 | Zod validation, malformed JSON, duplicate query parameters, invalid webhook signature |
| 401 | Missing/invalid authentication or unavailable account |
| 403 | Insufficient role or rejected origin |
| 404 | Missing/inaccessible resource, or `ENDPOINT_NOT_FOUND` for an unmatched API route |
| 409 | Business state conflict or exhausted conflict retries |
| 413 | Request body exceeds its limit |
| 415 | JSON body endpoint received an unsupported media type |
| 429 | Rate limited; includes `Retry-After` |
| 500 | Unexpected application exception: generic `INTERNAL_SERVER_ERROR` |
| 502/503 | Provider failure, unavailable configuration, retryable processing or database health failure |

Unknown exceptions are not returned to clients. The central handler logs a fixed failure message instead of dumping arbitrary exceptions that might contain SQL, passwords or provider payloads. It does not yet provide request-ID tracing or detailed sanitized diagnostic logging.

## Validation boundaries

- Body endpoints use Zod schemas and the existing streamed JSON parser. It requires `application/json` (parameters such as charset are accepted), rejects malformed/missing JSON, and enforces a 16 KiB limit without trusting Content-Length alone.
- Schemas validate IDs, enums, lengths, numbers, allowed fields and cross-field business inputs. Authentication and role checks occur before protected body processing.
- Lists use the shared duplicate-query check and strict endpoint-specific schemas; see [list queries](list-queries.md).
- Stripe webhooks intentionally use their separate bounded raw-body parser and signature check; JSON parsing before signature verification would invalidate the signature.
- Health checks now use the same success/error helpers. An unavailable database returns 503 `DATABASE_UNAVAILABLE`, without connection details.

## Unknown routes and protocol behavior

`app/api/[[...path]]/route.ts` provides a JSON 404 for unmatched paths under `/api`, including `/api` itself and unknown API versions. Existing static/dynamic routes take precedence. The fallback handles GET, POST, PUT, PATCH, DELETE and HEAD; HEAD responses have no body by HTTP convention.

CORS Proxy runs before routing: approved OPTIONS preflights remain empty 204 responses, while rejected preflights return the JSON 403 envelope. This behavior also applies to unknown paths. Unsupported methods on existing endpoints still use Next.js's automatic 405 behavior. Non-API paths, framework startup failures and infrastructure-generated responses are outside the application JSON contract.

## Verification

```bash
npm run test:errors
npm run test:auth
npm run test:payments
npm run build
npm run test:errors:integration
```

The unit tests cover application/validation errors, body rejection, safe unexpected-error logging, success envelopes and rate-limit headers. The HTTP suite starts the production build on port 3196 (override with `ERROR_TEST_PORT`) and verifies unknown routes across methods, HEAD, existing route precedence, health failure, CORS headers and preflight behavior. It supplies an intentionally unavailable local database, creates no database records, and makes no provider calls. Node.js 24 is required.
