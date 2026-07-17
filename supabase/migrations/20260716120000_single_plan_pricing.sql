-- Single pricing model: R2000/month (1 admin seat included) + R500/month per
-- additional seat. Starter/Growth/Pro tiers are retired — every subscription
-- moves to the one 'standard' plan. Seat charges are computed from
-- businesses.max_admin_seats by the platform-invoice generator.
BEGIN;

-- uncapped_flag=true (with NULL monthly_paid_booking_limit) matches every
-- existing plan and is required by plans_limits_check.
INSERT INTO public.plans (id, name, monthly_price_zar, seat_limit, extra_seat_price_zar, uncapped_flag, active)
VALUES ('standard', 'Standard', 2000, 1, 500, true, true)
ON CONFLICT (id) DO UPDATE
  SET name = 'Standard', monthly_price_zar = 2000, seat_limit = 1,
      extra_seat_price_zar = 500, uncapped_flag = true,
      monthly_paid_booking_limit = NULL, active = true, updated_at = now();

UPDATE public.subscriptions SET plan_id = 'standard' WHERE plan_id <> 'standard';

UPDATE public.plans SET active = false, updated_at = now() WHERE id <> 'standard';

COMMIT;
