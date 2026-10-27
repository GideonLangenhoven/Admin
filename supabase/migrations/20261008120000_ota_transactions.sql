BEGIN;
-- There is no same-database sandbox: booking triggers can enqueue real messages.
-- A dedicated sandbox database must be provisioned by a reviewed administrative
-- migration. Service/API roles cannot change this release boundary.
CREATE TABLE public.ota_runtime_boundary (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL DEFAULT 'BLOCKED' CHECK (environment IN ('BLOCKED','SANDBOX'))
);
INSERT INTO public.ota_runtime_boundary DEFAULT VALUES;
ALTER TABLE public.ota_runtime_boundary ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ota_runtime_boundary FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS ota_environment text, ADD COLUMN IF NOT EXISTS ota_supplier_reference text;
CREATE UNIQUE INDEX uq_ota_supplier_booking_reference ON public.bookings(ota_supplier_reference) WHERE ota_supplier_reference IS NOT NULL;
DROP INDEX IF EXISTS public.uq_bookings_ota_external;
CREATE UNIQUE INDEX uq_bookings_ota_external ON public.bookings
 (business_id, ota_channel, COALESCE(ota_environment, 'LIVE'), ota_external_booking_id)
 WHERE ota_external_booking_id IS NOT NULL;
ALTER TABLE public.ota_product_mappings ADD COLUMN IF NOT EXISTS supplier_option_id text, ADD COLUMN IF NOT EXISTS category_prices jsonb NOT NULL DEFAULT '{}'::jsonb, ADD COLUMN IF NOT EXISTS catalog jsonb;
UPDATE public.ota_product_mappings SET external_option_code=NULL WHERE external_option_code='';
CREATE UNIQUE INDEX uq_ota_supplier_option ON public.ota_product_mappings
 (business_id,channel,supplier_option_id) WHERE supplier_option_id IS NOT NULL;

CREATE TABLE public.ota_availability_snapshots (
 business_id uuid NOT NULL REFERENCES public.businesses(id),channel text NOT NULL,
 snapshot jsonb NOT NULL,PRIMARY KEY(business_id,channel)
);
ALTER TABLE public.ota_availability_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ota_availability_snapshots FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.ota_availability_snapshots TO service_role;
CREATE POLICY ota_snapshots_service ON public.ota_availability_snapshots TO service_role USING(true) WITH CHECK(true);
CREATE TABLE public.ota_events (
 business_id uuid NOT NULL REFERENCES public.businesses(id), channel text NOT NULL,
 environment text NOT NULL CHECK (environment IN ('SANDBOX','LIVE')), event_id text NOT NULL,
 payload jsonb NOT NULL, result jsonb NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,channel,environment,event_id)
);
CREATE TABLE public.ota_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id),
 channel text NOT NULL, environment text NOT NULL, slot_id uuid NOT NULL REFERENCES public.slots(id),
 qty integer NOT NULL CHECK(qty>0), expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CONSUMED','CANCELLED','EXPIRED')),
 details jsonb NOT NULL, booking_id uuid REFERENCES public.bookings(id)
);
CREATE INDEX ota_reservations_slot ON public.ota_reservations(slot_id) WHERE status='ACTIVE';
ALTER TABLE public.ota_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ota_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ota_events,public.ota_reservations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.ota_events,public.ota_reservations TO service_role;
CREATE POLICY ota_events_service ON public.ota_events TO service_role USING(true) WITH CHECK(true);
CREATE POLICY ota_reservations_service ON public.ota_reservations TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.ota_assert_sandbox() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ota_runtime_boundary WHERE environment='SANDBOX') THEN RAISE EXCEPTION 'OTA_NOT_READY'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.ota_assert_sandbox() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ota_assert_sandbox() TO service_role;

