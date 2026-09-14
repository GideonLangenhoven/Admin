-- Phase 3.1 — synthetic tenant fleet. Service-role only. Marker-prefixed so the
-- whole fleet deletes in one WHERE. Run on the live project during an ANNOUNCED
-- window (pg_cron is shared) or, better, a branch project.
--
-- Scale knobs at top. Default 1500 tenants x (2 tours, 30 future slots,
-- 20 tomorrow-trip bookings). Pure inserts, no app code.
--
-- TEARDOWN (run first if re-seeding):
--   DELETE FROM bookings WHERE customer_email LIKE 'stress+%@example.test';
--   DELETE FROM slots  WHERE tour_id IN (SELECT id FROM tours WHERE name LIKE 'STRESS %');
--   DELETE FROM tours  WHERE name LIKE 'STRESS %';
--   DELETE FROM businesses WHERE name LIKE 'STRESS %';

\set n_tenants 1500

WITH tenant AS (
  INSERT INTO businesses (name, subdomain, created_at)
  SELECT 'STRESS ' || g, 'stress-' || g, now()
  FROM generate_series(1, :n_tenants) g
  RETURNING id, subdomain
),
tour AS (
  INSERT INTO tours (business_id, name, duration_minutes, default_capacity, base_price_per_person)
  SELECT t.id, 'STRESS ' || t.subdomain || ' tour ' || k, 90, 12, 500
  FROM tenant t, generate_series(1, 2) k
  RETURNING id, business_id
),
slot AS (
  INSERT INTO slots (business_id, tour_id, start_time, capacity_total, booked, held, status)
  SELECT tr.business_id, tr.id, now() + (d || ' days')::interval, 12, 0, 0, 'OPEN'
  FROM tour tr, generate_series(1, 30) d
  RETURNING id, business_id, tour_id
)
INSERT INTO bookings (business_id, tour_id, slot_id, customer_name, customer_email, phone, qty, status, total_amount, created_at)
SELECT s.business_id, s.tour_id, s.id,
       'Stress Guest', 'stress+' || s.business_id || '@example.test', '+27000000000',
       1, 'PAID', 500, now()
FROM (
  -- 20 bookings on the nearest (tomorrow) slot per tenant, so cron reminders fire
  SELECT DISTINCT ON (business_id) id, business_id, tour_id
  FROM slot ORDER BY business_id, id
) s, generate_series(1, 20);

-- Sanity: last-seeded tenant must exist and have bookings (proves >1000 processed)
SELECT (SELECT count(*) FROM businesses WHERE name LIKE 'STRESS %') AS tenants,
       (SELECT count(*) FROM bookings WHERE customer_email LIKE 'stress+%@example.test') AS bookings;
