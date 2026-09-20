// Phase 1.1 — Yoco webhook replay & duplication. THE proven pattern; clone
// per scenario (1.2 double-spend hits create-checkout, etc.).
//
// STRESS TENANT ONLY. Never point BASE at a real operator's function URL with
// a real signing secret. Yoco test mode ON.
//
//   k6 run -e BASE=https://<ref>.supabase.co/functions/v1 \
//          -e SECRET=<test_webhook_secret> \
//          -e PAYLOAD_FILE=/private/tmp/test-payment-event.json \
//          tests/stress/webhook-replay.k6.js
//
// Pass (assert AFTER the run with invariants.sql + the two queries at the end):
//   exactly one booking PAID, one invoice, one confirmation; 49 return 200 with
//   no duplicate side effects (idempotency_keys holds).

import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE;
const SECRET = __ENV.SECRET;
if (!BASE || !SECRET || !__ENV.PAYLOAD_FILE) throw new Error('BASE, SECRET and a captured PAYLOAD_FILE are required');
const event = JSON.parse(open(__ENV.PAYLOAD_FILE));
if (event.type !== 'payment.succeeded' || event.payload?.mode !== 'test'
    || !event.payload.id || !Number.isSafeInteger(event.payload.amount)
    || event.payload.amount <= 0 || event.payload.currency !== 'ZAR') {
  throw new Error('Use a complete payment.succeeded event from a Yoco TEST checkout');
}
const body = JSON.stringify(event);
const signingKey = encoding.b64decode(SECRET.replace(/^whsec_/, ''));

// 50 concurrent identical deliveries, once.
export const options = {
  scenarios: { replay: { executor: 'per-vu-iterations', vus: 50, iterations: 1, maxDuration: '60s' } },
  thresholds: { checks: ['rate==1'] },
};

export default function () {
  let res;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ts = String(Math.floor(Date.now() / 1000));
    const id = event.id || event.payload.id;
    const sig = crypto.hmac('sha256', signingKey, `${id}.${ts}.${body}`, 'base64');
    res = http.post(`${BASE}/yoco-webhook`, body, { headers: {
      'Content-Type': 'application/json', 'webhook-id': id,
      'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}`,
    } });
    // A concurrent processing lease deliberately asks the provider to retry.
    if (res.status !== 503) break;
    sleep(1);
  }
  check(res, { 'event eventually acknowledged': r => r.status === 200 });
}

// Post-run assertions (run in SQL, not here):
//   SELECT count(*) FROM bookings WHERE yoco_checkout_id = '<CHECKOUT_ID>' AND status='PAID'; -- = 1
//   SELECT count(*) FROM idempotency_keys WHERE key = 'yoco_payment:<BUSINESS_ID>:test:<PAYMENT_ID>'; -- = 1
//   SELECT count(*) FROM invoices WHERE booking_id = (SELECT id FROM bookings WHERE ...);      -- = 1
//   then run invariants.sql -> all PASS.
