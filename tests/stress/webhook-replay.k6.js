// Phase 1.1 — Yoco webhook replay & duplication. THE proven pattern; clone
// per scenario (1.2 double-spend hits create-checkout, etc.).
//
// STRESS TENANT ONLY. Never point BASE at a real operator's function URL with
// a real signing secret. Yoco test mode ON.
//
//   k6 run -e BASE=https://<ref>.supabase.co/functions/v1 \
//          -e SECRET=<test_webhook_secret> \
//          -e PAYMENT_ID=test_pay_stress_001 \
//          -e CHECKOUT_ID=<stress_booking_checkout_id> \
//          tests/stress/webhook-replay.k6.js
//
// Pass (assert AFTER the run with invariants.sql + the two queries at the end):
//   exactly one booking PAID, one invoice, one confirmation; 49 return 200 with
//   no duplicate side effects (idempotency_keys holds).

import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';

const BASE = __ENV.BASE;
const SECRET = __ENV.SECRET;
const PAYMENT_ID = __ENV.PAYMENT_ID || 'test_pay_stress_001';
const CHECKOUT_ID = __ENV.CHECKOUT_ID;

// 50 concurrent identical deliveries, once.
export const options = { scenarios: { replay: { executor: 'per-vu-iterations', vus: 50, iterations: 1 } } };

export default function () {
  const body = JSON.stringify({
    type: 'payment.succeeded',
    payload: { id: PAYMENT_ID, metadata: { checkoutId: CHECKOUT_ID } },
  });
  // Yoco signs `${id}.${timestamp}.${body}` — match yoco-webhook/index.ts verify.
  const ts = '1700000000'; // fixed so all 50 carry an identical signature
  const signed = `${PAYMENT_ID}.${ts}.${body}`;
  const sig = crypto.hmac('sha256', SECRET, signed, 'base64');

  const res = http.post(`${BASE}/yoco-webhook`, body, {
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': PAYMENT_ID,
      'webhook-timestamp': ts,
      'webhook-signature': `v1,${sig}`,
    },
  });
  // Every delivery must be accepted (200); dedup happens server-side, not via 4xx.
  check(res, { 'accepted 200': (r) => r.status === 200 });
}

// Post-run assertions (run in SQL, not here):
//   SELECT count(*) FROM bookings WHERE yoco_checkout_id = '<CHECKOUT_ID>' AND status='PAID'; -- = 1
//   SELECT count(*) FROM idempotency_keys WHERE key = 'yoco_payment:<PAYMENT_ID>';            -- = 1
//   SELECT count(*) FROM invoices WHERE booking_id = (SELECT id FROM bookings WHERE ...);      -- = 1
//   then run invariants.sql -> all PASS.
