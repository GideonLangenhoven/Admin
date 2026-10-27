BEGIN;
ALTER TABLE public.marketing_automations DROP CONSTRAINT marketing_automations_trigger_type_check;
ALTER TABLE public.marketing_automations ADD CONSTRAINT marketing_automations_trigger_type_check
  CHECK (trigger_type IN ('contact_added','tag_added','post_booking','date_field','manual','booking_inactive'));
ALTER TABLE public.marketing_automations ADD CONSTRAINT marketing_automations_inactive_days_check
  CHECK (trigger_type <> 'booking_inactive' OR
    COALESCE((jsonb_typeof(trigger_config->'days_since_last_booking') = 'number'
      AND (trigger_config->>'days_since_last_booking')::numeric BETWEEN 1 AND 3650
      AND (trigger_config->>'days_since_last_booking')::numeric = trunc((trigger_config->>'days_since_last_booking')::numeric)),false));

CREATE FUNCTION public.welcome_back_contact_eligible(p_business_id uuid, p_contact_id uuid, p_anchor timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM marketing_contacts c
    WHERE c.id = p_contact_id AND c.business_id = p_business_id AND c.status = 'active'
      AND (customer_booking_history(c.business_id,c.phone,c.email)->>'last_booking_at')::timestamptz = p_anchor
      AND NOT EXISTS(SELECT 1 FROM bookings b LEFT JOIN slots s ON s.id = b.slot_id AND s.business_id = b.business_id
        WHERE b.business_id = c.business_id AND b.status IN ('PENDING','PENDING PAYMENT','HELD','PAID','CONFIRMED','COMPLETED')
          AND (lower(trim(b.email)) = lower(trim(c.email)) OR
            (NULLIF(booking_contact_phone(c.phone),'') IS NOT NULL AND booking_contact_phone(b.phone) = booking_contact_phone(c.phone)))
          AND (b.created_at > p_anchor OR s.start_time > now())));
$$;

CREATE FUNCTION public.enroll_welcome_back_sequences(p_business_id uuid DEFAULT NULL, p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE item record; affected integer; enrolled integer := 0;
BEGIN
  FOR item IN SELECT a.id AS automation_id, a.business_id, c.id AS contact_id, (h->>'last_booking_at')::timestamptz AS anchor
      FROM marketing_automations a JOIN businesses biz ON biz.id = a.business_id
      JOIN marketing_contacts c ON c.business_id = a.business_id AND c.status = 'active'
      CROSS JOIN LATERAL customer_booking_history(c.business_id,c.phone,c.email) h
      WHERE a.status = 'active' AND a.trigger_type = 'booking_inactive'
        AND (p_business_id IS NULL OR a.business_id = p_business_id)
        AND upper(biz.subscription_status) IN ('ACTIVE','TRIAL','PAST_DUE')
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
END $$;

CREATE FUNCTION public.validate_welcome_back_enrollment(p_enrollment_id uuid, p_business_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e marketing_automation_enrollments%ROWTYPE; a marketing_automations%ROWTYPE;
BEGIN
  SELECT * INTO e FROM marketing_automation_enrollments WHERE id=p_enrollment_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND OR e.status <> 'active' THEN RETURN false; END IF;
  SELECT * INTO a FROM marketing_automations WHERE id=e.automation_id AND business_id=e.business_id;
  IF NOT FOUND OR a.status <> 'active' THEN RETURN false; END IF;
  IF a.trigger_type <> 'booking_inactive' THEN RETURN true; END IF;
  IF NOT COALESCE(welcome_back_contact_eligible(e.business_id,e.contact_id,(e.metadata->>'last_booking_at')::timestamptz),false) THEN
    UPDATE marketing_automation_enrollments SET status='exited',updated_at=now() WHERE id=e.id;
    RETURN false;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.welcome_back_contact_eligible(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enroll_welcome_back_sequences(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.validate_welcome_back_enrollment(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.welcome_back_contact_eligible(uuid,uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.enroll_welcome_back_sequences(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_welcome_back_enrollment(uuid,uuid) TO service_role;
COMMIT;
