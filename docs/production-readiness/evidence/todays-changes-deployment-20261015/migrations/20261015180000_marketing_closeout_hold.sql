BEGIN;
-- Candidate only: no policy, permission or business approval is inserted.
CREATE TABLE marketing_delivery_policy (
 business_id uuid PRIMARY KEY REFERENCES businesses(id),
 enabled boolean NOT NULL DEFAULT false,
 minimum_interval_seconds integer CHECK(minimum_interval_seconds>0),
 window_start time,
 window_end time,
 approval_ref text,
 approved_at timestamptz,
 first_booking_rule_ref text,
 CHECK(NOT enabled OR (minimum_interval_seconds IS NOT NULL AND window_start IS NOT NULL
   AND window_end IS NOT NULL AND window_start<window_end
   AND nullif(btrim(approval_ref),'') IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE marketing_delivery_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketing_delivery_policy FROM PUBLIC,anon,authenticated;
GRANT SELECT ON marketing_delivery_policy TO authenticated;
GRANT SELECT,INSERT,UPDATE ON marketing_delivery_policy TO service_role;
CREATE POLICY delivery_policy_own ON marketing_delivery_policy FOR SELECT TO authenticated
 USING(business_id=ANY((SELECT current_business_ids())::uuid[]));
CREATE POLICY delivery_policy_service ON marketing_delivery_policy FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION marketing_policy_reason(p_business_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p marketing_delivery_policy%ROWTYPE; zone text; local_time time;
BEGIN
 SELECT * INTO p FROM marketing_delivery_policy WHERE business_id=p_business_id;
 IF NOT FOUND OR NOT p.enabled OR p.approved_at>clock_timestamp() THEN RETURN 'policy_approval_pending'; END IF;
 SELECT timezone INTO zone FROM businesses WHERE id=p_business_id;
 -- Named zones only: do not guess the operator's location or use the worker's clock zone.
 IF zone IS NULL OR zone NOT LIKE '%/%' OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN
   RETURN 'timezone_unavailable'; END IF;
 local_time:=(clock_timestamp() AT TIME ZONE zone)::time;
 IF local_time<p.window_start OR local_time>=p.window_end THEN RETURN 'quiet_hours'; END IF;
 RETURN 'eligible';
END $$;
REVOKE ALL ON FUNCTION marketing_policy_reason(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION marketing_policy_reason(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.marketing_step_eligibility(p_business_id uuid,p_contact_id uuid,p_enrollment_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reason text; a marketing_automations%ROWTYPE; e marketing_automation_enrollments%ROWTYPE;
BEGIN
 reason:=marketing_eligibility(p_business_id,p_contact_id);
 IF reason<>'eligible' THEN RETURN reason; END IF;
 IF p_enrollment_id IS NOT NULL THEN
   SELECT * INTO e FROM marketing_automation_enrollments WHERE id=p_enrollment_id AND business_id=p_business_id AND contact_id=p_contact_id;
   IF NOT FOUND OR e.status<>'active' THEN RETURN 'enrollment_inactive'; END IF;
   SELECT * INTO a FROM marketing_automations WHERE id=e.automation_id AND business_id=p_business_id;
   IF NOT FOUND OR a.status<>'active' THEN RETURN 'journey_paused'; END IF;
   IF a.trigger_type='contact_added' AND NOT EXISTS(SELECT 1 FROM marketing_delivery_policy
      WHERE business_id=p_business_id AND nullif(btrim(first_booking_rule_ref),'') IS NOT NULL) THEN RETURN 'first_booking_policy_pending'; END IF;
   IF EXISTS(SELECT 1 FROM marketing_automation_steps WHERE automation_id=a.id AND business_id=p_business_id
      AND step_type IN ('generate_voucher','generate_promo')) THEN RETURN 'offer_issuance_unavailable'; END IF;
   IF a.trigger_type IN ('date_field','post_booking','booking_inactive') THEN RETURN 'domain_event_binding_unavailable'; END IF;
   -- These tags are not bound to verified domain events in the current engine.
   IF a.trigger_type='tag_added' AND a.trigger_config->>'tag' IN ('completed-tour','left-review','photos-ready','anniversary-1yr','vip') THEN
      RETURN 'domain_event_binding_unavailable'; END IF;
   IF a.trigger_type='tag_added' AND a.trigger_config->>'tag'='voucher-expiring-30d' THEN RETURN 'voucher_expiry_schedule_unavailable'; END IF;
   IF nullif(e.metadata->>'voucher_code','') IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM vouchers v JOIN marketing_contacts c ON c.id=p_contact_id AND c.business_id=v.business_id
     WHERE v.business_id=p_business_id AND v.code=e.metadata->>'voucher_code' AND v.status='ACTIVE' AND v.current_balance>0
       AND (v.expires_at IS NULL OR v.expires_at>now()) AND lower(btrim(v.recipient_email))=lower(btrim(c.email))) THEN RETURN 'voucher_ineligible'; END IF;
   IF nullif(e.metadata->>'promo_code','') IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM promotions p WHERE p.business_id=p_business_id AND p.code=e.metadata->>'promo_code' AND p.active
       AND (p.valid_from IS NULL OR p.valid_from<=now()) AND (p.valid_until IS NULL OR p.valid_until>now())
       AND (p.max_uses IS NULL OR coalesce(p.used_count,0)<p.max_uses)) THEN RETURN 'promo_ineligible'; END IF;
   IF a.trigger_type='contact_added' AND marketing_has_reservation(p_business_id,p_contact_id) THEN RETURN 'already_booked'; END IF;
   IF a.trigger_type='booking_inactive' AND (marketing_has_reservation(p_business_id,p_contact_id,(e.metadata->>'last_booking_at')::timestamptz)
      OR NOT welcome_back_contact_eligible(p_business_id,p_contact_id,(e.metadata->>'last_booking_at')::timestamptz)) THEN RETURN 'rebooked_or_upcoming'; END IF;
 END IF;
 RETURN 'eligible';
END $$;

CREATE OR REPLACE FUNCTION public.reserve_marketing_delivery(p_business_id uuid,p_contact_id uuid,p_key text,p_payload jsonb,
 p_queue_id uuid DEFAULT NULL,p_enrollment_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d marketing_deliveries%ROWTYPE; reason text; zone text; policy marketing_delivery_policy%ROWTYPE; local_time time;
BEGIN
 reason:=marketing_policy_reason(p_business_id);
 IF reason<>'eligible' THEN RETURN jsonb_build_object('reason',reason); END IF;
 SELECT * INTO policy FROM marketing_delivery_policy WHERE business_id=p_business_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text||p_contact_id::text,0));
 SELECT * INTO d FROM marketing_deliveries WHERE delivery_key=p_key;
 IF FOUND THEN
   IF d.business_id<>p_business_id OR d.contact_id<>p_contact_id THEN RAISE EXCEPTION 'Delivery identity mismatch'; END IF;
   RETURN jsonb_build_object('reason','delivery_'||d.status,'id',d.id);
 END IF;
 reason:=marketing_step_eligibility(p_business_id,p_contact_id,p_enrollment_id);
 IF reason<>'eligible' THEN RETURN jsonb_build_object('reason',reason); END IF;
 IF NOT EXISTS(SELECT 1 FROM businesses WHERE id=p_business_id AND upper(subscription_status) IN ('ACTIVE','TRIAL','PAST_DUE')) THEN
   RETURN jsonb_build_object('reason','operator_paused'); END IF;
 IF p_queue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM marketing_queue q JOIN marketing_campaigns c
   ON c.id=q.campaign_id AND c.business_id=q.business_id WHERE q.id=p_queue_id AND q.business_id=p_business_id
   AND q.contact_id=p_contact_id AND c.status='sending' AND q.status='processing') THEN RETURN jsonb_build_object('reason','campaign_paused'); END IF;
 -- Uncertain acceptance never expires into an automatic retry or a fresh overlapping journey.
 IF EXISTS(SELECT 1 FROM marketing_deliveries WHERE business_id=p_business_id AND contact_id=p_contact_id
   AND (status='reconcile' OR (status='sending' AND provider_started_at IS NOT NULL))) THEN
   RETURN jsonb_build_object('reason','delivery_reconcile'); END IF;
 -- The configured frequency limit is separate from indefinite uncertainty quarantine.
 IF EXISTS(SELECT 1 FROM marketing_deliveries WHERE business_id=p_business_id AND contact_id=p_contact_id
   AND status IN ('sending','sent','reconcile') AND created_at>clock_timestamp()-make_interval(secs => policy.minimum_interval_seconds)) OR
   EXISTS(SELECT 1 FROM marketing_contacts WHERE id=p_contact_id AND business_id=p_business_id AND last_email_at>clock_timestamp()-make_interval(secs => policy.minimum_interval_seconds)) THEN
   RETURN jsonb_build_object('reason','frequency_policy'); END IF;
 SELECT timezone INTO zone FROM businesses WHERE id=p_business_id;
 IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN RETURN jsonb_build_object('reason','timezone_unavailable'); END IF;
 local_time:=(clock_timestamp() AT TIME ZONE zone)::time;
 IF local_time<policy.window_start OR local_time>=policy.window_end THEN RETURN jsonb_build_object('reason','quiet_hours'); END IF;
 IF p_payload->'to' IS DISTINCT FROM jsonb_build_array((SELECT email FROM marketing_contacts WHERE id=p_contact_id AND business_id=p_business_id)) THEN
   RETURN jsonb_build_object('reason','recipient_changed'); END IF;
 INSERT INTO marketing_deliveries(business_id,contact_id,delivery_key,queue_id,enrollment_id,payload)
 VALUES(p_business_id,p_contact_id,p_key,p_queue_id,p_enrollment_id,p_payload) RETURNING * INTO d;
 RETURN jsonb_build_object('reason','reserved','id',d.id);
END $$;

CREATE OR REPLACE FUNCTION confirm_marketing_delivery(p_business_id uuid,p_delivery_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d marketing_deliveries%ROWTYPE; reason text; zone text;
BEGIN
 SELECT * INTO d FROM marketing_deliveries WHERE id=p_delivery_id AND business_id=p_business_id FOR UPDATE;
 IF NOT FOUND OR d.status<>'sending' OR d.provider_started_at IS NOT NULL THEN RETURN 'delivery_held'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(d.business_id::text||d.contact_id::text,0));
 reason:=marketing_policy_reason(p_business_id);
 IF reason='eligible' THEN reason:=marketing_step_eligibility(d.business_id,d.contact_id,d.enrollment_id); END IF;
 IF reason='eligible' AND NOT EXISTS(SELECT 1 FROM businesses WHERE id=d.business_id AND upper(subscription_status) IN ('ACTIVE','TRIAL','PAST_DUE')) THEN reason:='operator_paused'; END IF;
 IF reason='eligible' AND d.queue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM marketing_queue q JOIN marketing_campaigns c ON c.id=q.campaign_id AND c.business_id=q.business_id
   WHERE q.id=d.queue_id AND q.business_id=d.business_id AND q.contact_id=d.contact_id AND q.status='processing' AND c.status='sending') THEN reason:='campaign_paused'; END IF;
 IF reason='eligible' AND d.payload->'to' IS DISTINCT FROM jsonb_build_array((SELECT email FROM marketing_contacts WHERE id=d.contact_id AND business_id=d.business_id)) THEN reason:='recipient_changed'; END IF;
 IF reason<>'eligible' THEN UPDATE marketing_deliveries SET status='failed',updated_at=clock_timestamp() WHERE id=d.id; RETURN reason; END IF;
 UPDATE marketing_deliveries SET provider_started_at=clock_timestamp() WHERE id=d.id;
 RETURN 'eligible';
END $$;

CREATE OR REPLACE FUNCTION marketing_offer_allowed(p_business_id uuid,p_automation_id uuid,p_step_type text,p_config jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT false $$;

CREATE FUNCTION marketing_guard_delivery_policy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reason text;
BEGIN
 IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
   reason:=marketing_policy_reason(NEW.business_id);
   -- Quiet hours delay dispatch, but do not prevent saving/reviewing a valid journey.
   IF reason NOT IN ('eligible','quiet_hours') THEN RAISE EXCEPTION 'Promotion unavailable: %',reason; END IF;
   IF NEW.trigger_type='contact_added' AND NOT EXISTS(SELECT 1 FROM marketing_delivery_policy
      WHERE business_id=NEW.business_id AND nullif(btrim(first_booking_rule_ref),'') IS NOT NULL) THEN
      RAISE EXCEPTION 'First-booking policy approval pending'; END IF;
   IF NEW.trigger_type='tag_added' OR NEW.trigger_type='date_field' THEN
      RAISE EXCEPTION 'Domain event contract unavailable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketing_guard_delivery_policy BEFORE INSERT OR UPDATE OF status ON marketing_automations
 FOR EACH ROW EXECUTE FUNCTION marketing_guard_delivery_policy();
REVOKE ALL ON FUNCTION marketing_guard_delivery_policy() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
