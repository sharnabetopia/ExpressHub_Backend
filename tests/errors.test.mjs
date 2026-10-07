import "./helpers/typescript.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { z } from "zod";
const { AppError } = await import("../lib/http/errors.ts");
const { errorResponse, successResponse, tooManyRequestsResponse } = await import("../lib/http/responses.ts");
const { handleRouteError, parseRequestBody } = await import("../lib/auth/route-helpers.ts");

test("shared error handler preserves application status/code and validation field paths", async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 415, 429, 502, 503]) {
    const response = handleRouteError(new AppError(status, "Expected error", "EXPECTED"));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { success: false, message: "Expected error", errors: [{ code: "EXPECTED" }] });
  }
  const result = z.object({ items: z.array(z.object({ name: z.string() })) }).safeParse({ items: [{ name: 123 }] });
  const response = errorResponse(result.error);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.errors[0].path, "items.0.name");
  assert.equal(body.errors[0].input, undefined);
});

test("unexpected errors do not expose exception contents in responses or logs", async () => {
  const logger = mock.method(console, "error", () => {});
  try {
    const response = handleRouteError(new Error("secret-password SQL provider-payload"));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, message: "Something went wrong", errors: [{ code: "INTERNAL_SERVER_ERROR" }] });
    assert.deepEqual(logger.mock.calls[0].arguments, ["Unhandled API error"]);
  } finally { logger.mock.restore(); }
});

test("body validation produces consistent errors for malformed, oversized and invalid JSON", async () => {
  const schema = z.object({ name: z.string().min(2) }).strict();
  for (const [body, contentType, status] of [["{", "application/json", 400], ['{"extra":1}', "application/json", 400], ["null", "application/json", 400], ["{}", "text/plain", 415], ["x".repeat(16385), "application/json", 413]]) {
    let error;
    try { await parseRequestBody(new Request("http://localhost", { method: "POST", headers: { "content-type": contentType }, body }), schema); }
    catch (caught) { error = caught; }
    assert.ok(error);
    const response = handleRouteError(error);
    assert.equal(response.status, status);
    assert.ok(Array.isArray((await response.json()).errors));
  }
});

test("success and rate-limit responses preserve their contract and headers", async () => {
  const response = successResponse("Created", { id: "test" }, 201);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, message: "Created", data: { id: "test" } });
  const limited = tooManyRequestsResponse(Date.now() + 10000);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await limited.json()).errors[0].code, "RATE_LIMITED");
});
