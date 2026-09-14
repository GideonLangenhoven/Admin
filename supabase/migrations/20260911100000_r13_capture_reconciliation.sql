-- R13: reconcile legacy total_captured against the paid-portions convention.
--
-- Background: an older webhook path stored total_captured voucher-inclusive on
-- some rows (double subtraction), so cash refunds capped too low. The shared
-- getPaidPortions() convention is authoritative:
--   cash = total_amount, UNLESS total_amount + voucher_amount_paid exceeds the
--   pre-voucher original_total — then cash = original_total - voucher_amount_paid.
--
-- Auto-fix scope (deliberately narrow — money records):
--   Only PAID/COMPLETED rows where total_captured is HIGHER than the convention
--   cash portion are corrected downward. Rows where total_captured is LOWER are
--   left alone: a lower recorded capture may reflect a genuine partial capture,
--   and raising it without a gateway record would inflate refundable cash.
--   Every touched row is logged to public.logs (event
--   'capture_reconciled_r13') with before/after values for audit.
--   Bookings with total_refunded > 0 are skipped: never rewrite a row that has
--   already paid money back out. Combo-collector legs (combo_bookings children)
--   are skipped: their capture semantics belong to the settlement flow.
--
-- Report: public.r13_capture_report() lists every PAID/COMPLETED row whose
-- captured value disagrees with convention in EITHER direction, so the owner
-- can reconcile the lower-capture rows against Yoco records manually.

BEGIN;

CREATE OR REPLACE FUNCTION public.r13_capture_report()
RETURNS TABLE (
  booking_id uuid, business_id uuid, status text,
  total_captured numeric, convention_cash numeric,
  voucher_amount_paid numeric, original_total numeric,
  total_refunded numeric, direction text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, b.business_id, b.status,
         b.total_captured,
         CASE
           WHEN COALESCE(b.original_total, 0) > 0
                AND COALESCE(b.total_amount, 0) + COALESCE(b.voucher_amount_paid, 0) > COALESCE(b.original_total, 0)
           THEN GREATEST(0, COALESCE(b.original_total, 0) - COALESCE(b.voucher_amount_paid, 0))
           ELSE COALESCE(b.total_amount, 0)
         END AS convention_cash,
         COALESCE(b.voucher_amount_paid, 0), b.original_total,
         COALESCE(b.total_refunded, 0),
         CASE
           WHEN COALESCE(b.total_captured, 0) > CASE
             WHEN COALESCE(b.original_total, 0) > 0
                  AND COALESCE(b.total_amount, 0) + COALESCE(b.voucher_amount_paid, 0) > COALESCE(b.original_total, 0)
             THEN GREATEST(0, COALESCE(b.original_total, 0) - COALESCE(b.voucher_amount_paid, 0))
             ELSE COALESCE(b.total_amount, 0)
           END THEN 'captured_high'
           ELSE 'captured_low'
         END AS direction
    FROM bookings b
   WHERE b.status IN ('PAID', 'COMPLETED')
     AND b.total_captured IS NOT NULL
     AND ABS(COALESCE(b.total_captured, 0) - CASE
           WHEN COALESCE(b.original_total, 0) > 0
                AND COALESCE(b.total_amount, 0) + COALESCE(b.voucher_amount_paid, 0) > COALESCE(b.original_total, 0)
           THEN GREATEST(0, COALESCE(b.original_total, 0) - COALESCE(b.voucher_amount_paid, 0))
           ELSE COALESCE(b.total_amount, 0)
         END) > 0.01;
$$;
REVOKE ALL ON FUNCTION public.r13_capture_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.r13_capture_report() TO service_role;

-- Auto-fix: captured_high only, no prior refunds, no combo children.
-- Guards: logs / combo tables may not exist on lean fixtures — every
-- dependent write is existence-checked so the migration never fails open.
DO $$
DECLARE
  r RECORD;
  v_cash numeric;
  v_fixed integer := 0;
  v_skipped_refunded integer := 0;
  v_skipped_combo integer := 0;
  v_has_logs boolean := to_regclass('public.logs') IS NOT NULL;
  v_has_combo_items boolean := to_regclass('public.combo_booking_items') IS NOT NULL;
  v_is_combo boolean;
BEGIN
  FOR r IN
    SELECT b.id, b.business_id, b.total_captured, b.total_amount,
           b.voucher_amount_paid, b.original_total,
           COALESCE(b.is_combo, false) AS is_combo,
           b.combo_booking_id
      FROM bookings b
     WHERE b.status IN ('PAID', 'COMPLETED')
       AND b.total_captured IS NOT NULL
       AND COALESCE(b.total_refunded, 0) = 0
  LOOP
    IF r.original_total IS NOT NULL AND r.original_total > 0
       AND COALESCE(r.total_amount, 0) + COALESCE(r.voucher_amount_paid, 0) > r.original_total THEN
      v_cash := GREATEST(0, r.original_total - COALESCE(r.voucher_amount_paid, 0));
    ELSE
      v_cash := COALESCE(r.total_amount, 0);
    END IF;
    -- Only correct downward (captured exceeds convention cash).
    IF r.total_captured > v_cash + 0.01 THEN
      -- Combo legs settle via the settlement flow, not here. bookings carries
      -- is_combo/combo_booking_id; combo_booking_items is checked when present.
      IF r.is_combo OR r.combo_booking_id IS NOT NULL THEN
        v_skipped_combo := v_skipped_combo + 1;
        CONTINUE;
      END IF;
      -- combo_booking_items is referenced dynamically: a static EXISTS fails
      -- at parse time on databases where the table is absent.
      IF v_has_combo_items THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM combo_booking_items WHERE booking_id = $1)'
          INTO v_is_combo USING r.id;
        IF v_is_combo THEN
          v_skipped_combo := v_skipped_combo + 1;
          CONTINUE;
        END IF;
      END IF;
      UPDATE bookings SET total_captured = v_cash WHERE id = r.id;
      IF v_has_logs THEN
        INSERT INTO logs (business_id, booking_id, event, payload)
          VALUES (r.business_id, r.id, 'capture_reconciled_r13',
                  jsonb_build_object('before_captured', r.total_captured, 'after_captured', v_cash,
                                     'voucher_amount_paid', COALESCE(r.voucher_amount_paid, 0),
                                     'original_total', r.original_total));
      END IF;
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;
  -- Refunded-row skip count for the deploy log.
  SELECT count(*) INTO v_skipped_refunded FROM bookings
   WHERE status IN ('PAID', 'COMPLETED') AND COALESCE(total_refunded, 0) > 0;
  RAISE NOTICE 'R13 reconcile: fixed=%, skipped_refunded=%, skipped_combo=%', v_fixed, v_skipped_refunded, v_skipped_combo;
END;
$$;

COMMIT;
