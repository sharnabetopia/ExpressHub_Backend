# Authentication (Step 6)

Configure `DATABASE_URL`, `ALLOWED_ORIGIN` (the exact browser origin), and a private
`JWT_ACCESS_SECRET` of at least 32 random bytes in `.env`. Generate a secret with
`openssl rand -hex 32`. Production also requires `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`; development uses process-local rate limiting.
The deployment proxy must overwrite client-supplied `X-Real-IP` and
`X-Forwarded-For` headers with trusted client IP information.

Run migrations with `npm run prisma:migrate:deploy`, then `npm run dev`.

| Method | Endpoint | Input / authentication |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | JSON name, email, password, optional phone |
| POST | `/api/v1/auth/login` | JSON email, password |
| POST | `/api/v1/auth/refresh-token` | Refresh cookie |
| POST | `/api/v1/auth/logout` | Refresh cookie; idempotent when absent |
| GET | `/api/v1/users/me` | `Authorization: Bearer <accessToken>` |

Register example:

```json
{
  "name": "Example Customer",
  "email": "customer@example.com",
  "password": "use-a-unique-password",
  "phone": "+8801700000000"
}
```

Registration always creates a `CUSTOMER`; unknown fields including `role` are
rejected. Passwords require at least 12 characters and at most 72 UTF-8 bytes.
Email is trimmed and lowercased before validation. JSON bodies are limited to
16 KiB. Register returns 201; successful login, refresh, logout and profile return
200. Responses use `{ success, message, data }`; errors use
`{ success: false, message, errors }`.

Register/login return `data.user` and `data.accessToken`. Save the access token
and send it as a Bearer token for protected requests. JWTs expire after 15 minutes.
Every protected request reloads account activity and role from the database.
Services can call `requireRole(user, "ADMIN")` after `requireUser(request)`;
resource ownership must also be checked when resource APIs are implemented.

Use the Postman cookie jar (or browser `credentials: "include"`) to retain the
`expresshub_refresh` cookie. It is HttpOnly, SameSite=Lax, scoped to `/api/v1/auth`,
Secure in production, and expires after 30 days. Each refresh rotates the token;
only one concurrent refresh can succeed. Missing, expired or reused tokens return
401. Logout revokes the refresh token and clears the cookie. Existing access
tokens remain valid until expiry unless the account is deactivated or deleted.
Cross-site browser deployments must account for the SameSite=Lax cookie policy.

To bootstrap the first Admin, temporarily configure `ADMIN_NAME`, `ADMIN_EMAIL`,
and `ADMIN_PASSWORD`, then run `npm run prisma:seed`. Remove these bootstrap
credentials afterward. The seed is serialized with a database advisory lock and
refuses to promote an existing customer or provision a second Admin.

Verification (Node.js 24):

```bash
npm run test:auth
npm run test:auth:integration
npm run typecheck
npm run build
```

The integration test starts a development server on port 3197 (override with
`AUTH_TEST_PORT`), uses the configured development/test database, and creates and
removes one unique temporary account with its sessions and audit records. It
checks registration, duplicate email, safe profile, hashed refresh storage,
concurrent rotation, replay rejection, login/logout, and account deactivation.
Do not run it against a production database or alongside another `next dev`
process in this checkout.
