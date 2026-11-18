import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";

test("mobile checkout return is a static acknowledgement, never payment confirmation", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/customization/payments/mobile-return`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://api.razorpay.com" },
    body: "razorpay_payment_id=fake&razorpay_signature=%3Cscript%3Ebad%3C%2Fscript%3E",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  const html = await response.text();
  assert.match(html, /check your payment status securely in the app/);
  assert.doesNotMatch(html, /fake|bad|<script>|payment confirmed|payment successful/i);
});
