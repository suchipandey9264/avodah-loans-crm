// Production safety switches.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startStack } from "./harness.js";

let s;
before(async () => { s = await startStack({ NODE_ENV: "production", OTP_DEMO: "true" }); });
after(() => s?.stop());

test("NODE_ENV=production ignores OTP_DEMO: no code in the response, a wrong code is rejected", async () => {
  const sent = await s.api("/auth/otp", { method: "POST", body: { phone: "9876543210" } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.devOtp, undefined);
  const bad = await s.api("/auth/verify", { method: "POST", body: { phone: "9876543210", otp: "123456" } });
  assert.equal(bad.status, 400);
});

test("every API response carries the security headers", async () => {
  const res = await fetch(`${s.base}/health`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-powered-by"), null);
});

