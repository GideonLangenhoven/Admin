BEGIN;
-- Identity hashes retain suppressions after contact deletion without retaining raw addresses.
CREATE FUNCTION public.marketing_identity(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex');
$$;
CREATE TABLE public.marketing_permission_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id),
  contact_id uuid,
  identity_hash text NOT NULL,
  channel text NOT NULL CHECK(channel IN ('email','whatsapp')),
  purpose text NOT NULL CHECK(purpose='promotion'),
  decision text NOT NULL CHECK(decision IN ('granted','withdrawn','bounced','complained','unknown')),
  source text NOT NULL CHECK(length(btrim(source))>0),
  evidence_at timestamptz,
  notice_version text,
  evidence_ref text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(decision <> 'granted' OR (contact_id IS NOT NULL AND evidence_at IS NOT NULL AND
    nullif(btrim(notice_version),'') IS NOT NULL AND nullif(btrim(evidence_ref),'') IS NOT NULL)),
  FOREIGN KEY(contact_id,business_id) REFERENCES marketing_contacts(id,business_id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX ON marketing_permission_events(business_id,identity_hash,channel,purpose,id DESC);
ALTER TABLE marketing_permission_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON marketing_permission_events TO authenticated;
GRANT SELECT,INSERT ON marketing_permission_events TO service_role;
GRANT USAGE ON SEQUENCE marketing_permission_events_id_seq TO service_role;
CREATE POLICY permission_own ON marketing_permission_events FOR SELECT TO authenticated
 USING(business_id=ANY((SELECT current_business_ids())::uuid[]));
CREATE POLICY permission_service ON marketing_permission_events FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE FUNCTION public.marketing_permission_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
  -- The composite FK may clear contact_id on deletion, preserving the evidence.
  IF TG_OP='UPDATE' AND to_jsonb(NEW)->>'contact_id' IS NULL AND to_jsonb(OLD)->>'contact_id' IS NOT NULL AND
     (to_jsonb(NEW)-'contact_id')=(to_jsonb(OLD)-'contact_id') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Marketing evidence is append-only';
END $$;
CREATE TRIGGER marketing_permission_immutable BEFORE UPDATE OR DELETE ON marketing_permission_events
 FOR EACH ROW EXECUTE FUNCTION marketing_permission_immutable();

-- Snapshot only known suppression, with the migration observation time, not invented consent/history.
INSERT INTO marketing_permission_events(business_id,contact_id,identity_hash,channel,purpose,decision,source)
 SELECT business_id,id,marketing_identity(email),'email','promotion',
 CASE status WHEN 'bounced' THEN 'bounced' ELSE 'withdrawn' END,'existing_contact_status_observed'
 FROM marketing_contacts WHERE status IN ('unsubscribed','bounced');
INSERT INTO marketing_permission_events(business_id,identity_hash,channel,purpose,decision,source)
 SELECT DISTINCT business_id,marketing_identity(email),'email','promotion','withdrawn','existing_booking_opt_out_observed'
 FROM bookings WHERE marketing_opt_in=false AND nullif(btrim(email),'') IS NOT NULL;
CREATE FUNCTION public.marketing_preserve_suppression() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  IF TG_OP='UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'Contact tenant identity cannot change';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('unsubscribed','bounced') THEN NEW.status:=OLD.status; END IF;
  IF EXISTS(SELECT 1 FROM marketing_permission_events e WHERE e.business_id=NEW.business_id
    AND e.identity_hash=marketing_identity(NEW.email) AND e.channel='email' AND e.purpose='promotion'
    AND e.decision IN ('withdrawn','bounced','complained')) THEN
    NEW.status:=CASE WHEN NEW.status='bounced' THEN 'bounced' ELSE 'unsubscribed' END;
  END IF;
  IF NEW.status IN ('unsubscribed','bounced') AND (TG_OP='INSERT' OR
      NEW.status IS DISTINCT FROM OLD.status OR NEW.email IS DISTINCT FROM OLD.email) THEN
    INSERT INTO marketing_permission_events(business_id,contact_id,identity_hash,channel,purpose,decision,source)
      VALUES(NEW.business_id,CASE WHEN TG_OP='UPDATE' THEN NEW.id ELSE NULL END,marketing_identity(NEW.email),'email','promotion',
        CASE NEW.status WHEN 'bounced' THEN 'bounced' ELSE 'withdrawn' END,'contact_status');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER marketing_preserve_suppression BEFORE INSERT OR UPDATE ON marketing_contacts
 FOR EACH ROW EXECUTE FUNCTION marketing_preserve_suppression();

CREATE FUNCTION marketing_record_legacy_withdrawal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF nullif(btrim(NEW.email),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM marketing_permission_events
   WHERE business_id=NEW.business_id AND identity_hash=marketing_identity(NEW.email) AND channel='email'
   AND purpose='promotion' AND decision='withdrawn') THEN
   INSERT INTO marketing_permission_events(business_id,identity_hash,channel,purpose,decision,source)
   VALUES(NEW.business_id,marketing_identity(NEW.email),'email','promotion','withdrawn',TG_TABLE_NAME||'_explicit_opt_out');
 END IF;
 RETURN NEW;
END $$;
-- These flags can record a withdrawal, never a grant. Capture future explicit
-- updates even if a legacy/default boolean was already false.
CREATE TRIGGER marketing_customer_withdrawal AFTER UPDATE OF marketing_consent ON customers
 FOR EACH ROW WHEN(NEW.marketing_consent=false) EXECUTE FUNCTION marketing_record_legacy_withdrawal();
CREATE TRIGGER marketing_booking_withdrawal AFTER INSERT OR UPDATE OF marketing_opt_in ON bookings
 FOR EACH ROW WHEN(NEW.marketing_opt_in=false) EXECUTE FUNCTION marketing_record_legacy_withdrawal();
REVOKE ALL ON FUNCTION marketing_record_legacy_withdrawal() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.marketing_eligibility(p_business_id uuid,p_contact_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c marketing_contacts%ROWTYPE; e marketing_permission_events%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(p_business_id=ANY((SELECT current_business_ids())::uuid[]),false) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM marketing_contacts WHERE id=p_contact_id AND business_id=p_business_id;
  IF NOT FOUND THEN RETURN 'contact_unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM marketing_permission_events WHERE business_id=p_business_id
    AND identity_hash=marketing_identity(c.email) AND channel='email' AND purpose='promotion'
    AND decision IN ('withdrawn','bounced','complained')) THEN RETURN 'suppressed'; END IF;
  IF c.status<>'active' THEN RETURN 'contact_'||c.status; END IF;
  IF EXISTS(SELECT 1 FROM marketing_contacts other WHERE other.business_id=c.business_id AND other.id<>c.id
    AND lower(btrim(other.email))=lower(btrim(c.email))) THEN RETURN 'identity_ambiguous'; END IF;
  SELECT * INTO e FROM marketing_permission_events WHERE business_id=p_business_id AND contact_id=c.id
    AND identity_hash=marketing_identity(c.email) AND channel='email' AND purpose='promotion' ORDER BY id DESC LIMIT 1;
  IF NOT FOUND OR e.decision<>'granted' OR e.evidence_at>now() THEN RETURN 'permission_unknown'; END IF;
  RETURN 'eligible';
END $$;
GRANT EXECUTE ON FUNCTION marketing_eligibility(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION marketing_eligibility(uuid,uuid) FROM PUBLIC,anon;

CREATE FUNCTION public.marketing_audience_summary(p_business_id uuid,p_tags text[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(p_business_id=ANY((SELECT current_business_ids())::uuid[]),false) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  RETURN (SELECT coalesce(jsonb_object_agg(reason,n),'{}') FROM (
    SELECT marketing_eligibility(p_business_id,id) reason,count(*) n FROM marketing_contacts
    WHERE business_id=p_business_id AND (p_tags IS NULL OR tags && p_tags) GROUP BY 1) counts);
END $$;
REVOKE ALL ON FUNCTION marketing_audience_summary(uuid,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION marketing_audience_summary(uuid,text[]) TO authenticated,service_role;

CREATE VIEW marketing_eligible_contacts WITH (security_invoker=true) AS
 SELECT id,business_id,email,first_name,tags,status FROM marketing_contacts
 WHERE marketing_eligibility(business_id,id)='eligible';
REVOKE ALL ON marketing_eligible_contacts FROM PUBLIC,anon;
GRANT SELECT ON marketing_eligible_contacts TO authenticated,service_role;

-- The owner confirmed any non-cancelled reservation excludes acquisition offers.
-- Unknown/refunded statuses remain conservative exclusions; only explicit CANCELLED is exempt.
CREATE FUNCTION public.marketing_has_reservation(p_business_id uuid,p_contact_id uuid,p_after timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM marketing_contacts c JOIN bookings b ON b.business_id=c.business_id
   AND (lower(btrim(b.email))=lower(btrim(c.email)) OR
     (nullif(booking_contact_phone(c.phone),'') IS NOT NULL AND booking_contact_phone(b.phone)=booking_contact_phone(c.phone)))
   WHERE c.id=p_contact_id AND c.business_id=p_business_id AND b.status IS DISTINCT FROM 'CANCELLED'
   AND (p_after IS NULL OR b.created_at>p_after));
$$;

-- Read-only planning counts. Vouchers stay unknown until a reliable binding is approved.
CREATE FUNCTION marketing_goal_audiences(p_business_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE total integer; welcome_count integer; review_count integer; winback_count integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND NOT coalesce(p_business_id=ANY((SELECT current_business_ids())::uuid[]),false) THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT count(*),count(*) FILTER(WHERE marketing_eligibility(p_business_id,c.id)='eligible' AND NOT marketing_has_reservation(p_business_id,c.id)),
   count(*) FILTER(WHERE marketing_eligibility(p_business_id,c.id)='eligible' AND 'completed-tour'=ANY(c.tags)),
   count(*) FILTER(WHERE marketing_eligibility(p_business_id,c.id)='eligible'
     AND (customer_booking_history(c.business_id,c.phone,c.email)->>'last_booking_at')::timestamptz<=now()-interval '90 days'
     AND welcome_back_contact_eligible(c.business_id,c.id,(customer_booking_history(c.business_id,c.phone,c.email)->>'last_booking_at')::timestamptz)
     AND NOT marketing_has_reservation(c.business_id,c.id,(customer_booking_history(c.business_id,c.phone,c.email)->>'last_booking_at')::timestamptz))
 INTO total,welcome_count,review_count,winback_count FROM marketing_contacts c WHERE c.business_id=p_business_id;
 RETURN jsonb_build_object('welcome',jsonb_build_object('included',welcome_count,'excluded',total-welcome_count),
   'reviews',jsonb_build_object('included',review_count,'excluded',total-review_count),
   'winback',jsonb_build_object('included',winback_count,'excluded',total-winback_count),
   'vouchers',jsonb_build_object('included',NULL,'excluded',NULL));
END $$;
REVOKE ALL ON FUNCTION marketing_goal_audiences(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION marketing_goal_audiences(uuid) TO authenticated,service_role;

CREATE TABLE public.marketing_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES businesses(id),
 contact_id uuid NOT NULL,
 delivery_key text NOT NULL UNIQUE,
 queue_id uuid,
 enrollment_id uuid,
 payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','sent','failed','reconcile')),
 provider_id text UNIQUE,
 provider_started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(contact_id,business_id) REFERENCES marketing_contacts(id,business_id),
 FOREIGN KEY(queue_id,business_id) REFERENCES marketing_queue(id,business_id),
 FOREIGN KEY(enrollment_id,business_id) REFERENCES marketing_automation_enrollments(id,business_id),
 CHECK(num_nonnulls(queue_id,enrollment_id)=1)
);
CREATE INDEX ON marketing_deliveries(business_id,contact_id,created_at DESC);
ALTER TABLE marketing_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON marketing_deliveries TO authenticated;
GRANT SELECT,INSERT,UPDATE ON marketing_deliveries TO service_role;
CREATE POLICY deliveries_own ON marketing_deliveries FOR SELECT TO authenticated USING(business_id=ANY((SELECT current_business_ids())::uuid[]));
CREATE POLICY deliveries_service ON marketing_deliveries FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.marketing_step_eligibility(p_business_id uuid,p_contact_id uuid,p_enrollment_id uuid DEFAULT NULL)
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

CREATE FUNCTION public.reserve_marketing_delivery(p_business_id uuid,p_contact_id uuid,p_key text,p_payload jsonb,
 p_queue_id uuid DEFAULT NULL,p_enrollment_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d marketing_deliveries%ROWTYPE; reason text; zone text; local_hour integer;
BEGIN
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
 -- Universal email frequency ceiling covers both dispatchers, including unresolved deliveries.
 IF EXISTS(SELECT 1 FROM marketing_deliveries WHERE business_id=p_business_id AND contact_id=p_contact_id
   AND status IN ('sending','sent','reconcile') AND created_at>now()-interval '24 hours') OR
   EXISTS(SELECT 1 FROM marketing_contacts WHERE id=p_contact_id AND business_id=p_business_id AND last_email_at>now()-interval '24 hours') THEN
   RETURN jsonb_build_object('reason','frequency_24h'); END IF;
 SELECT timezone INTO zone FROM businesses WHERE id=p_business_id;
 IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN RETURN jsonb_build_object('reason','timezone_unavailable'); END IF;
 local_hour:=extract(hour FROM now() AT TIME ZONE zone);
 IF local_hour<8 OR local_hour>=20 THEN RETURN jsonb_build_object('reason','quiet_hours'); END IF;
 IF p_payload->'to' IS DISTINCT FROM jsonb_build_array((SELECT email FROM marketing_contacts WHERE id=p_contact_id AND business_id=p_business_id)) THEN
   RETURN jsonb_build_object('reason','recipient_changed'); END IF;
 INSERT INTO marketing_deliveries(business_id,contact_id,delivery_key,queue_id,enrollment_id,payload)
 VALUES(p_business_id,p_contact_id,p_key,p_queue_id,p_enrollment_id,p_payload) RETURNING * INTO d;
 RETURN jsonb_build_object('reason','reserved','id',d.id);
END $$;

CREATE FUNCTION confirm_marketing_delivery(p_business_id uuid,p_delivery_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d marketing_deliveries%ROWTYPE; reason text; zone text;
BEGIN
 SELECT * INTO d FROM marketing_deliveries WHERE id=p_delivery_id AND business_id=p_business_id FOR UPDATE;
 IF NOT FOUND OR d.status<>'sending' OR d.provider_started_at IS NOT NULL THEN RETURN 'delivery_held'; END IF;
 reason:=marketing_step_eligibility(d.business_id,d.contact_id,d.enrollment_id);
 IF reason='eligible' AND NOT EXISTS(SELECT 1 FROM businesses WHERE id=d.business_id AND upper(subscription_status) IN ('ACTIVE','TRIAL','PAST_DUE')) THEN reason:='operator_paused'; END IF;
 IF reason='eligible' AND d.queue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM marketing_queue q JOIN marketing_campaigns c ON c.id=q.campaign_id AND c.business_id=q.business_id
   WHERE q.id=d.queue_id AND q.business_id=d.business_id AND q.contact_id=d.contact_id AND q.status='processing' AND c.status='sending') THEN reason:='campaign_paused'; END IF;
 IF reason='eligible' AND d.payload->'to' IS DISTINCT FROM jsonb_build_array((SELECT email FROM marketing_contacts WHERE id=d.contact_id AND business_id=d.business_id)) THEN reason:='recipient_changed'; END IF;
 SELECT timezone INTO zone FROM businesses WHERE id=p_business_id;
 IF reason='eligible' THEN
   IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN reason:='timezone_unavailable';
   ELSIF extract(hour FROM now() AT TIME ZONE zone)<8 OR extract(hour FROM now() AT TIME ZONE zone)>=20 THEN reason:='quiet_hours'; END IF;
 END IF;
 IF reason<>'eligible' THEN UPDATE marketing_deliveries SET status='failed',updated_at=clock_timestamp() WHERE id=d.id; RETURN reason; END IF;
 UPDATE marketing_deliveries SET provider_started_at=clock_timestamp() WHERE id=d.id;
 RETURN 'eligible';
END $$;
REVOKE ALL ON FUNCTION confirm_marketing_delivery(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION confirm_marketing_delivery(uuid,uuid) TO service_role;

CREATE TABLE public.marketing_provider_events (
 event_id text PRIMARY KEY, provider_id text NOT NULL, event_type text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE marketing_provider_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_events_service ON marketing_provider_events FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON marketing_provider_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON marketing_provider_events TO service_role;
-- Bind provider callbacks to a stored send identity, never a request-supplied tenant/address.
CREATE FUNCTION public.record_marketing_provider_event(p_event_id text,p_provider_id text,p_type text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d marketing_deliveries%ROWTYPE; q marketing_queue%ROWTYPE; bid uuid; cid uuid; address text;
BEGIN
 SELECT * INTO d FROM marketing_deliveries WHERE provider_id=p_provider_id;
 IF FOUND THEN bid:=d.business_id;cid:=d.contact_id;
 ELSE
   SELECT * INTO q FROM marketing_queue WHERE resend_email_id=p_provider_id;
   IF NOT FOUND THEN RETURN false; END IF;
   bid:=q.business_id;cid:=q.contact_id;
 END IF;
 INSERT INTO marketing_provider_events(event_id,provider_id,event_type) VALUES(p_event_id,p_provider_id,p_type) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN true; END IF;
 IF p_type IN ('email.bounced','email.complained','email.suppressed') THEN
   SELECT email INTO address FROM marketing_contacts WHERE id=cid AND business_id=bid;
   INSERT INTO marketing_permission_events(business_id,contact_id,identity_hash,channel,purpose,decision,source,evidence_ref)
    VALUES(bid,cid,marketing_identity(address),'email','promotion',CASE p_type WHEN 'email.complained' THEN 'complained' WHEN 'email.bounced' THEN 'bounced' ELSE 'withdrawn' END,'resend_webhook',p_event_id);
   UPDATE marketing_contacts SET status=CASE WHEN p_type='email.bounced' THEN 'bounced' ELSE 'unsubscribed' END WHERE id=cid AND business_id=bid;
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION consume_marketing_unsubscribe(p_token text,p_reason text DEFAULT '') RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE token_row marketing_unsubscribe_tokens%ROWTYPE; c marketing_contacts%ROWTYPE;
BEGIN
 SELECT * INTO token_row FROM marketing_unsubscribe_tokens WHERE token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN 'not_found'; END IF;
 IF token_row.used_at IS NOT NULL THEN RETURN 'already_processed'; END IF;
 IF token_row.created_at<now()-interval '90 days' THEN RETURN 'expired'; END IF;
 SELECT * INTO c FROM marketing_contacts WHERE id=token_row.contact_id AND business_id=token_row.business_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'not_found'; END IF;
 UPDATE marketing_contacts SET status='unsubscribed',updated_at=now() WHERE id=c.id AND business_id=c.business_id;
 UPDATE marketing_unsubscribe_tokens SET used_at=now() WHERE id=token_row.id AND business_id=c.business_id;
 IF c.status<>'unsubscribed' THEN
  INSERT INTO marketing_events(business_id,campaign_id,contact_id,event_type,metadata)
   VALUES(c.business_id,token_row.campaign_id,c.id,'unsubscribe',jsonb_build_object('reason',CASE WHEN p_reason IN ('too_frequent','not_relevant','never_subscribed','other') THEN p_reason ELSE '' END));
  IF token_row.campaign_id IS NOT NULL THEN
   UPDATE marketing_campaigns SET total_unsubscribes=coalesce(total_unsubscribes,0)+1 WHERE id=token_row.campaign_id AND business_id=c.business_id;
  END IF;
 END IF;
 RETURN 'processed';
END $$;
REVOKE ALL ON FUNCTION consume_marketing_unsubscribe(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION consume_marketing_unsubscribe(text,text) TO service_role;

-- Service-only boundaries, including helpers that otherwise inherit PUBLIC execute.
REVOKE ALL ON FUNCTION marketing_identity(text),marketing_permission_immutable(),marketing_preserve_suppression(),
 marketing_has_reservation(uuid,uuid,timestamptz),marketing_step_eligibility(uuid,uuid,uuid),
 reserve_marketing_delivery(uuid,uuid,text,jsonb,uuid,uuid),record_marketing_provider_event(text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION marketing_identity(text),marketing_has_reservation(uuid,uuid,timestamptz),
 marketing_step_eligibility(uuid,uuid,uuid),reserve_marketing_delivery(uuid,uuid,text,jsonb,uuid,uuid),
 record_marketing_provider_event(text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
