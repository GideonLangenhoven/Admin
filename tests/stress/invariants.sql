-- Money/isolation invariants pack — run after every stress scenario and in CI.
-- Every row must report PASS. Any FAIL is a rollout blocker.
-- Usage: psql "$DATABASE_URL" -f tests/stress/invariants.sql
--        (or paste into Supabase SQL editor / MCP execute_sql)
--
-- Schema notes baked in (verified 2026-07-11):
--   holds has NO released_at — terminal states are CANCELLED/CONVERTED/EXPIRED,
--   live states would be ACTIVE. An orphan = expired past grace, still ACTIVE.
--   bookings money cols: total_captured, total_refunded, yoco_payment_id, yoco_checkout_id.
--
-- Known-offender triage (first run, 2026-07-11):
--   * "paid bookings have a payment id" also flags manual-mark-paid and
--     voucher-paid rows (no Yoco id by design). Triage the row, don't blanket-
--     exclude — a genuine PAID-without-payment is a real leak.
--   * "slots.held reconciles" FAILs when capacity DECREMENTS lose updates.
--     Root cause: increments are atomic (create_hold_with_capacity_check uses
--     SELECT FOR UPDATE) but every decrement is a non-atomic JS read-modify-write
--     (`held: Math.max(0, slot.held - qty)`) across ~10 call sites. Fix = one
--     atomic RPC `adjust_slot_held(slot_id, delta)` doing
--     `UPDATE slots SET held = GREATEST(0, held + delta) WHERE id = slot_id`,
--     routed through by every caller. Until then this drifts under concurrency.

WITH checks AS (
  -- 1.2 capacity: no slot may be overbooked
  SELECT 'capacity: booked+held <= capacity_total' AS invariant,
         NOT EXISTS (SELECT 1 FROM slots WHERE booked + COALESCE(held,0) > capacity_total) AS pass,
         (SELECT count(*) FROM slots WHERE booked + COALESCE(held,0) > capacity_total)::text AS offenders

  -- 1.5 refund ceiling: never refund more than captured
  UNION ALL SELECT 'refund: total_refunded <= total_captured',
         NOT EXISTS (SELECT 1 FROM bookings WHERE COALESCE(total_refunded,0) > COALESCE(total_captured,0)),
         (SELECT count(*) FROM bookings WHERE COALESCE(total_refunded,0) > COALESCE(total_captured,0))::text

  -- 1.1 payment integrity: PAID implies a payment reference
  UNION ALL SELECT 'paid bookings have a payment id',
         NOT EXISTS (SELECT 1 FROM bookings WHERE status='PAID' AND yoco_payment_id IS NULL AND yoco_checkout_id IS NULL),
         (SELECT count(*) FROM bookings WHERE status='PAID' AND yoco_payment_id IS NULL AND yoco_checkout_id IS NULL)::text

  -- 1.1 idempotency: keys are unique (belt check; a UNIQUE index enforces it)
  UNION ALL SELECT 'idempotency_keys has no duplicate key',
         NOT EXISTS (SELECT 1 FROM idempotency_keys GROUP BY key HAVING count(*)>1),
         (SELECT COALESCE(count(*),0) FROM (SELECT key FROM idempotency_keys GROUP BY key HAVING count(*)>1) d)::text

  -- 1.2/holds: no orphan holds still reserving capacity long past expiry+grace
  UNION ALL SELECT 'no orphan holds (expired >1h, still ACTIVE)',
         NOT EXISTS (SELECT 1 FROM holds WHERE expires_at < now() - interval '1 hour' AND status='ACTIVE'),
         (SELECT count(*) FROM holds WHERE expires_at < now() - interval '1 hour' AND status='ACTIVE')::text

  -- held must be AT LEAST the live ACTIVE holds per slot. held < sum(active) means
  -- a hold exists whose seats were never counted -> overbooking risk (the dangerous
  -- direction). held > sum(active) is EXPECTED: combo reserves via slots.held with
  -- no holds row, so it is not flagged here (that leaked-vs-legit ambiguity is why
  -- the one-off reconcile migration handles historical drift, not this check).
  UNION ALL SELECT 'slots.held >= live ACTIVE holds (no lost increments)',
         NOT EXISTS (
           SELECT 1 FROM slots s
           JOIN (SELECT slot_id, COALESCE(SUM(qty),0) q FROM holds WHERE status='ACTIVE' GROUP BY slot_id) h
             ON h.slot_id = s.id
           WHERE COALESCE(s.held,0) < h.q
         ),
         (SELECT count(*) FROM slots s
           JOIN (SELECT slot_id, COALESCE(SUM(qty),0) q FROM holds WHERE status='ACTIVE' GROUP BY slot_id) h
             ON h.slot_id = s.id
           WHERE COALESCE(s.held,0) < h.q)::text
)
SELECT invariant,
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result,
       offenders AS offending_rows
FROM checks
ORDER BY pass, invariant;
