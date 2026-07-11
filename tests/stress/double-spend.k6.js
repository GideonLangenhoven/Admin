// Phase 1.2 — double-spend race on the last seat. Fires VUS concurrent
// create_hold_with_capacity_check calls (qty 1 each) at ONE stress slot.
// Pass: sum of successes == slot capacity, and slots.booked+held never exceeds
// capacity (asserted separately in SQL after the run).
//
// STRESS SLOT ONLY. create_hold_with_capacity_check is anon-callable, so the
// publishable key suffices — no service key, no real tenant touched.
//
//   k6 run -e URL=https://<ref>.supabase.co -e KEY=<publishable> \
//          -e SLOT=<stress_slot_id> -e BOOKINGS=<id1,id2,...> \
//          tests/stress/double-spend.k6.js

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BOOKINGS = (__ENV.BOOKINGS || '').split(',').filter(Boolean);
const RPC = `${__ENV.URL}/rest/v1/rpc/create_hold_with_capacity_check`;
const KEY = __ENV.KEY;
const SLOT = __ENV.SLOT;

const reserved = new Counter('holds_reserved');
const rejected = new Counter('holds_rejected');

export const options = {
  scenarios: { race: { executor: 'per-vu-iterations', vus: BOOKINGS.length, iterations: 1, maxDuration: '30s' } },
};

export default function () {
  const bookingId = BOOKINGS[__VU - 1];
  if (!bookingId) return;
  const res = http.post(RPC, JSON.stringify({
    p_booking_id: bookingId,
    p_slot_id: SLOT,
    p_qty: 1,
    p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  }), { headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY } });

  check(res, { 'http 200': (r) => r.status === 200 });
  let success = false;
  try { success = JSON.parse(res.body).success === true; } catch (_e) { /* ignore */ }
  if (success) reserved.add(1); else rejected.add(1);
}
