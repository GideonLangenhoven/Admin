BEGIN;
-- Preserve suppression and delivery limits while completing booking-based eligibility.
CREATE FUNCTION public.marketing_last_paid_booking(p_business_id uuid,p_contact_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT max(b.created_at) FROM marketing_contacts c JOIN bookings b ON b.business_id=c.business_id
 WHERE c.id=p_contact_id AND c.business_id=p_business_id
   AND (lower(btrim(b.email))=lower(btrim(c.email)) OR
     (nullif(booking_contact_phone(c.phone),'') IS NOT NULL AND booking_contact_phone(b.phone)=booking_contact_phone(c.phone)))
   AND b.created_at<now() AND coalesce(b.total_refunded,0)=0
   AND (b.status='PAID' OR (b.status='COMPLETED' AND
     (b.payment_status='PAID' OR (b.total_amount>0 AND b.total_captured>=b.total_amount))));
$$;
REVOKE ALL ON FUNCTION public.marketing_last_paid_booking(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_last_paid_booking(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.welcome_back_contact_eligible(p_business_id uuid, p_contact_id uuid, p_anchor timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS(SELECT 1 FROM marketing_contacts c
    WHERE c.id = p_contact_id AND c.business_id = p_business_id AND c.status = 'active'
      AND marketing_last_paid_booking(c.business_id,c.id) = p_anchor
      AND NOT EXISTS(SELECT 1 FROM bookings b LEFT JOIN slots s ON s.id = b.slot_id AND s.business_id = b.business_id
        WHERE b.business_id = c.business_id AND b.status IS DISTINCT FROM 'CANCELLED'
          AND (lower(trim(b.email)) = lower(trim(c.email)) OR
            (NULLIF(booking_contact_phone(c.phone),'') IS NOT NULL AND booking_contact_phone(b.phone) = booking_contact_phone(c.phone)))
          AND (b.created_at > p_anchor OR s.start_time > now())));
$function$;


CREATE OR REPLACE FUNCTION public.enroll_welcome_back_sequences(p_business_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE item record; affected integer; enrolled integer := 0;
BEGIN
  FOR item IN SELECT a.id AS automation_id, a.business_id, c.id AS contact_id, (h->>'last_booking_at')::timestamptz AS anchor
      FROM marketing_automations a JOIN businesses biz ON biz.id = a.business_id
      JOIN marketing_contacts c ON c.business_id = a.business_id AND c.status = 'active'
      CROSS JOIN LATERAL jsonb_build_object('last_booking_at',marketing_last_paid_booking(c.business_id,c.id)) h
      WHERE a.status = 'active' AND a.trigger_type = 'booking_inactive'
        AND (p_business_id IS NULL OR a.business_id = p_business_id)
        AND upper(biz.subscription_status) IN ('ACTIVE','TRIAL','PAST_DUE')
        AND marketing_eligibility(c.business_id,c.id)='eligible'
        AND marketing_policy_reason(a.business_id) IN ('eligible','quiet_hours')
        AND (a.trigger_config->>'days_since_last_booking')::integer BETWEEN 1 AND 3650
        AND (h->>'last_booking_at')::timestamptz <= now() - make_interval(days => (a.trigger_config->>'days_since_last_booking')::integer)
        AND welcome_back_contact_eligible(c.business_id,c.id,(h->>'last_booking_at')::timestamptz)
        AND NOT EXISTS(SELECT 1 FROM marketing_automation_enrollments e WHERE e.automation_id = a.id AND e.contact_id = c.id
          AND (e.status = 'active' OR (e.metadata->>'last_booking_at')::timestamptz = (h->>'last_booking_at')::timestamptz))
      ORDER BY (h->>'last_booking_at')::timestamptz, a.id, c.id
      LIMIT GREATEST(1,LEAST(COALESCE(p_limit,100),500)) LOOP
    INSERT INTO marketing_automation_enrollments AS e(automation_id,business_id,contact_id,status,current_step,next_action_at,metadata)
      VALUES(item.automation_id,item.business_id,item.contact_id,'active',0,now(),jsonb_build_object('last_booking_at',item.anchor))
      ON CONFLICT (automation_id,contact_id) DO UPDATE SET status='active',current_step=0,next_action_at=now(),
        metadata=EXCLUDED.metadata,created_at=now(),updated_at=now()
      WHERE e.status <> 'active' AND (e.metadata->>'last_booking_at')::timestamptz IS DISTINCT FROM item.anchor;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected > 0 THEN
      UPDATE marketing_automations SET enrolled_count = enrolled_count + 1 WHERE id = item.automation_id AND business_id = item.business_id;
      enrolled := enrolled + 1;
    END IF;
  END LOOP;
  RETURN enrolled;
END $function$;


CREATE OR REPLACE FUNCTION public.marketing_step_eligibility(p_business_id uuid, p_contact_id uuid, p_enrollment_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
   IF a.trigger_type IN ('date_field','post_booking') THEN RETURN 'domain_event_binding_unavailable'; END IF;
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
END $function$;

ALTER TABLE public.marketing_permission_events ADD COLUMN notice_text text;
ALTER TABLE public.marketing_permission_events ADD COLUMN recorded_by uuid REFERENCES public.admin_users(id);

CREATE FUNCTION public.record_marketing_permission(p_business_id uuid,p_contact_id uuid,p_admin_id uuid,
 p_expected_email text,p_decision text,p_evidence_at timestamptz DEFAULT NULL,p_notice_text text DEFAULT NULL,p_evidence_ref text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c marketing_contacts%ROWTYPE; reason text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_users WHERE id=p_admin_id AND NOT suspended AND NOT coalesce(read_only,false)
   AND (role='SUPER_ADMIN' OR (role='MAIN_ADMIN' AND business_id=p_business_id))) THEN
   RAISE EXCEPTION 'Main Admin or Super Admin required' USING ERRCODE='42501'; END IF;
 IF p_decision NOT IN ('granted','withdrawn') OR p_decision IS NULL THEN RAISE EXCEPTION 'Invalid permission decision'; END IF;
 SELECT * INTO c FROM marketing_contacts WHERE id=p_contact_id AND business_id=p_business_id FOR UPDATE;
 IF NOT FOUND OR c.email IS DISTINCT FROM p_expected_email THEN RAISE EXCEPTION 'Contact changed. Reload before recording permission.'; END IF;
 reason:=marketing_eligibility(p_business_id,p_contact_id);
 IF p_decision='granted' THEN
   IF reason NOT IN ('eligible','permission_unknown') THEN RAISE EXCEPTION 'This contact cannot be subscribed: %',reason; END IF;
   IF p_evidence_at IS NULL OR p_evidence_at>clock_timestamp() OR
      coalesce(length(btrim(p_notice_text)),0) NOT BETWEEN 10 AND 2000 OR
      coalesce(length(btrim(p_evidence_ref)),0) NOT BETWEEN 3 AND 500 THEN
     RAISE EXCEPTION 'Record when permission was given, the notice shown and its evidence reference'; END IF;
 END IF;
 INSERT INTO marketing_permission_events(business_id,contact_id,identity_hash,channel,purpose,decision,source,
   evidence_at,notice_version,evidence_ref,notice_text,recorded_by)
 VALUES(p_business_id,c.id,marketing_identity(c.email),'email','promotion',p_decision,'admin_recorded_permission',
   p_evidence_at,CASE WHEN p_decision='granted' THEN 'recorded-notice-v1' END,nullif(btrim(p_evidence_ref),''),nullif(btrim(p_notice_text),''),p_admin_id);
 IF p_decision='withdrawn' THEN UPDATE marketing_contacts SET status='unsubscribed' WHERE id=c.id AND business_id=p_business_id; END IF;
 RETURN marketing_eligibility(p_business_id,p_contact_id);
END $$;
REVOKE ALL ON FUNCTION public.record_marketing_permission(uuid,uuid,uuid,text,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_marketing_permission(uuid,uuid,uuid,text,text,timestamptz,text,text) TO service_role;
-- Keep signed feedback that arrives before the worker saves its provider ID.
ALTER TABLE marketing_provider_events ADD COLUMN processed_at timestamptz;
UPDATE marketing_provider_events SET processed_at=received_at;
CREATE INDEX marketing_provider_pending ON marketing_provider_events(provider_id) WHERE processed_at IS NULL;
CREATE OR REPLACE FUNCTION public.record_marketing_provider_event(p_event_id text,p_provider_id text,p_type text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e marketing_provider_events%ROWTYPE; bid uuid; cid uuid; address text;
BEGIN
 IF p_type NOT IN ('email.bounced','email.complained','email.suppressed') OR
    nullif(p_event_id,'') IS NULL OR nullif(p_provider_id,'') IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('resend/'||p_provider_id,0));
 INSERT INTO marketing_provider_events(event_id,provider_id,event_type) VALUES(p_event_id,p_provider_id,p_type) ON CONFLICT DO NOTHING;
 SELECT * INTO e FROM marketing_provider_events WHERE event_id=p_event_id FOR UPDATE;
 IF e.provider_id<>p_provider_id OR e.event_type<>p_type THEN RETURN false; END IF;
 IF e.processed_at IS NOT NULL THEN RETURN true; END IF;
 SELECT business_id,contact_id,payload->'to'->>0 INTO bid,cid,address FROM marketing_deliveries WHERE provider_id=p_provider_id;
 IF NOT FOUND THEN
   SELECT business_id,contact_id,email INTO bid,cid,address FROM marketing_queue WHERE resend_email_id=p_provider_id;
 END IF;
 -- Operational emails have no marketing delivery. Never bind them by an event's recipient string.
 IF bid IS NULL OR nullif(btrim(address),'') IS NULL THEN RETURN true; END IF;
 INSERT INTO marketing_permission_events(business_id,contact_id,identity_hash,channel,purpose,decision,source,evidence_ref)
 VALUES(bid,cid,marketing_identity(address),'email','promotion',CASE p_type WHEN 'email.complained' THEN 'complained' WHEN 'email.bounced' THEN 'bounced' ELSE 'withdrawn' END,'resend_webhook',p_event_id);
 UPDATE marketing_contacts SET status=CASE WHEN p_type='email.bounced' THEN 'bounced' ELSE 'unsubscribed' END
 WHERE id=cid AND business_id=bid AND marketing_identity(email)=marketing_identity(address);
 UPDATE marketing_provider_events SET processed_at=clock_timestamp() WHERE event_id=p_event_id;
 RETURN true;
END $$;
CREATE FUNCTION public.marketing_apply_pending_feedback() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE provider text; e record;
BEGIN
 provider:=CASE TG_TABLE_NAME WHEN 'marketing_deliveries' THEN to_jsonb(NEW)->>'provider_id' ELSE to_jsonb(NEW)->>'resend_email_id' END;
 IF nullif(provider,'') IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('resend/'||provider,0));
 FOR e IN SELECT * FROM marketing_provider_events WHERE provider_id=provider AND processed_at IS NULL LOOP
   PERFORM record_marketing_provider_event(e.event_id,e.provider_id,e.event_type);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marketing_apply_pending_feedback() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER marketing_delivery_feedback AFTER INSERT OR UPDATE OF provider_id ON marketing_deliveries
 FOR EACH ROW EXECUTE FUNCTION marketing_apply_pending_feedback();
CREATE TRIGGER marketing_queue_feedback AFTER INSERT OR UPDATE OF resend_email_id ON marketing_queue
 FOR EACH ROW EXECUTE FUNCTION marketing_apply_pending_feedback();

NOTIFY pgrst,'reload schema';
COMMIT;