-- Normalized provider input. All writes, counters and retry completion share this transaction.
-- Tenant serialization keeps reservation expiry and replacement flows ordered;
-- slot row locks also serialize with the existing direct-booking capacity RPCs.
CREATE FUNCTION public.ota_apply_operation(p_business_id uuid,p_channel text,p_environment text,p_event_id text,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_variable
DECLARE
 op text := p_request->>'operation'; b bookings%ROWTYPE; s slots%ROWTYPE;
 r ota_reservations%ROWTYPE; e ota_events%ROWTYPE; result jsonb; tour uuid; slot uuid;
 n integer; qty integer; amount numeric; tz text; currency text; expired integer; own integer:=0;
 ref text:=p_request->>'reference'; customer uuid; identity jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ota_runtime_boundary WHERE environment='SANDBOX') OR p_environment IS DISTINCT FROM 'SANDBOX' THEN
  RAISE EXCEPTION 'OTA_NOT_READY' USING ERRCODE='P0001';
 END IF;
 IF p_channel NOT IN ('VIATOR','GETYOURGUIDE') OR p_channel IS NULL OR p_event_id IS NULL OR length(p_event_id)=0
   OR op IS NULL OR op NOT IN ('reserve','book','amend','cancel','cancel-reservation') OR ref IS NULL OR length(ref)=0 THEN
  RAISE EXCEPTION 'VALIDATION_FAILURE';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ota:'||p_business_id::text,0));
 SELECT * INTO e FROM ota_events WHERE business_id=p_business_id AND channel=p_channel AND environment=p_environment AND event_id=p_event_id;
 IF FOUND THEN
  IF (CASE WHEN op='reserve' THEN e.payload-ARRAY['amount','currency'] ELSE e.payload END) IS DISTINCT FROM (CASE WHEN op='reserve' THEN p_request-ARRAY['amount','currency'] ELSE p_request END) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  IF op='reserve' AND EXISTS(SELECT 1 FROM ota_reservations WHERE id=(e.result->>'reservation_id')::uuid AND (status='EXPIRED' OR (status='ACTIVE' AND expires_at<=now()) OR (status='CONSUMED' AND EXISTS(SELECT 1 FROM bookings WHERE id=ota_reservations.booking_id AND status='CANCELLED')))) THEN
   DELETE FROM ota_events WHERE business_id=p_business_id AND channel=p_channel AND environment=p_environment AND event_id=p_event_id;
  ELSE RETURN e.result; END IF;
 END IF;
 SELECT timezone,businesses.currency INTO tz,currency FROM businesses WHERE id=p_business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PRODUCT'; END IF;
 IF op IN ('amend','cancel') THEN
  SELECT * INTO b FROM bookings WHERE business_id=p_business_id AND ota_channel=p_channel AND ota_environment=p_environment
   AND (id::text=p_request->>'supplier_reference' OR (p_channel='GETYOURGUIDE' AND ota_supplier_reference=p_request->>'supplier_reference')) AND
    ((p_channel='VIATOR' AND ota_external_booking_id=ref) OR (p_channel='GETYOURGUIDE' AND ota_metadata->>'provider_reference'=p_request->>'provider_reference' AND ota_metadata->>'product'=p_request->>'product')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_BOOKING'; END IF;
  IF op='amend' AND b.status='CANCELLED' THEN RAISE EXCEPTION 'INVALID_BOOKING'; END IF;
 END IF;
 IF op='book' THEN
  SELECT * INTO b FROM bookings WHERE business_id=p_business_id AND ota_channel=p_channel AND ota_environment=p_environment
   AND ota_external_booking_id=ref FOR UPDATE;
  IF FOUND THEN
   IF b.ota_metadata IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
   result:=jsonb_build_object('booking_id',b.id,'supplier_reference',COALESCE(b.ota_supplier_reference,b.id::text));
   INSERT INTO ota_events VALUES(p_business_id,p_channel,p_environment,p_event_id,p_request,result,now());
   RETURN result;
  END IF;
 END IF;
 IF op IN ('reserve','book','amend') THEN
  qty:=(p_request->>'quantity')::integer; amount:=(p_request->>'amount')::numeric;
  IF qty IS NULL OR qty<=0 OR amount IS NULL OR amount<0 OR amount::text IN ('NaN','Infinity','-Infinity')
    OR p_request->>'currency' IS DISTINCT FROM currency THEN RAISE EXCEPTION 'VALIDATION_FAILURE'; END IF;
  SELECT count(*),(array_agg(m.tour_id))[1] INTO n,tour FROM ota_product_mappings m JOIN tours t ON t.id=m.tour_id AND t.business_id=m.business_id AND t.active
   WHERE m.business_id=p_business_id AND m.channel=p_channel AND m.enabled AND
    m.external_product_code=p_request->>'product' AND COALESCE(m.external_option_code,'')=COALESCE(p_request->>'option','')
    AND (p_request->>'supplier_option_id' IS NULL OR m.supplier_option_id=p_request->>'supplier_option_id');
  IF n<>1 THEN RAISE EXCEPTION 'INVALID_PRODUCT'; END IF;
  SELECT count(*),(array_agg(id))[1] INTO n,slot FROM slots WHERE business_id=p_business_id AND tour_id=tour AND
   ((p_request->>'date_time' IS NOT NULL AND start_time=(p_request->>'date_time')::timestamptz AND
     to_char(start_time AT TIME ZONE tz,'YYYY-MM-DD"T"HH24:MI:SS')=substring(p_request->>'date_time',1,19)) OR
    (p_request->>'date_time' IS NULL AND to_char(start_time AT TIME ZONE tz,'YYYY-MM-DD')=p_request->>'date'
      AND to_char(start_time AT TIME ZONE tz,'HH24:MI:SS')=p_request->>'time'));
  IF n<>1 THEN RAISE EXCEPTION 'NO_AVAILABILITY'; END IF;
 END IF;
 IF op='cancel-reservation' THEN
  SELECT * INTO r FROM ota_reservations WHERE id::text=p_request->>'reservation_reference' AND business_id=p_business_id AND channel=p_channel AND environment=p_environment FOR UPDATE;
  IF NOT FOUND OR r.details->>'provider_reference' IS DISTINCT FROM p_request->>'provider_reference' THEN RAISE EXCEPTION 'INVALID_RESERVATION'; END IF;
  slot:=r.slot_id;
 END IF;
 -- Always lock both source/destination slots in UUID order before moving seats.
 PERFORM 1 FROM slots WHERE business_id=p_business_id AND id IN (slot,b.slot_id) ORDER BY id FOR UPDATE;
 IF op IN ('reserve','book','amend') THEN
  SELECT * INTO s FROM slots WHERE id=slot;
  -- Expire only our own holds, under the same tenant/slot locks used by all OTA writes.
  WITH gone AS (UPDATE ota_reservations SET status='EXPIRED' WHERE business_id=p_business_id AND slot_id=slot AND status='ACTIVE' AND expires_at<=now() RETURNING ota_reservations.qty)
   SELECT COALESCE(sum(gone.qty),0) INTO expired FROM gone;
  UPDATE slots SET held=held-expired WHERE id=slot AND held>=expired;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_COUNTER_INVALID'; END IF;
  SELECT * INTO s FROM slots WHERE id=slot;
  IF op='book' AND p_request->>'reservation_reference' IS NOT NULL THEN
   SELECT * INTO r FROM ota_reservations WHERE id::text=p_request->>'reservation_reference' AND business_id=p_business_id AND channel=p_channel AND environment=p_environment FOR UPDATE;
   identity:=p_request - ARRAY['operation','reference','reservation_reference','customer_name','email','phone','supplier_reference','amount','net_amount','provider_payload'];
   IF NOT FOUND OR r.status<>'ACTIVE' OR r.expires_at<=now() OR r.slot_id<>slot OR r.qty<>qty
      OR (r.details - ARRAY['operation','reference','reservation_reference','customer_name','email','phone','supplier_reference','amount','net_amount','provider_payload']) IS DISTINCT FROM identity THEN
    RAISE EXCEPTION 'INVALID_RESERVATION';
   END IF;
   own:=r.qty;
  END IF;
  IF own=0 AND (s.status<>'OPEN' OR s.start_time<=now()) THEN RAISE EXCEPTION 'NO_AVAILABILITY'; END IF;
  IF op='amend' AND b.slot_id=slot THEN own:=b.qty; END IF;
  IF op='book' AND s.held<own THEN RAISE EXCEPTION 'CAPACITY_COUNTER_INVALID'; END IF;
  IF s.capacity_total-s.booked-s.held+own<qty THEN RAISE EXCEPTION 'NO_AVAILABILITY'; END IF;
 END IF;
 IF op='reserve' THEN
  INSERT INTO ota_reservations(business_id,channel,environment,slot_id,qty,expires_at,details)
   VALUES(p_business_id,p_channel,p_environment,slot,qty,now()+interval '60 minutes',p_request) RETURNING * INTO r;
  UPDATE slots SET held=held+qty WHERE id=slot;
  result:=jsonb_build_object('reservation_id',r.id,'expires_at',r.expires_at);
 ELSIF op='book' THEN
  IF COALESCE(p_request->>'email','')<>'' THEN
   customer:=upsert_customer(p_business_id,p_request->>'email',p_request->>'customer_name',p_request->>'phone',false);
  END IF;
  INSERT INTO bookings(ota_supplier_reference,customer_id,business_id,tour_id,slot_id,customer_name,email,phone,qty,unit_price,total_amount,status,source,
   ota_channel,ota_environment,ota_external_booking_id,ota_net_amount,ota_gross_amount,ota_metadata)
   VALUES(CASE WHEN p_channel='GETYOURGUIDE' THEN upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 24)) END,customer,p_business_id,tour,slot,COALESCE(p_request->>'customer_name','OTA Guest'),COALESCE(p_request->>'email',''),p_request->>'phone',qty,amount/qty,amount,'PAID','OTA_'||p_channel,
    p_channel,p_environment,ref,CASE WHEN p_channel='VIATOR' THEN (p_request->>'net_amount')::numeric END,CASE WHEN p_channel='GETYOURGUIDE' THEN amount END,p_request) RETURNING * INTO b;
  UPDATE slots SET booked=booked+qty,held=held-own WHERE id=slot;
  IF r.id IS NOT NULL THEN UPDATE ota_reservations SET status='CONSUMED',booking_id=b.id WHERE id=r.id; END IF;
  result:=jsonb_build_object('booking_id',b.id,'supplier_reference',COALESCE(b.ota_supplier_reference,b.id::text));
 ELSIF op='amend' THEN
  UPDATE slots SET booked=booked-b.qty WHERE id=b.slot_id AND booked>=b.qty;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_COUNTER_INVALID'; END IF;
  UPDATE slots SET booked=booked+qty WHERE id=slot;
  UPDATE bookings SET tour_id=tour,slot_id=slot,qty=qty,unit_price=amount/qty,total_amount=amount,ota_net_amount=CASE WHEN p_channel='VIATOR' THEN (p_request->>'net_amount')::numeric END,ota_gross_amount=CASE WHEN p_channel='GETYOURGUIDE' THEN amount END,
    waiver_status=CASE WHEN tour<>b.tour_id OR qty>b.qty THEN 'PENDING' ELSE waiver_status END,
    waiver_token=CASE WHEN tour<>b.tour_id OR qty>b.qty THEN gen_random_uuid() ELSE waiver_token END,
    customer_name=COALESCE(p_request->>'customer_name',customer_name),email=COALESCE(p_request->>'email',email),phone=COALESCE(p_request->>'phone',phone),ota_metadata=p_request WHERE id=b.id;
  result:=jsonb_build_object('booking_id',b.id,'supplier_reference',COALESCE(b.ota_supplier_reference,b.id::text));
 ELSIF op='cancel' THEN
  IF b.status<>'CANCELLED' THEN
   UPDATE slots SET booked=booked-b.qty WHERE id=b.slot_id AND booked>=b.qty;
   IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_COUNTER_INVALID'; END IF;
   UPDATE bookings SET status='CANCELLED',cancelled_at=now(),cancellation_reason='Cancelled via '||p_channel WHERE id=b.id;
  END IF;
  result:=jsonb_build_object('booking_id',b.id,'supplier_reference',COALESCE(b.ota_supplier_reference,b.id::text));
 ELSE
  IF r.status='ACTIVE' THEN
   UPDATE slots SET held=held-r.qty WHERE id=r.slot_id AND held>=r.qty;
   IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_COUNTER_INVALID'; END IF;
   UPDATE ota_reservations SET status='CANCELLED' WHERE id=r.id;
  END IF;
  result:='{}'::jsonb;
 END IF;
 IF b.customer_id IS NOT NULL THEN PERFORM recompute_customer_stats(b.customer_id); END IF;
 INSERT INTO ota_events VALUES(p_business_id,p_channel,p_environment,p_event_id,p_request,result,now());
 RETURN result;
