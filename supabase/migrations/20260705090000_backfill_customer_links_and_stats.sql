-- The Yoco webhook path never upserted customers (only the confirm-booking
-- fallback did, and its already-sent idempotency check returned before the
-- upsert), so card-paid bookings were left with customer_id NULL. OTA webhooks
-- upserted customers but never recomputed lifetime stats. Backfill both:
-- link orphaned bookings to customers, then refresh stats for every customer.
BEGIN;

DO $$
DECLARE
  rec record;
  v_customer_id uuid;
BEGIN
  FOR rec IN
    SELECT b.id AS booking_id, b.business_id, b.email, b.customer_name, b.phone
    FROM public.bookings b
    WHERE b.customer_id IS NULL
      AND b.email IS NOT NULL
      AND length(trim(b.email)) > 0
    ORDER BY b.created_at ASC
    LIMIT 50000
  LOOP
    BEGIN
      v_customer_id := public.upsert_customer(rec.business_id, rec.email, rec.customer_name, rec.phone, NULL);
      UPDATE public.bookings SET customer_id = v_customer_id WHERE id = rec.booking_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip booking %: %', rec.booking_id, SQLERRM;
    END;
  END LOOP;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.customers LOOP
    PERFORM public.recompute_customer_stats(r.id);
  END LOOP;
END $$;

COMMIT;
