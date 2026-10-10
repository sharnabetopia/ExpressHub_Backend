import "./helpers/typescript.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

// Any database access would fail: return routes must never settle or disclose a payment.
globalThis.prisma = new Proxy({}, { get() { throw new Error("Unexpected database access"); } });
for (const path of ["success", "cancel"]) {
  const { GET } = await import(`../app/api/v1/payments/return/${path}/route.ts`);
  test(`${path} redirect does not confirm or modify payment`, async () => {
    const response = await GET(new Request("http://localhost?session_id=forged"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.data.paymentConfirmed, false);
    assert.equal(body.data.checkout, path === "success" ? "returned" : "cancelled");
    assert.equal(body.data.payment, undefined);
  });
}
