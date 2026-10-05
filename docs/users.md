# User APIs (Step 7)

All endpoints require `Authorization: Bearer <accessToken>`. PATCH requests require
`Content-Type: application/json`. Responses follow the existing
`{ success, message, data }` / `{ success: false, message, errors }` format.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/users/me` | Own profile, any active role |
| PATCH | `/api/v1/users/me` | Edit own profile, any active role |
| GET | `/api/v1/users/:id` | Owner or Admin; otherwise 404 |
| GET | `/api/v1/users` | Admin |
| PATCH | `/api/v1/users/:id/role` | Admin |
| PATCH | `/api/v1/users/:id/status` | Admin |

Profile responses return `data.user` containing `id`, `name`, `email`, `phone`,
`role`, `isActive`, `createdAt` and `updatedAt`. Password hashes, deleted records
and refresh sessions are never returned.

## Edit your profile

```http
PATCH /api/v1/users/me
Authorization: Bearer <accessToken>
Content-Type: application/json

{"name":"Updated Customer","email":"customer@example.com","phone":null}
```

Provide at least one field. Names are trimmed and must have 2–100 characters.
Emails are trimmed, lowercased and validated; duplicates return 409. Phone accepts
5–30 trimmed characters, or null to clear it. Role, active status, password and
unknown fields are rejected with 400. Email changes take effect immediately;
email verification and password changes are outside this step.

## List users

```http
GET /api/v1/users?page=1&limit=20&role=COURIER&isActive=true&q=Dhaka&sortBy=name&order=asc
Authorization: Bearer <adminAccessToken>
```

`page` defaults to 1 (maximum 1,000,000); `limit` defaults to 20 (maximum 100).
Optional `role` accepts CUSTOMER, COURIER or ADMIN. `isActive` accepts the strings
`true` or `false`. `q` searches name, email and phone case-insensitively and accepts
1–100 trimmed characters. `sortBy` accepts createdAt (default), name or email;
`order` accepts asc or desc (default). Duplicate/unknown parameters and invalid
values return 400. Results use `data.users` and
`data.pagination: { page, limit, total, totalPages }`. Sorting uses ID as a stable
tie-breaker, and rows/count share a consistent database snapshot.

## Manage access

```http
PATCH /api/v1/users/<userId>/role
Authorization: Bearer <adminAccessToken>
Content-Type: application/json

{"role":"COURIER"}
```

```http
PATCH /api/v1/users/<userId>/status
Authorization: Bearer <adminAccessToken>
Content-Type: application/json

{"isActive":false}
```

Only Admins can make these changes. Admins cannot change their own role or active
status (409); another active Admin must manage their access. Repeating an existing
value returns 200 without another audit entry. Deleted/missing targets return 404.
Role changes and deactivation revoke all stored refresh sessions for the target.
Existing access JWTs use the current database role and active status on each
request. Reactivation does not restore refresh sessions; an unexpired access JWT
can work again after reactivation.

Profile, role and status changes record actor and before/after values in audit
logs in the same transaction. Access changes recheck Admin authority inside a
serializable transaction; serialization conflicts are retried up to three attempts
and then return 409. This prevents simultaneous mutual Admin demotion from
removing both Admins' access.

## Verification

Run `npm run test:users:integration` with Node.js 24 and a development/test
`DATABASE_URL`. The test starts Next.js on port 3198 (`USER_TEST_PORT` override),
creates temporary Customer/Courier/Admin fixtures, and deletes those fixtures,
sessions and audit records afterward. Do not use a production database or run it
alongside another `next dev` process in this checkout. No schema migration is needed.
