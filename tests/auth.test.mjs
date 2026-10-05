import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import jwt from "jsonwebtoken";

// Run server-only TypeScript helpers in Node without a browser or Next server.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

process.env.JWT_ACCESS_SECRET = "test-only-secret-with-at-least-32-bytes";
process.env.ALLOWED_ORIGIN = "http://localhost:3000";

let currentUser = null;
globalThis.prisma = {
  user: {
    async findFirst({ where }) {
      assert.equal(where.isActive, true);
      assert.equal(where.deletedAt, null);
      return currentUser;
    },
  },
};

const { registerSchema, loginSchema } = await import("../validators/auth.ts");
const tokens = await import("../lib/auth/tokens.ts");
const { requireUser, requireRole } = await import("../lib/auth/require-user.ts");
const { parseRequestBody } = await import("../lib/auth/route-helpers.ts");
const { successResponse, errorResponse } = await import("../lib/http/responses.ts");
const { AppError } = await import("../lib/http/errors.ts");

const registration = { name: "Test Customer", email: " TEST@example.com ", password: "a-secure-password" };

test("normalizes email and rejects registration privilege escalation", () => {
  assert.equal(registerSchema.parse(registration).email, "test@example.com");
  assert.equal(loginSchema.parse(registrationWithoutName()).email, "test@example.com");
  for (const field of ["role", "isActive", "id", "passwordHash"]) {
    assert.equal(registerSchema.safeParse({ ...registration, [field]: "ADMIN" }).success, false);
  }
  assert.equal(registerSchema.safeParse({ ...registration, password: "short" }).success, false);
  assert.equal(registerSchema.safeParse({ ...registration, password: "😀".repeat(19) }).success, false);
});

function registrationWithoutName() {
  const { name, ...input } = registration;
  return input;
}

test("access tokens enforce signature, algorithm, expiry, audience and token type", () => {
  const token = tokens.signAccessToken({ userId: "customer-id", role: "CUSTOMER" });
  assert.deepEqual(tokens.verifyAccessToken(token), { userId: "customer-id", role: "CUSTOMER" });
  const claims = jwt.decode(token);
  assert.equal(claims.exp - claims.iat, 900);
  assert.throws(() => tokens.verifyAccessToken(`${token}tampered`));
  for (const override of [{ exp: 1 }, { aud: "another-app" }, { tokenType: "refresh" }, { role: "OWNER" }]) {
    const invalid = jwt.sign({ ...claims, ...override }, process.env.JWT_ACCESS_SECRET);
    assert.throws(() => tokens.verifyAccessToken(invalid));
  }
  assert.throws(() => tokens.verifyAccessToken(jwt.sign(claims, process.env.JWT_ACCESS_SECRET, { algorithm: "HS384" })));
});

test("refresh tokens are random and stored as deterministic hashes", () => {
  const first = tokens.createRefreshToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, tokens.createRefreshToken());
  assert.match(tokens.hashRefreshToken(first), /^[a-f0-9]{64}$/);
  assert.equal(tokens.hashRefreshToken(first), tokens.hashRefreshToken(first));
  assert.equal(tokens.refreshTokenCookie.httpOnly, true);
  assert.equal(tokens.refreshTokenCookie.sameSite, "lax");
});

test("cookie requests reject foreign origins and cross-site fetch metadata", () => {
  const request = (headers) => new Request("http://localhost:3000/api/v1/auth/logout", { headers });
  assert.equal(tokens.isAllowedCookieRequest(request({})), true);
  assert.equal(tokens.isAllowedCookieRequest(request({ origin: "http://localhost:3000" })), true);
  assert.equal(tokens.isAllowedCookieRequest(request({ origin: "https://attacker.example" })), false);
  assert.equal(tokens.isAllowedCookieRequest(request({ origin: "null" })), false);
  assert.equal(tokens.isAllowedCookieRequest(request({ "sec-fetch-site": "cross-site" })), false);
});

test("auth requires an active account and uses the current database role", async () => {
  await assert.rejects(requireUser(new Request("http://localhost")), { status: 401 });
  const request = new Request("http://localhost", {
    headers: { authorization: `Bearer ${tokens.signAccessToken({ userId: "customer-id", role: "ADMIN" })}` },
  });
  await assert.rejects(requireUser(request), { status: 401 });
  currentUser = { id: "customer-id", name: "Test Customer", email: "test@example.com", role: "CUSTOMER" };
  const user = await requireUser(request);
  assert.equal(user.role, "CUSTOMER");
  assert.throws(() => requireRole(user, "ADMIN"), { status: 403 });
  assert.equal(requireRole(user, "CUSTOMER"), user);
  currentUser = null;
});

test("JSON bodies enforce media type, valid JSON and streaming size limit", async () => {
  const request = (body, contentType = "application/json") => new Request("http://localhost", {
    method: "POST", headers: { "content-type": contentType }, body,
  });
  assert.equal((await parseRequestBody(request(JSON.stringify(registration)), registerSchema)).email, "test@example.com");
  await assert.rejects(parseRequestBody(request("{}", "text/plain"), registerSchema), { status: 415 });
  await assert.rejects(parseRequestBody(request("{"), registerSchema), { status: 400 });
  await assert.rejects(parseRequestBody(request("x".repeat(16385)), registerSchema), { status: 413 });
});

test("auth responses forbid caching", () => {
  assert.equal(successResponse("OK", { accessToken: "secret" }).headers.get("cache-control"), "no-store");
  assert.equal(errorResponse(new AppError(401, "Unauthorized", "UNAUTHENTICATED")).headers.get("cache-control"), "no-store");
});
