BEGIN;

-- Keep invoker rights and tenant-matched joins for departure details.
CREATE OR REPLACE VIEW public.payment_recovery_bookings WITH (security_invoker = true) AS
SELECT b.id, b.business_id, b.customer_name, b.email, b.phone, b.status, b.total_amount, b.total_captured,
  b.payment_url, b.payment_status, b.created_at, b.payment_failed_at, b.payment_failure_reason,
  b.payment_recovery_emailed_at, COALESCE(b.payment_failed_at, b.created_at) AS recovery_at,
  CASE WHEN b.status IN ('CANCELLED', 'EXPIRED') THEN 0
    ELSE GREATEST(0, COALESCE(b.total_amount, 0) - CASE
      WHEN COALESCE(b.total_captured, 0) > 0 THEN b.total_captured
      WHEN b.status IN ('PAID', 'COMPLETED') THEN COALESCE(b.total_amount, 0)
      ELSE 0 END)
  END AS amount_due,
  b.slot_id, s.start_time AS departure_at, t.name AS tour_name,
  s.start_time < now() AS departure_passed
FROM public.bookings b
LEFT JOIN public.slots s ON s.id = b.slot_id AND s.business_id = b.business_id
LEFT JOIN public.tours t ON t.id = b.tour_id AND t.business_id = b.business_id
WHERE b.status <> 'DRAFT';

NOTIFY pgrst, 'reload schema';
COMMIT;
