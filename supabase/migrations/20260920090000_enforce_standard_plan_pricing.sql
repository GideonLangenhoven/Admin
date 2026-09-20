-- One commercial model everywhere: R2,000/month includes one admin seat;
-- each additional admin seat is R500/month. Setup is free.
BEGIN;

INSERT INTO public.plans (
  id, name, monthly_price_zar, setup_fee_zar, seat_limit,
  extra_seat_price_zar, uncapped_flag, active
)
VALUES ('standard', 'Standard', 2000, 0, 1, 500, true, true)
ON CONFLICT (id) DO UPDATE
SET name = 'Standard',
    monthly_price_zar = 2000,
    setup_fee_zar = 0,
    seat_limit = 1,
    extra_seat_price_zar = 500,
    monthly_paid_booking_limit = NULL,
    uncapped_flag = true,
    active = true,
    updated_at = now();

UPDATE public.subscriptions
SET plan_id = 'standard', updated_at = now()
WHERE plan_id IS DISTINCT FROM 'standard';

UPDATE public.plans
SET active = false, updated_at = now()
WHERE id <> 'standard' AND active;

-- Correct open commercial rows without rewriting paid history.
UPDATE public.billing_line_items li
SET amount_zar = 2000,
    description = 'Standard plan subscription',
    updated_at = now()
FROM public.subscriptions s
WHERE li.source_type = 'SUBSCRIPTION'
  AND li.source_id = s.id
  AND li.kind = 'RECURRING'
  AND li.status IN ('PENDING', 'ACTIVE')
  AND li.amount_zar IS DISTINCT FROM 2000;

UPDATE public.billing_line_items
SET amount_zar = 0,
    status = 'CANCELLED',
    description = 'Platform setup fee (waived)',
    updated_at = now()
WHERE source_type = 'SETUP_FEE'
  AND status IN ('PENDING', 'ACTIVE');

COMMIT;