END $$;
CREATE FUNCTION public.ota_expire_reservations(p_business_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tenant uuid; slot uuid; seats integer; expired integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ota_runtime_boundary WHERE environment='SANDBOX') THEN RETURN 0; END IF;
 FOR tenant IN SELECT DISTINCT business_id FROM ota_reservations WHERE status='ACTIVE' AND expires_at<=now()
   AND (p_business_id IS NULL OR business_id=p_business_id) ORDER BY business_id LIMIT 100 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('ota:'||tenant::text,0));
  FOR slot IN SELECT DISTINCT slot_id FROM ota_reservations WHERE business_id=tenant AND status='ACTIVE' AND expires_at<=now() ORDER BY slot_id LIMIT 100 LOOP
   PERFORM 1 FROM slots WHERE id=slot AND business_id=tenant FOR UPDATE;
   WITH gone AS (UPDATE ota_reservations SET status='EXPIRED' WHERE business_id=tenant AND slot_id=slot AND status='ACTIVE' AND expires_at<=now() RETURNING ota_reservations.qty)
     SELECT COALESCE(sum(qty),0) INTO seats FROM gone;
   UPDATE slots SET held=held-seats WHERE id=slot AND business_id=tenant AND held>=seats;
   IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_COUNTER_INVALID'; END IF;
   expired:=expired+seats;
  END LOOP;
 END LOOP;
 RETURN expired;
END $$;
REVOKE ALL ON FUNCTION public.ota_expire_reservations(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ota_expire_reservations(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ota_apply_operation(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ota_apply_operation(uuid,text,text,text,jsonb) TO service_role;
COMMIT;
