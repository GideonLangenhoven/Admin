-- New subscriptions use the September 2026 commercial cohort. Existing plans,
-- subscriptions and billing rows are immutable: they retain the terms that
-- were active when the customer subscribed.
BEGIN;

INSERT INTO public.plans (
  id, name, monthly_price_zar, setup_fee_zar, seat_limit,
  extra_seat_price_zar, uncapped_flag, active
)
VALUES ('standard-2026-09-21', 'Standard', 2000, 0, 1, 500, true, true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.plans
    WHERE id = 'standard-2026-09-21'
      AND name = 'Standard'
      AND monthly_price_zar = 2000
      AND setup_fee_zar = 0
      AND seat_limit = 1
      AND extra_seat_price_zar = 500
      AND monthly_paid_booking_limit IS NULL
      AND uncapped_flag
      AND active
  ) THEN
    RAISE EXCEPTION 'The future Standard pricing cohort exists with different terms';
  END IF;
END $$;

-- This is the only automatic subscription-creation boundary. Replacing the
-- function changes future inserts only; its existing-subscription branch is a
-- no-op and therefore cannot enroll an old customer into the new cohort.
CREATE OR REPLACE FUNCTION public.platform_complete_business_setup(p_business_id uuid, p_actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b businesses%ROWTYPE; s subscriptions%ROWTYPE; added boolean := false;
BEGIN
  IF p_actor_id IS NOT NULL THEN PERFORM platform_assert_actor(p_actor_id,p_business_id); END IF;
  SELECT * INTO b FROM businesses WHERE id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found'; END IF;
  SELECT * INTO s FROM subscriptions WHERE business_id=b.id;
  IF NOT FOUND THEN
    INSERT INTO subscriptions(business_id,plan_id,status,period_start,period_end)
      VALUES(b.id,'standard-2026-09-21',CASE WHEN b.subscription_status IN ('ACTIVE','TRIAL','PAST_DUE','PAUSED','SUSPENDED','INACTIVE','CANCELLED') THEN b.subscription_status ELSE 'ACTIVE' END,
      (now() AT TIME ZONE 'UTC')::date,NULL) RETURNING * INTO s;
    added := true;
  END IF;
  INSERT INTO policies(business_id) VALUES(b.id) ON CONFLICT(business_id) DO NOTHING;
  IF added THEN
    INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,after_state)
      VALUES(p_actor_id,b.id,'BUSINESS_BILLING_INITIALIZED','subscriptions',s.id,jsonb_build_object('plan_id',s.plan_id,'period_start',s.period_start));
  END IF;
  RETURN jsonb_build_object('ok',true,'subscription_created',added,'subscription_id',s.id);
END $$;
REVOKE ALL ON FUNCTION public.platform_complete_business_setup(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_complete_business_setup(uuid,uuid) TO service_role;

COMMIT;
