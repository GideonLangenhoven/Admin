BEGIN;

-- Keep the authoritative booking/capacity implementations and their permission
-- checks; change only the manual-payment window and its matching hold expiry.
DO $$
DECLARE definition text; original text;
BEGIN
 SELECT pg_get_functiondef('public.create_operator_booking(uuid,uuid,jsonb)'::regprocedure) INTO definition;
 original := definition;
 definition := replace(definition, 'hold_hours:=coalesce((p_payload->>''hold_hours'')::integer,24)', 'hold_hours:=coalesce((p_payload->>''hold_hours'')::integer,168)');
 definition := replace(definition, 'hold_hours not in (2,6,12,24)', 'hold_hours not in (2,6,12,24,48,72,168)');
 definition := replace(definition, 'maximum 24 hours', 'maximum 7 days');
 definition := replace(definition, 'Enter a valid email or leave it blank', 'A valid guest email address is required');
 definition := replace(definition, 'if email is not null and email!~', 'if email is null or email!~');
 definition := replace(definition, 'case when state in (''PENDING'',''HELD'') then now()+make_interval(hours=>hold_hours) end',
   'case when state in (''PENDING'',''HELD'',''CONFIRMED'') then least(now()+make_interval(hours=>hold_hours), case when override_departure then now()+make_interval(hours=>hold_hours) when state=''CONFIRMED'' then departure.start_time else departure.start_time-interval ''60 minutes'' end) end');
 IF position('if email is null or email!~' in definition)=0 OR definition=original OR position('maximum 7 days' in definition)=0 OR position('least(now()+make_interval' in definition)=0 THEN RAISE EXCEPTION 'Expected operator booking deadline implementation missing'; END IF;
 EXECUTE definition;

 SELECT pg_get_functiondef('public.create_hold_with_capacity_check(uuid,uuid,integer,timestamptz)'::regprocedure) INTO definition;
 original := 'LEAST(COALESCE(p_expires_at, now() + interval ''15 minutes''), now() + interval ''24 hours'')';
 IF position(original in definition)=0 THEN RAISE EXCEPTION 'Expected hold expiry implementation missing'; END IF;
 definition := replace(definition, original, 'LEAST(COALESCE(p_expires_at, now() + interval ''15 minutes''), now() + CASE WHEN b.source = ''ADMIN'' AND auth.role() IN (''authenticated'', ''service_role'') THEN interval ''7 days'' ELSE interval ''24 hours'' END, s.start_time - interval ''60 minutes'')');
 EXECUTE definition;

 SELECT pg_get_functiondef('public.prepare_payment_recovery(uuid,uuid)'::regprocedure) INTO definition;
 original := 'expiry := CASE WHEN public.is_operator_departure_override(b.id) THEN now()+interval ''24 hours'' ELSE LEAST(now() + interval ''24 hours'', s.start_time - interval ''60 minutes'') END;';
 IF position(original in definition)=0 THEN RAISE EXCEPTION 'Expected recovery deadline implementation missing'; END IF;
 definition := replace(definition, original, 'expiry := CASE WHEN b.payment_deadline > now() THEN b.payment_deadline ELSE now() + CASE WHEN b.source = ''ADMIN'' THEN interval ''7 days'' ELSE interval ''24 hours'' END END;
  IF NOT public.is_operator_departure_override(b.id) THEN expiry := LEAST(expiry, s.start_time - interval ''60 minutes''); END IF;');
 definition := replace(definition, 'WHERE id = b.id AND b.status <> ''CONFIRMED'';', 'WHERE id = b.id AND (b.status <> ''CONFIRMED'' OR b.source = ''ADMIN'');');
 EXECUTE definition;
END $$;

CREATE INDEX IF NOT EXISTS bookings_manual_payment_reminder_due
 ON public.bookings(payment_deadline, business_id)
 WHERE source='ADMIN' AND status IN ('PENDING','HELD','CONFIRMED');

CREATE OR REPLACE FUNCTION public.enqueue_manual_payment_reminders(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE inserted_count integer;
BEGIN
 WITH candidates AS (
  SELECT b.*, t.name AS tour_name, s.start_time
  FROM public.bookings b
  JOIN public.tours t ON t.id=b.tour_id AND t.business_id=b.business_id
  JOIN public.slots s ON s.id=b.slot_id AND s.business_id=b.business_id
  WHERE b.source='ADMIN' AND b.status IN ('PENDING','HELD','CONFIRMED')
   AND NOT coalesce(b.allow_unpaid,false)
   AND b.payment_deadline > now() AND b.payment_deadline <= now()+interval '24 hours'
   AND b.created_at < b.payment_deadline-interval '24 hours'
   AND b.total_amount > coalesce(b.total_captured,0)
   AND coalesce(b.payment_status,'') NOT IN ('CAPTURED','MISMATCH_QUARANTINE')
   AND nullif(b.payment_url,'') IS NOT NULL AND position('@' in b.email)>0
   AND NOT EXISTS (SELECT 1 FROM public.notification_jobs j WHERE j.dedupe_key=
    'manual-payment-due/'||b.id::text||'/'||extract(epoch from b.payment_deadline)::text)
  ORDER BY b.payment_deadline,b.id
  LIMIT greatest(1,least(p_limit,500))
  FOR UPDATE OF b SKIP LOCKED
 ), inserted AS (
  INSERT INTO public.notification_jobs(business_id,booking_id,source_type,source_id,template_type,recipient,payload,dedupe_key)
  SELECT b.business_id,b.id,'MANUAL_PAYMENT_DUE',b.id,'PAYMENT_EXPIRING',lower(trim(b.email)),
   jsonb_build_object('business_id',b.business_id,'booking_id',b.id,'customer_name',b.customer_name,
    'ref',upper(left(b.id::text,8)),'tour_name',b.tour_name,'start_time',b.start_time,'qty',b.qty,
    'total_amount',b.total_amount-coalesce(b.total_captured,0),'payment_url',b.payment_url,
    'payment_deadline',b.payment_deadline),
   'manual-payment-due/'||b.id::text||'/'||extract(epoch from b.payment_deadline)::text
  FROM candidates b ON CONFLICT(dedupe_key) DO NOTHING RETURNING 1
 ) SELECT count(*) INTO inserted_count FROM inserted;
 RETURN inserted_count;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_manual_payment_reminders(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_manual_payment_reminders(integer) TO service_role;

-- Recheck immediately before each delivery attempt, including retries after a
-- payment, cancellation, changed recipient/link or changed deadline.
DO $$
DECLARE definition text; marker text := 'IF target.source_type = ''VOUCHER_PAYMENT_REMINDER'' THEN';
BEGIN
 SELECT pg_get_functiondef('public.validate_notification_job(uuid,uuid)'::regprocedure) INTO definition;
 IF position(marker in definition)=0 THEN RAISE EXCEPTION 'Expected notification validation missing'; END IF;
 definition := replace(definition, marker, 'IF target.source_type = ''MANUAL_PAYMENT_DUE'' THEN
    SELECT EXISTS(SELECT 1 FROM public.bookings b WHERE b.id=target.booking_id AND b.business_id=target.business_id
      AND b.source=''ADMIN'' AND b.status IN (''PENDING'',''HELD'',''CONFIRMED'')
      AND NOT coalesce(b.allow_unpaid,false)
      AND b.total_amount > coalesce(b.total_captured,0)
      AND coalesce(b.payment_status,'''') NOT IN (''CAPTURED'',''MISMATCH_QUARANTINE'')
      AND b.payment_deadline > now()
      AND b.payment_deadline = (target.payload->>''payment_deadline'')::timestamptz
      AND b.payment_url IS NOT DISTINCT FROM target.payload->>''payment_url''
      AND lower(trim(b.email)) IS NOT DISTINCT FROM target.recipient) INTO payable;
    reason := ''Booking no longer eligible for payment deadline reminder'';
  ELSIF target.source_type = ''VOUCHER_PAYMENT_REMINDER'' THEN');
 EXECUTE definition;
END $$;

-- The new warning is sent before expiry, never the old last-chance link after it.
DO $$
DECLARE definition text; marker text := 'IF b.status IN (''HELD'', ''PENDING'', ''PENDING PAYMENT'') AND b.email IS NOT NULL AND b.payment_url IS NOT NULL THEN';
BEGIN
 SELECT pg_get_functiondef('public.expire_single_hold(uuid)'::regprocedure) INTO definition;
 IF position(marker in definition)=0 THEN RAISE EXCEPTION 'Expected hold reminder implementation missing'; END IF;
 EXECUTE replace(definition,marker,'IF b.source IS DISTINCT FROM ''ADMIN'' AND b.status IN (''HELD'', ''PENDING'', ''PENDING PAYMENT'') AND b.email IS NOT NULL AND b.payment_url IS NOT NULL THEN');
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
