BEGIN;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('ACTIVE','TRIAL','PAST_DUE','PAUSED','SUSPENDED','INACTIVE','CANCELLED'));
-- Do not discard or merge subscriptions if historical duplicates exist.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_business ON public.subscriptions(business_id);
ALTER TABLE public.billing_line_items ALTER COLUMN amount_zar TYPE numeric(12,2);

CREATE TABLE IF NOT EXISTS public.client_release_checks (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.admin_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.client_release_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_release_checks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.client_release_checks TO service_role;

CREATE OR REPLACE FUNCTION public.platform_assert_actor(p_actor_id uuid, p_business_id uuid, p_super_only boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id=p_actor_id AND NOT suspended
    AND (role='SUPER_ADMIN' OR (NOT p_super_only AND role='MAIN_ADMIN' AND business_id=p_business_id))) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.platform_assert_actor(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_assert_actor(uuid,uuid,boolean) TO service_role;

-- Shared by both onboarding routes and the explicit repair control. Existing
-- subscriptions are left untouched. Repairs start today, never back-bill.
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
      VALUES(b.id,'standard',CASE WHEN b.subscription_status IN ('ACTIVE','TRIAL','PAST_DUE','PAUSED','SUSPENDED','INACTIVE','CANCELLED') THEN b.subscription_status ELSE 'ACTIVE' END,
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

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS onboarding_request_id uuid UNIQUE;
CREATE OR REPLACE FUNCTION public.platform_onboard_business(p_actor_id uuid,p_request_id uuid,p_business jsonb,p_admin jsonb,p_credentials jsonb,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b businesses%ROWTYPE; a admin_users%ROWTYPE; base text;
BEGIN
  PERFORM platform_assert_actor(p_actor_id,NULL);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Onboarding request ID required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  SELECT * INTO b FROM businesses WHERE onboarding_request_id=p_request_id;
  IF FOUND THEN
    SELECT * INTO a FROM admin_users WHERE business_id=b.id AND email=p_admin->>'email';
    IF NOT FOUND OR b.business_name IS DISTINCT FROM p_business->>'business_name' THEN RAISE EXCEPTION 'Onboarding request already used for different details'; END IF;
  ELSE
    base := 'https://'||(p_business->>'subdomain')||'.booking.bookingtours.co.za';
    INSERT INTO businesses(name,business_name,operator_email,business_tagline,timezone,currency,logo_url,subdomain,
      booking_site_url,manage_bookings_url,booking_success_url,booking_cancel_url,gift_voucher_url,voucher_success_url,waiver_url,max_admin_seats,onboarding_request_id)
    VALUES(p_business->>'business_name',p_business->>'business_name',p_admin->>'email',p_business->>'business_tagline',
      p_business->>'timezone',p_business->>'currency',p_business->>'logo_url',p_business->>'subdomain',base,base||'/my-bookings',base||'/success',base||'/cancelled',base||'/voucher',base||'/voucher-success',base||'/waiver',1,p_request_id)
    RETURNING * INTO b;
    INSERT INTO admin_users(business_id,name,email,role,password_hash,must_set_password)
      VALUES(b.id,p_admin->>'name',p_admin->>'email','MAIN_ADMIN','',true) RETURNING * INTO a;
    IF p_credentials <> '{}'::jsonb THEN
      PERFORM set_business_credentials(b.id,p_key,p_credentials->>'wa_token',p_credentials->>'wa_phone_id',p_credentials->>'yoco_secret_key',p_credentials->>'yoco_webhook_secret');
    END IF;
    PERFORM platform_complete_business_setup(b.id,p_actor_id);
    INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,after_state)
      VALUES(p_actor_id,b.id,'BUSINESS_ONBOARDED','businesses',b.id,jsonb_build_object('business_name',b.business_name,'subdomain',b.subdomain));
  END IF;
  RETURN jsonb_build_object('success',true,'business',jsonb_build_object('id',b.id,'business_name',b.business_name,'timezone',b.timezone,'currency',b.currency,'subdomain',b.subdomain),
    'admin',jsonb_build_object('id',a.id,'email',a.email,'name',a.name,'business_id',a.business_id));
END $$;
REVOKE ALL ON FUNCTION public.platform_onboard_business(uuid,uuid,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_onboard_business(uuid,uuid,jsonb,jsonb,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_change_business_status(p_business_id uuid,p_actor_id uuid,p_status text,p_expected_status text,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b businesses%ROWTYPE;
BEGIN
  PERFORM platform_assert_actor(p_actor_id,p_business_id,false);
  IF p_status IS NULL OR p_status NOT IN ('ACTIVE','SUSPENDED','PAUSED') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO b FROM businesses WHERE id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found'; END IF;
  IF b.subscription_status IS DISTINCT FROM p_expected_status THEN RAISE EXCEPTION 'Status changed. Refresh before trying again.'; END IF;
  IF (SELECT role FROM admin_users WHERE id=p_actor_id) <> 'SUPER_ADMIN' AND NOT (
    (b.subscription_status='ACTIVE' AND p_status='PAUSED') OR (b.subscription_status='PAUSED' AND p_status='ACTIVE')
  ) THEN RAISE EXCEPTION 'Only Super Admin can remove a suspension' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE business_id=b.id) THEN RAISE EXCEPTION 'Complete billing setup first'; END IF;
  UPDATE businesses SET subscription_status=p_status,suspension_reason=CASE WHEN p_status='SUSPENDED' THEN 'MANUAL' ELSE NULL END WHERE id=b.id;
  UPDATE subscriptions SET status=p_status,updated_at=now() WHERE business_id=b.id;
  INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,before_state,after_state)
    VALUES(p_actor_id,b.id,CASE WHEN p_status='PAUSED' THEN 'BILLING_PAUSED' WHEN b.subscription_status='PAUSED' AND p_status='ACTIVE' THEN 'BILLING_RESUMED' ELSE 'BUSINESS_STATUS_CHANGED' END,
      'businesses',b.id,jsonb_build_object('subscription_status',b.subscription_status),jsonb_build_object('subscription_status',p_status,'reason',CASE WHEN p_status='SUSPENDED' THEN 'MANUAL' END,'note',left(p_reason,1000)));
  RETURN jsonb_build_object('ok',true,'status',p_status);
END $$;
REVOKE ALL ON FUNCTION public.platform_change_business_status(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_change_business_status(uuid,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_change_seats(p_business_id uuid,p_actor_id uuid,p_delta integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b businesses%ROWTYPE; s subscriptions%ROWTYPE; price numeric; seats integer; active_count integer;
  today date := (now() AT TIME ZONE 'UTC')::date; month_start date; month_end date; adjustment numeric;
BEGIN
  PERFORM platform_assert_actor(p_actor_id,p_business_id,false);
  IF p_delta IS NULL OR p_delta=0 OR abs(p_delta)>50 THEN RAISE EXCEPTION 'Invalid seat change'; END IF;
  SELECT * INTO b FROM businesses WHERE id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found'; END IF;
  SELECT * INTO s FROM subscriptions WHERE business_id=b.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Complete billing setup in Super Admin before changing seats'; END IF;
  IF b.subscription_status NOT IN ('ACTIVE','TRIAL','PAST_DUE') THEN RAISE EXCEPTION 'Subscription is not active'; END IF;
  seats := b.max_admin_seats+p_delta;
  SELECT count(*) INTO active_count FROM admin_users WHERE business_id=b.id AND NOT suspended AND role<>'SUPER_ADMIN';
  IF seats<1 OR seats<active_count THEN RAISE EXCEPTION 'Remove or suspend staff before lowering the seat limit'; END IF;
  SELECT extra_seat_price_zar INTO price FROM plans WHERE id=s.plan_id;
  IF price IS NULL THEN RAISE EXCEPTION 'Plan pricing is unavailable'; END IF;
  month_start := date_trunc('month',today)::date;
  month_end := (month_start+interval '1 month'-interval '1 day')::date;
  adjustment := round(price*p_delta*(month_end-today+1)::numeric/(month_end-month_start+1),2);
  UPDATE businesses SET max_admin_seats=seats WHERE id=b.id;
  INSERT INTO billing_line_items(business_id,source_type,source_id,kind,description,amount_zar,status,period_key,metadata)
    VALUES(b.id,'SEAT_CHANGE',gen_random_uuid(),'ONE_OFF','Seat change (included in monthly invoice calculation)',adjustment,'PENDING',month_start,
      jsonb_build_object('billing_action','SEAT_PRORATION','subscription_id',s.id,'delta',p_delta,'new_seats',seats));
  INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,before_state,after_state)
    VALUES(p_actor_id,b.id,CASE WHEN p_delta>0 THEN 'BILLING_SEATS_ADDED' ELSE 'BILLING_SEATS_REMOVED' END,'subscriptions',s.id,
      jsonb_build_object('seats',b.max_admin_seats),jsonb_build_object('delta',p_delta,'new_seats',seats,'proration',adjustment));
  RETURN jsonb_build_object('ok',true,'new_seats',seats,'proration_zar',adjustment);
END $$;
REVOKE ALL ON FUNCTION public.platform_change_seats(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_change_seats(uuid,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_suspend_admin(p_admin_id uuid,p_actor_id uuid,p_suspended boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a admin_users%ROWTYPE; target_business uuid; seat_limit integer;
BEGIN
  SELECT business_id INTO target_business FROM admin_users WHERE id=p_admin_id;
  PERFORM platform_assert_actor(p_actor_id,target_business);
  SELECT max_admin_seats INTO seat_limit FROM businesses WHERE id=target_business FOR UPDATE;
  SELECT * INTO a FROM admin_users WHERE id=p_admin_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator not found'; END IF;
  IF a.role='SUPER_ADMIN' OR a.id=p_actor_id THEN RAISE EXCEPTION 'Platform accounts cannot be suspended here'; END IF;
  IF p_suspended IS NULL THEN RAISE EXCEPTION 'Suspension state required'; END IF;
  IF a.suspended=p_suspended THEN RETURN jsonb_build_object('ok',true); END IF;
  IF p_suspended AND a.role='MAIN_ADMIN' AND NOT EXISTS(
    SELECT 1 FROM admin_users WHERE business_id=a.business_id AND id<>a.id AND role='MAIN_ADMIN' AND NOT suspended
  ) THEN RAISE EXCEPTION 'Promote another active Main Admin before suspending this one'; END IF;
  IF NOT p_suspended AND (SELECT count(*) FROM admin_users WHERE business_id=a.business_id AND NOT suspended AND role<>'SUPER_ADMIN') >= seat_limit THEN
    RAISE EXCEPTION 'Increase seats before reactivating this administrator';
  END IF;
  UPDATE admin_users SET suspended=p_suspended WHERE id=a.id;
  -- All existing API/RLS checks consult suspended. Removing refresh tokens
  -- prevents old refresh sessions from becoming usable on reactivation.
  IF p_suspended AND a.user_id IS NOT NULL THEN DELETE FROM auth.sessions WHERE user_id=a.user_id; END IF;
  INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,after_state)
    VALUES(p_actor_id,a.business_id,CASE WHEN p_suspended THEN 'ADMIN_SUSPENDED' ELSE 'ADMIN_REACTIVATED' END,'admin_users',a.id,jsonb_build_object('suspended',p_suspended));
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.platform_suspend_admin(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_suspend_admin(uuid,uuid,boolean) TO service_role;

-- Preserve voided documents and permit a new invoice for the same period.
ALTER TABLE public.platform_invoices ADD COLUMN IF NOT EXISTS checkout_requested_at timestamptz;
ALTER TABLE public.platform_invoices DROP CONSTRAINT IF EXISTS platform_invoices_business_id_period_start_key;
CREATE UNIQUE INDEX IF NOT EXISTS platform_invoices_one_open_period ON public.platform_invoices(business_id,period_start) WHERE status<>'VOID';
ALTER TABLE public.platform_invoices ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE public.platform_invoices ADD COLUMN IF NOT EXISTS voided_at timestamptz;

CREATE OR REPLACE FUNCTION public.platform_void_invoice(p_invoice_id uuid,p_actor_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i platform_invoices%ROWTYPE;
BEGIN
  SELECT * INTO i FROM platform_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  PERFORM platform_assert_actor(p_actor_id,i.business_id);
  IF p_reason IS NULL OR length(trim(p_reason))<5 THEN RAISE EXCEPTION 'Explain why this invoice is being voided'; END IF;
  IF i.status='VOID' THEN RETURN jsonb_build_object('ok',true); END IF;
  IF i.status NOT IN ('DRAFT','SENT') OR i.yoco_payment_id IS NOT NULL THEN RAISE EXCEPTION 'Paid invoices cannot be voided'; END IF;
  IF i.yoco_checkout_id IS NOT NULL OR i.checkout_requested_at IS NOT NULL THEN RAISE EXCEPTION 'A payment link exists or is being created. Provider cancellation must be confirmed before correcting this invoice; contact platform support.'; END IF;
  UPDATE platform_invoices SET status='VOID',void_reason=trim(p_reason),voided_at=now(),updated_at=now() WHERE id=i.id;
  INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,before_state,after_state)
    VALUES(p_actor_id,i.business_id,'PLATFORM_INVOICE_VOIDED','platform_invoices',i.id,jsonb_build_object('status',i.status,'amount_zar',i.amount_zar),jsonb_build_object('reason',trim(p_reason)));
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.platform_void_invoice(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_void_invoice(uuid,uuid,text) TO service_role;

-- One read-only snapshot for launch/support. Never return secrets, message
-- bodies, customer contact details or raw audit snapshots to this screen.
CREATE OR REPLACE FUNCTION public.platform_operations_snapshot(p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE clients jsonb; events jsonb;
BEGIN
  PERFORM platform_assert_actor(p_actor_id,NULL);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,'name',b.business_name,'status',b.subscription_status,'subdomain',b.subdomain,
    'checks',coalesce(c.checks,'{}'::jsonb),'checked_at',c.updated_at,
    'billing_ready',EXISTS(SELECT 1 FROM subscriptions s WHERE s.business_id=b.id),
    'policies_ready',EXISTS(SELECT 1 FROM policies p WHERE p.business_id=b.id),
    'owner_ready',EXISTS(SELECT 1 FROM admin_users a WHERE a.business_id=b.id AND a.role='MAIN_ADMIN' AND NOT a.suspended AND NOT a.must_set_password AND a.user_id IS NOT NULL),
    'activity_ready',EXISTS(SELECT 1 FROM tours t WHERE t.business_id=b.id AND t.active AND NOT t.hidden),
    'availability_ready',EXISTS(SELECT 1 FROM slots s JOIN tours t ON t.id=s.tour_id AND t.business_id=s.business_id WHERE s.business_id=b.id AND s.start_time>now() AND s.status='OPEN' AND s.capacity_total>s.booked+s.held AND t.active AND NOT t.hidden),
    'payments_configured',b.yoco_secret_key_encrypted IS NOT NULL AND b.yoco_webhook_secret_encrypted IS NOT NULL AND NOT coalesce(b.yoco_test_mode,false),
    'whatsapp_configured',b.wa_token_encrypted IS NOT NULL AND b.wa_phone_id_encrypted IS NOT NULL,
    'failed_notifications',(SELECT count(*) FROM outbox o WHERE o.business_id=b.id AND o.status IN ('FAILED','EXPIRED')),
    'failed_whatsapp_24h',(SELECT count(*) FROM wa_messages w WHERE w.business_id=b.id AND upper(w.status)='FAILED' AND w.created_at>now()-interval '24 hours'),
    'refunds_needing_review',(SELECT count(*) FROM refund_operations r WHERE r.business_id=b.id AND r.status IN ('PENDING','FAILED'))
  ) ORDER BY b.business_name),'[]'::jsonb) INTO clients FROM businesses b LEFT JOIN client_release_checks c ON c.business_id=b.id;
  SELECT coalesce(jsonb_agg(row_to_json(e)),'[]'::jsonb) INTO events FROM (
    SELECT l.id,l.created_at,l.action_type,l.business_id,b.business_name,l.target_entity,l.target_id,
      coalesce(a.name,a.email,'System') AS actor,
      CASE WHEN l.action_type='PLATFORM_INVOICE_VOIDED' THEN l.after_state->>'reason' ELSE NULL END AS reason
    FROM audit_logs l LEFT JOIN businesses b ON b.id=l.business_id LEFT JOIN admin_users a ON a.id=l.actor_id
    ORDER BY l.created_at DESC,l.id DESC LIMIT 100
  ) e;
  RETURN jsonb_build_object('clients',clients,'audit',events,'as_of',now());
END $$;
REVOKE ALL ON FUNCTION public.platform_operations_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_operations_snapshot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_record_release_check(p_actor_id uuid,p_business_id uuid,p_check text,p_complete boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor_id,p_business_id);
  IF p_check IS NULL OR p_check NOT IN ('owner_login','payment_refund','email_received','whatsapp_received','tenant_isolation','content_approved')
    OR p_complete IS NULL THEN RAISE EXCEPTION 'Unknown release check'; END IF;
  INSERT INTO client_release_checks(business_id,checks,updated_by)
    VALUES(p_business_id,jsonb_build_object(p_check,p_complete),p_actor_id)
  ON CONFLICT(business_id) DO UPDATE SET checks=client_release_checks.checks||excluded.checks,updated_by=p_actor_id,updated_at=now();
  INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,after_state)
    VALUES(p_actor_id,p_business_id,'RELEASE_CHECK_RECORDED','businesses',p_business_id,jsonb_build_object('check',p_check,'complete',p_complete));
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.platform_record_release_check(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_record_release_check(uuid,uuid,text,boolean) TO service_role;

-- Direct authenticated Super Admin edits remain supported. Log field NAMES,
-- not secret values or personal content. Atomic with the original edit.
CREATE OR REPLACE FUNCTION public.audit_super_admin_business_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; changed jsonb;
BEGIN
  SELECT id INTO actor FROM admin_users WHERE user_id=auth.uid() AND role='SUPER_ADMIN' AND NOT suspended;
  IF actor IS NULL THEN RETURN NEW; END IF;
  SELECT jsonb_agg(n.key ORDER BY n.key) INTO changed FROM jsonb_each(to_jsonb(NEW)) n
    WHERE n.value IS DISTINCT FROM to_jsonb(OLD)->n.key AND n.key<>'updated_at';
  IF changed IS NOT NULL THEN
    INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,after_state)
      VALUES(actor,NEW.id,'BUSINESS_DETAILS_UPDATED','businesses',NEW.id,jsonb_build_object('changed_fields',changed));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_super_admin_business_edit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS audit_super_admin_business_edit ON public.businesses;
CREATE TRIGGER audit_super_admin_business_edit AFTER UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.audit_super_admin_business_edit();

CREATE OR REPLACE FUNCTION public.platform_generate_invoice(p_actor_id uuid,p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i platform_invoices%ROWTYPE; s platform_invoices%ROWTYPE;
BEGIN
  s := jsonb_populate_record(NULL::platform_invoices,p_snapshot);
  PERFORM platform_assert_actor(p_actor_id,s.business_id);
  INSERT INTO platform_invoices(business_id,period_start,period_end,plan_id,plan_name,monthly_price_zar,active_days,total_days,pro_rated,pause_note,email_overage_count,email_overage_zar,ai_overage_count,ai_overage_zar,amount_zar,status)
    VALUES(s.business_id,s.period_start,s.period_end,s.plan_id,s.plan_name,s.monthly_price_zar,s.active_days,s.total_days,s.pro_rated,s.pause_note,s.email_overage_count,s.email_overage_zar,s.ai_overage_count,s.ai_overage_zar,s.amount_zar,'DRAFT') RETURNING * INTO i;
  INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,after_state)
    VALUES(p_actor_id,i.business_id,'PLATFORM_INVOICE_GENERATED','platform_invoices',i.id,jsonb_build_object('amount_zar',i.amount_zar,'period_start',i.period_start));
  RETURN to_jsonb(i);
END $$;
REVOKE ALL ON FUNCTION public.platform_generate_invoice(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_generate_invoice(uuid,jsonb) TO service_role;

ALTER TABLE public.platform_invoices ADD COLUMN IF NOT EXISTS checkout_requested_at timestamptz;
CREATE OR REPLACE FUNCTION public.platform_reserve_invoice_checkout(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i platform_invoices%ROWTYPE;
BEGIN
  SELECT * INTO i FROM platform_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF i.status NOT IN ('DRAFT','SENT') THEN RAISE EXCEPTION 'Only unpaid invoices can receive payment links'; END IF;
  IF i.amount_zar<=0 THEN RAISE EXCEPTION 'Invoice amount must be positive'; END IF;
  UPDATE platform_invoices SET checkout_requested_at=coalesce(checkout_requested_at,now()) WHERE id=i.id;
  RETURN to_jsonb(i);
END $$;
REVOKE ALL ON FUNCTION public.platform_reserve_invoice_checkout(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_reserve_invoice_checkout(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_record_invoice_payment(p_invoice_id uuid,p_actor_id uuid,p_method text,p_notes text,p_payment_id text DEFAULT NULL,p_checkout_id text DEFAULT NULL,p_amount_cents bigint DEFAULT NULL,p_currency text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i platform_invoices%ROWTYPE; b businesses%ROWTYPE; restored boolean:=false;
BEGIN
  SELECT business_id INTO i.business_id FROM platform_invoices WHERE id=p_invoice_id;
  -- All payment/status paths take the business lock before the invoice lock.
  SELECT * INTO b FROM businesses WHERE id=i.business_id FOR UPDATE;
  SELECT * INTO i FROM platform_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF p_method='YOCO' THEN
    IF p_payment_id IS NULL OR p_checkout_id IS NULL OR p_currency IS DISTINCT FROM 'ZAR'
      OR p_checkout_id IS DISTINCT FROM i.yoco_checkout_id OR p_amount_cents IS DISTINCT FROM round(i.amount_zar*100)::bigint THEN
      RAISE EXCEPTION 'Payment does not match this invoice';
    END IF;
    IF i.status='PAID' AND i.yoco_payment_id=p_payment_id THEN RETURN jsonb_build_object('ok',true,'duplicate',true); END IF;
  ELSE
    PERFORM platform_assert_actor(p_actor_id,i.business_id);
    IF p_method IS NULL OR p_method NOT IN ('MANUAL','EFT','OTHER') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  END IF;
  IF i.status NOT IN ('DRAFT','SENT') THEN RAISE EXCEPTION 'This invoice is already paid or void'; END IF;
  UPDATE platform_invoices SET status=CASE WHEN p_method='YOCO' THEN 'PAID' ELSE 'PAID_MANUALLY' END,
    paid_at=now(),paid_method=p_method,paid_notes=p_notes,yoco_payment_id=p_payment_id,updated_at=now() WHERE id=i.id;
  INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id,after_state)
    VALUES(p_actor_id,i.business_id,CASE WHEN p_method='YOCO' THEN 'PLATFORM_INVOICE_PAID' ELSE 'PLATFORM_INVOICE_MARKED_PAID_MANUALLY' END,'platform_invoices',i.id,jsonb_build_object('method',p_method,'amount_zar',i.amount_zar));
  IF (b.subscription_status='PAST_DUE' OR (b.subscription_status='SUSPENDED' AND b.suspension_reason='NON_PAYMENT'))
    AND NOT EXISTS(SELECT 1 FROM platform_invoices WHERE business_id=b.id AND status='SENT') THEN
    UPDATE businesses SET subscription_status='ACTIVE',suspension_reason=NULL WHERE id=b.id;
    UPDATE subscriptions SET status='ACTIVE',updated_at=now() WHERE business_id=b.id;
    INSERT INTO audit_logs(actor_id,business_id,action_type,target_entity,target_id)
      VALUES(p_actor_id,b.id,'BILLING_RESTORED','businesses',b.id);
    restored:=true;
  END IF;
  RETURN jsonb_build_object('ok',true,'restored',restored);
END $$;
REVOKE ALL ON FUNCTION public.platform_record_invoice_payment(uuid,uuid,text,text,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_record_invoice_payment(uuid,uuid,text,text,text,text,bigint,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
