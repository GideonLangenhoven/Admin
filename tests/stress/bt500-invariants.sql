\set ON_ERROR_STOP on

-- Fatal post-run assertions for BT500-LAUNCH-V1. These include the shared
-- money/capacity checks plus marker-specific tenant and arrival audit checks.
DO $$
DECLARE
  violations bigint;
BEGIN
  SELECT COALESCE(sum(offenders), 0) INTO violations
  FROM (
    SELECT count(*) offenders FROM public.slots WHERE booked + COALESCE(held, 0) > capacity_total
    UNION ALL
    SELECT count(*) FROM public.bookings WHERE COALESCE(total_refunded, 0) > COALESCE(total_captured, 0)
    UNION ALL
    SELECT count(*) FROM public.bookings WHERE status = 'PAID' AND yoco_payment_id IS NULL AND yoco_checkout_id IS NULL
    UNION ALL
    SELECT count(*) FROM (SELECT key FROM public.idempotency_keys GROUP BY key HAVING count(*) > 1) duplicate_keys
    UNION ALL
    SELECT count(*) FROM public.holds WHERE expires_at < now() - interval '1 hour' AND status = 'ACTIVE'
    UNION ALL
    SELECT count(*)
    FROM public.slots slot
    JOIN (
      SELECT slot_id, COALESCE(sum(qty), 0) qty
      FROM public.holds
      WHERE status = 'ACTIVE'
      GROUP BY slot_id
    ) active_holds ON active_holds.slot_id = slot.id
    WHERE COALESCE(slot.held, 0) < active_holds.qty
    UNION ALL
    SELECT count(*)
    FROM public.bookings booking
    JOIN public.businesses business ON business.id = booking.business_id
    WHERE booking.email LIKE 'bt500-20260921-%@example.invalid'
      AND business.subdomain NOT LIKE 'bt500-20260921-%'
    UNION ALL
    SELECT count(*)
    FROM public.slot_check_ins check_in
    JOIN public.bookings booking ON booking.id = check_in.booking_id
    LEFT JOIN public.admin_users actor ON actor.id = check_in.actor_admin_id
    WHERE check_in.notes LIKE 'bt500-20260921:%'
      AND (
        booking.email NOT LIKE 'bt500-20260921-%@example.invalid'
        OR check_in.business_id IS DISTINCT FROM booking.business_id
        OR check_in.slot_id IS DISTINCT FROM booking.slot_id
        OR actor.business_id IS DISTINCT FROM booking.business_id
        OR check_in.client_event_id NOT LIKE 'bt500-20260921:%'
        OR check_in.arrived_count_before < 0
        OR check_in.arrived_count_after < 0
        OR check_in.arrived_count_before > booking.qty
        OR check_in.arrived_count_after > booking.qty
      )
  ) checks;

  IF violations <> 0 THEN
    RAISE EXCEPTION 'BT500 invariant violations: %', violations;
  END IF;
END $$;

SELECT 'PASS' AS bt500_invariants, 0 AS violations;
