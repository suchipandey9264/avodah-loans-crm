// Production safety switches.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startStack } from "./harness.js";

let s;
before(async () => { s = await startStack({ NODE_ENV: "production" }); });
after(() => s?.stop());

test("every API response carries the security headers", async () => {
  const res = await fetch(`${s.base}/health`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-powered-by"), null);
});

