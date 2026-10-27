BEGIN;

ALTER TABLE public.tours ADD COLUMN is_extra_pax boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX tours_extra_pax_business ON public.tours(business_id) WHERE is_extra_pax;
ALTER TABLE public.tours ADD CONSTRAINT extra_pax_admin_only CHECK (NOT is_extra_pax OR (active IS FALSE AND hidden IS TRUE));

create or replace function public.create_operator_booking(p_business_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor public.admin_users%rowtype; business public.businesses%rowtype; departure public.slots%rowtype; activity public.tours%rowtype;
 prior public.operator_booking_requests%rowtype; saved public.bookings%rowtype;
 checked_fields jsonb; item record; extra public.add_ons%rowtype; promo public.promotions%rowtype; promo_result jsonb; capacity_result jsonb;
 adults integer; children integer; party integer; state text; email text; phone text; guest text;
 unit numeric; extras numeric:=0; gross numeric; discount numeric:=0; total numeric; override_total numeric;
 override_departure boolean:=coalesce((p_payload->>'departure_override')::boolean,false);
 extra_pax constant uuid:='00000000-0000-0000-0000-000000000001'; question_tour uuid; local_departure timestamp; departure_at timestamptz;
 saved_invoice_id uuid:=gen_random_uuid(); invoice_number text; receipt jsonb; hold_hours integer;
begin
 select a.* into actor from public.admin_users a
 where a.user_id=auth.uid() and not coalesce(a.suspended,false) and not coalesce(a.read_only,false)
 and a.role in ('OPERATOR','ADMIN','MAIN_ADMIN','SUPER_ADMIN')
 and (a.business_id=p_business_id or a.role='SUPER_ADMIN')
 order by (a.business_id=p_business_id) desc,a.created_at,a.id limit 1;
 if actor.id is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 select * into business from public.businesses where id=p_business_id;
 if not found or (actor.role<>'SUPER_ADMIN' and upper(coalesce(business.subscription_status,'')) not in ('ACTIVE','TRIAL','PAST_DUE')) then
   raise exception 'An active subscription is required' using errcode='42501'; end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid booking request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('operator-booking:'||p_business_id::text||':'||p_request_id::text,0));
 select * into prior from public.operator_booking_requests where business_id=p_business_id and id=p_request_id;
 if found then
   if prior.payload_hash<>md5((p_payload #- '{custom_fields,__booking_questions,captured_at}')::text) then raise exception 'This request already saved different booking details. Open the saved booking before continuing.'; end if;
   return prior.receipt||jsonb_build_object('replay',true);
 end if;
 if override_departure and actor.role not in ('ADMIN','MAIN_ADMIN','SUPER_ADMIN') then raise exception 'Admin permission required for a departure override' using errcode='42501'; end if;
 adults:=(p_payload->>'adults')::integer; children:=(p_payload->>'children')::integer;
 if adults is null or children is null or adults<0 or children<0 or adults::bigint+children::bigint<1 or adults::bigint+children::bigint>2147483647 or (not override_departure and adults::bigint+children::bigint>50) then raise exception 'Enter a valid guest count using whole numbers'; end if;
 party:=adults+children; state:=p_payload->>'status'; guest:=trim(p_payload->>'customer_name');
 email:=nullif(lower(trim(p_payload->>'email')),''); phone:=nullif(trim(p_payload->>'phone'),'');
 if state is null or state not in ('PENDING','HELD','CONFIRMED','PAID') then raise exception 'Choose a supported payment action'; end if;
 if override_departure and state not in ('CONFIRMED','PAID') then raise exception 'Confirm an override booking or record payment received'; end if;
 if coalesce(guest,'')='' then raise exception 'Guest name is required'; end if;
 if email is not null and email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email or leave it blank'; end if;
 if phone is not null and phone!~'^[0-9]{7,15}$' then raise exception 'Enter a valid international phone or leave it blank'; end if;
 question_tour:=(p_payload->>'tour_id')::uuid;
 if override_departure and question_tour=extra_pax then
   perform pg_advisory_xact_lock(hashtextextended('extra-pax:'||p_business_id::text,0));
   select * into activity from public.tours where business_id=p_business_id and is_extra_pax;
   if not found then
     insert into public.tours(business_id,name,base_price_per_person,default_capacity,active,hidden,is_extra_pax)
       values(p_business_id,'Extra pax',0,1,false,true,true) returning * into activity;
   end if;
 else
   select * into activity from public.tours where id=question_tour and business_id=p_business_id and active and not is_extra_pax;
 end if;
 if activity.id is null then raise exception 'Activity is unavailable'; end if;
 checked_fields:=public.operator_booking_fields(coalesce(business.booking_custom_fields,'[]'::jsonb),coalesce(p_payload->'custom_fields','{}'::jsonb),party,p_business_id,question_tour);
 checked_fields:=jsonb_set(checked_fields,'{__booking_questions,tour_id}',to_jsonb(activity.id));
 if override_departure then
   if coalesce(p_payload->>'departure_local','')!~'^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d:00$' then raise exception 'Choose a departure date and time'; end if;
   local_departure:=(p_payload->>'departure_local')::timestamp;
   departure_at:=local_departure at time zone business.timezone;
   if not isfinite(departure_at) or departure_at at time zone business.timezone<>local_departure then raise exception 'This departure time does not exist in the operator timezone'; end if;
   -- Closed to public sales; confirmed guests still appear in both manifests.
   insert into public.slots(business_id,tour_id,start_time,capacity_total,status,is_manually_overridden)
     values(p_business_id,activity.id,departure_at,party,'CLOSED',true)
     on conflict (business_id,tour_id,start_time) do nothing;
   select * into departure from public.slots where business_id=p_business_id and tour_id=activity.id and start_time=departure_at for update;
   if departure.status='CANCELLED' then
     update public.slots set status='CLOSED' where id=departure.id returning * into departure;
   end if;
   if p_payload->>'discount_type' is distinct from 'manual' then raise exception 'Enter the agreed total price'; end if;
   unit:=round((p_payload->>'override_total')::numeric/party,2);
 else
   select * into departure from public.slots where id=(p_payload->>'slot_id')::uuid and tour_id=activity.id and business_id=p_business_id for update;
   if not found or departure.status<>'OPEN' or departure.start_time<=now() then raise exception 'Departure is unavailable'; end if;
   if state in ('PENDING','HELD') and departure.start_time<=now()+interval '60 minutes' then raise exception 'Payment holds close 60 minutes before departure. Choose a supported confirmed/payment-received action or another departure.'; end if;
   unit:=coalesce(departure.price_per_person_override,activity.base_price_per_person);
 end if;
 if unit is null or unit<0 or unit in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then raise exception 'Activity price is unavailable or invalid'; end if;
 for item in select key,value from jsonb_each_text(coalesce(p_payload->'add_ons','{}'::jsonb)) loop
   if item.value!~'^[0-9]+$' or item.value::integer not between 1 and 50 then raise exception 'Invalid extra quantity'; end if;
   select * into extra from public.add_ons where id=item.key::uuid and business_id=p_business_id and active;
   if not found or extra.price<0 then raise exception 'An extra is no longer available'; end if;
   extras:=extras+round(extra.price*item.value::integer,2);
 end loop;
 gross:=round(case when override_departure then (p_payload->>'override_total')::numeric else party*unit end+extras,2); total:=gross;
 if p_payload->>'discount_type'='manual' then
   if actor.role not in ('ADMIN','MAIN_ADMIN','SUPER_ADMIN') then raise exception 'Admin permission required for a price override' using errcode='42501'; end if;
   override_total:=(p_payload->>'override_total')::numeric;
   if override_total is null or override_total<0 or override_total in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or coalesce(trim(p_payload->>'discount_reason'),'')='' then raise exception 'Override amount and reason are required'; end if;
   total:=round(override_total+extras,2); discount:=greatest(0,gross-total);
 elsif p_payload->>'discount_type'='promo' then
   select * into promo from public.promotions where business_id=p_business_id and upper(code)=upper(trim(p_payload->>'promo_code')) for update;
   if not found then raise exception 'Promo code is unavailable'; end if;
   promo_result:=public.validate_promo_code(p_business_id,promo.code,gross,email);
   if not coalesce((promo_result->>'valid')::boolean,false) then raise exception '%',promo_result->>'error'; end if;
   discount:=least(gross,round(case when promo.discount_type='PERCENT' then gross*promo.discount_value/100 else promo.discount_value end,2));
   total:=greatest(0,gross-discount);
 end if;
 if total in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or total>99999999.99 or total<>round((p_payload->>'expected_total')::numeric,2) or p_payload->>'expected_total' is null then
   raise exception 'The price changed. Refresh availability and review the total again.'; end if;
 hold_hours:=coalesce((p_payload->>'hold_hours')::integer,24);
 if hold_hours not in (2,6,12,24) then raise exception 'Choose a supported hold duration (maximum 24 hours)'; end if;
 insert into public.bookings(id,business_id,tour_id,slot_id,customer_name,email,phone,qty,unit_price,total_amount,status,source,
  created_by_admin_name,created_by_admin_email,payment_deadline,custom_fields,party_composition,original_total,discount_type,discount_amount,discount_notes,promo_code)
 values(p_request_id,p_business_id,activity.id,departure.id,guest,email,phone,party,unit,total,state,'ADMIN',actor.name,actor.email,
  case when state in ('PENDING','HELD') then now()+make_interval(hours=>hold_hours) end,
  checked_fields,jsonb_build_object('adults',adults,'children',children),greatest(gross,total),
  case when p_payload->>'discount_type'='manual' then 'MANUAL' end,discount,
  case when p_payload->>'discount_type'='manual' then trim(p_payload->>'discount_reason') end,promo.code)
 returning * into saved;
 if override_departure then
   update public.slots set capacity_total=greatest(capacity_total,booked+held+party),booked=booked+party where id=departure.id;
   insert into public.holds(booking_id,slot_id,qty,status,expires_at) values(saved.id,departure.id,party,'CONVERTED',now());
   if state='PAID' then
     update public.bookings set payment_status='CAPTURED',payment_method='Admin (Manual)',total_captured=total where id=saved.id;
   end if;
 else
   capacity_result:=public.account_manual_booking(saved.id,p_business_id,false,'Admin (Manual)');
   if not coalesce((capacity_result->>'ok')::boolean,false) then raise exception '%',capacity_result->>'error'; end if;
 end if;
 for item in select key,value from jsonb_each_text(coalesce(p_payload->'add_ons','{}'::jsonb)) loop
   insert into public.booking_add_ons(booking_id,add_on_id,qty,unit_price)
    select saved.id,id,item.value::integer,price from public.add_ons where id=item.key::uuid and business_id=p_business_id;
 end loop;
 if promo.id is not null then
   promo_result:=public.apply_promo_code(promo.id,email,saved.id);
   if not coalesce((promo_result->>'ok')::boolean,false) then raise exception '%',promo_result->>'error'; end if;
 end if;
 invoice_number:=public.next_invoice_number(p_business_id);
 insert into public.invoices(id,business_id,booking_id,invoice_number,customer_name,customer_email,customer_phone,tour_name,tour_date,qty,unit_price,subtotal,total_amount,payment_method,discount_type,discount_amount,discount_notes)
 values(saved_invoice_id,p_business_id,saved.id,invoice_number,guest,email,phone,activity.name,departure.start_time,party,unit,gross,total,
 case when state='PAID' then 'Admin (Manual)' else 'Pending' end,saved.discount_type,discount,saved.discount_notes);
 update public.bookings set invoice_id=saved_invoice_id where id=saved.id and business_id=p_business_id returning * into saved;
 receipt:=jsonb_build_object('ok',true,'id',saved.id,'business_id',p_business_id,'slot_id',saved.slot_id,'tour_id',saved.tour_id,'status',saved.status,'qty',party,'total_amount',saved.total_amount,
   'total_captured',saved.total_captured,'waiver_status',saved.waiver_status,'invoice_number',invoice_number,'start_time',departure.start_time,'payment_deadline',saved.payment_deadline,'departure_override',override_departure,'replay',false);
 insert into public.operator_booking_requests(id,business_id,actor_admin_id,payload_hash,receipt) values(p_request_id,p_business_id,actor.id,md5((p_payload #- '{custom_fields,__booking_questions,captured_at}')::text),receipt);
 return receipt;
end $$;

-- Only an unchanged booking created through the admin transaction can bypass departure restrictions.
CREATE FUNCTION public.is_operator_departure_override(p_booking_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.operator_booking_requests r JOIN public.bookings b ON b.id=r.id AND b.business_id=r.business_id
 WHERE b.id=p_booking_id AND b.source='ADMIN' AND b.status IN ('CONFIRMED','PAID')
 AND r.receipt->>'departure_override'='true' AND r.receipt->>'slot_id'=b.slot_id::text
 AND r.receipt->>'tour_id'=b.tour_id::text AND (r.receipt->>'qty')::integer=b.qty
 AND (r.receipt->>'total_amount')::numeric=b.total_amount+coalesce(b.voucher_amount_paid,0))
$$;
REVOKE ALL ON FUNCTION public.is_operator_departure_override(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.account_manual_booking(
  p_booking_id uuid, p_business_id uuid, p_mark_paid boolean, p_payment_method text DEFAULT 'Admin (Manual)'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; s slots%ROWTYPE; held_qty integer; counted_qty integer; result jsonb;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('PENDING', 'PENDING PAYMENT', 'HELD', 'PAID', 'CONFIRMED') OR b.qty < 1 OR (b.qty > 50 AND NOT public.is_operator_departure_override(b.id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking cannot be confirmed');
  END IF;
  IF NOT p_mark_paid AND b.status IN ('PENDING', 'PENDING PAYMENT', 'HELD') THEN
    result := create_hold_with_capacity_check(b.id, b.slot_id, b.qty, COALESCE(b.payment_deadline, now() + interval '24 hours'));
    RETURN result || jsonb_build_object('ok', COALESCE((result->>'success')::boolean, false));
  END IF;
  SELECT * INTO s FROM slots WHERE id = b.slot_id AND business_id = b.business_id FOR UPDATE;
  IF NOT FOUND OR (s.status='CANCELLED' OR (s.status='CLOSED' AND NOT public.is_operator_departure_override(b.id))) THEN RETURN jsonb_build_object('ok', false, 'error', 'Departure is closed'); END IF;
  SELECT COALESCE(sum(qty) FILTER (WHERE status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('ADD_GUESTS', 'RESCHEDULE')), 0), LEAST(b.qty, COALESCE(sum(qty) FILTER (WHERE status = 'CONVERTED'), 0))
    INTO held_qty, counted_qty FROM holds WHERE booking_id = b.id AND slot_id = b.slot_id;
  IF s.capacity_total - COALESCE(s.booked, 0) - GREATEST(0, COALESCE(s.held, 0) - held_qty) < b.qty - counted_qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not enough capacity');
  END IF;
  IF p_mark_paid THEN
    result := settle_voucher_reservations(b.id);
    IF NOT COALESCE((result->>'success')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'error', 'Voucher credit could not be settled'); END IF;
  END IF;
  UPDATE slots SET booked = COALESCE(booked, 0) + b.qty - counted_qty,
    held = GREATEST(0, COALESCE(held, 0) - held_qty) WHERE id = s.id;
  UPDATE holds SET status = 'CONVERTED' WHERE booking_id = b.id AND slot_id = s.id AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('ADD_GUESTS', 'RESCHEDULE');
  IF held_qty + counted_qty = 0 THEN
    INSERT INTO holds(booking_id, slot_id, qty, status, expires_at) VALUES(b.id, s.id, b.qty, 'CONVERTED', now());
  END IF;
  IF p_mark_paid OR b.status = 'PAID' THEN
    UPDATE bookings SET status = 'PAID', payment_status = 'CAPTURED',
      payment_method = CASE WHEN p_mark_paid THEN p_payment_method ELSE COALESCE(payment_method, 'Admin (Manual)') END,
      total_captured = GREATEST(COALESCE(total_captured, 0), COALESCE(total_amount, 0)) WHERE id = b.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'already_paid', p_mark_paid AND b.status = 'PAID', 'booking_id', b.id);
END $$;
REVOKE ALL ON FUNCTION public.account_manual_booking(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_manual_booking(uuid, uuid, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_booking_checkout(
  p_booking_id uuid, p_promo_code text DEFAULT NULL,
  p_voucher_ids uuid[] DEFAULT NULL, p_voucher_codes text[] DEFAULT NULL,
  p_add_ons jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b bookings%ROWTYPE; s slots%ROWTYPE; p promotions%ROWTYPE;
  v vouchers%ROWTYPE; item jsonb; r jsonb;
  unit numeric; gross numeric; discount numeric := 0; credit numeric := 0; net numeric;
  addon_price numeric; addon_qty integer; promo text; ids uuid[]; hold_result jsonb;
  reviewed_quote jsonb; preserve_reviewed_quote boolean:=false;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('DRAFT', 'PENDING', 'HELD', 'PENDING PAYMENT', 'CONFIRMED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking is no longer awaiting payment');
  END IF;
  -- An issued checkout is immutable. Retrying must neither reprice it nor reserve twice.
  IF b.checkout_priced_at IS NOT NULL AND (b.checkout_request IS NOT NULL OR (b.yoco_checkout_id IS NOT NULL AND b.payment_url IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok', true, 'amount', b.total_amount, 'redirectUrl', b.payment_url,
      'checkout_id', b.yoco_checkout_id, 'expires_at', (SELECT max(expires_at) FROM holds WHERE booking_id = b.id AND status = 'ACTIVE'));
  END IF;
  SELECT * INTO s FROM slots WHERE id = b.slot_id AND business_id = b.business_id AND tour_id = b.tour_id FOR UPDATE;
  IF NOT FOUND OR s.status='CANCELLED' OR b.qty <= 0 OR ((s.status='CLOSED' OR b.qty>50) AND NOT public.is_operator_departure_override(b.id)) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'This departure is no longer available';
  END IF;
  -- A manual operator quote was already priced, authorised and reserved atomically.
  -- Keep its reviewed amount (including upward adjustments) through payment-link preparation.
  SELECT receipt INTO reviewed_quote FROM operator_booking_requests
    WHERE business_id=b.business_id AND id=b.id;
  preserve_reviewed_quote := b.source='ADMIN' AND b.discount_type='MANUAL'
    AND reviewed_quote->>'slot_id'=b.slot_id::text AND reviewed_quote->>'tour_id'=b.tour_id::text
    AND (reviewed_quote->>'qty')::integer=b.qty
    AND (reviewed_quote->>'total_amount')::numeric=b.total_amount+coalesce(b.voucher_amount_paid,0);
  IF preserve_reviewed_quote AND (p_add_ons IS NOT NULL OR nullif(trim(p_promo_code),'') IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='PZ001', MESSAGE='Review the operator price adjustment before changing extras or applying a promotion';
  END IF;
  SELECT COALESCE(s.price_per_person_override, base_price_per_person) INTO unit FROM tours
    WHERE id = b.tour_id AND business_id = b.business_id;
  IF unit IS NULL OR unit < 0 THEN RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Tour price unavailable'; END IF;
  IF p_add_ons IS NOT NULL THEN
    IF jsonb_typeof(p_add_ons) <> 'array' OR jsonb_array_length(p_add_ons) > 50 THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Invalid extras';
    END IF;
    DELETE FROM booking_add_ons WHERE booking_id = b.id;
    FOR item IN SELECT value FROM jsonb_array_elements(p_add_ons) LOOP
      addon_qty := (item->>'qty')::integer;
      SELECT price INTO addon_price FROM add_ons WHERE id = (item->>'id')::uuid AND business_id = b.business_id AND active;
      IF NOT FOUND OR addon_qty IS NULL OR addon_qty <= 0 OR addon_qty > 50 THEN
        RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'An extra is no longer available';
      END IF;
      INSERT INTO booking_add_ons(booking_id, add_on_id, qty, unit_price) VALUES(b.id, (item->>'id')::uuid, addon_qty, addon_price);
    END LOOP;
  END IF;
  -- Re-read saved extra prices as well: anonymous inserts cannot supply a price.
  IF NOT coalesce(preserve_reviewed_quote,false) THEN
    UPDATE booking_add_ons ba SET unit_price = a.price FROM add_ons a WHERE ba.booking_id = b.id AND ba.add_on_id = a.id AND a.business_id = b.business_id;
  END IF;
  IF EXISTS(SELECT 1 FROM booking_add_ons ba LEFT JOIN add_ons a ON a.id = ba.add_on_id AND a.business_id = b.business_id WHERE ba.booking_id = b.id AND (a.id IS NULL OR ba.qty < 1 OR ba.qty > 50 OR ba.unit_price < 0)) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Invalid saved extras';
  END IF;
  gross := round(unit * b.qty + COALESCE((SELECT sum(unit_price * qty) FROM booking_add_ons WHERE booking_id = b.id), 0), 2);
  promo := NULLIF(trim(COALESCE(p_promo_code, b.promo_code)), '');
  IF coalesce(preserve_reviewed_quote,false) THEN
    unit:=b.unit_price;gross:=b.original_total;discount:=coalesce(b.discount_amount,0);
  ELSIF promo IS NOT NULL THEN
    SELECT * INTO p FROM promotions WHERE business_id = b.business_id AND upper(code) = upper(promo) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Invalid promo code'; END IF;
    -- The use is reserved for this booking until payment or hold cancellation.
    IF NOT EXISTS(SELECT 1 FROM promotion_uses WHERE promotion_id = p.id AND booking_id = b.id) THEN
      IF NOT p.active OR p.valid_from > now() OR p.valid_until < now()
          OR (p.max_uses IS NOT NULL AND p.used_count >= p.max_uses) OR gross < COALESCE(p.min_order_amount, 0)
          OR EXISTS(SELECT 1 FROM promotion_uses WHERE promotion_id = p.id AND lower(trim(email)) = lower(trim(b.email))) THEN
        RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'This promo code is no longer available for this booking';
      END IF;
      INSERT INTO promotion_uses(promotion_id, email, booking_id) VALUES(p.id, lower(trim(b.email)), b.id);
      UPDATE promotions SET used_count = used_count + 1 WHERE id = p.id;
    END IF;
    discount := LEAST(gross, round(CASE WHEN p.discount_type = 'PERCENT' THEN gross * p.discount_value / 100 ELSE p.discount_value END, 2));
  ELSE
    discount := LEAST(gross, GREATEST(0, round(CASE WHEN b.discount_type = 'PERCENT' THEN gross * COALESCE(b.discount_percent, 0) / 100 ELSE COALESCE(b.discount_amount, 0) END, 2)));
  END IF;
  net := CASE WHEN coalesce(preserve_reviewed_quote,false) THEN (reviewed_quote->>'total_amount')::numeric ELSE gross-discount END;
  IF b.status <> 'CONFIRMED' THEN
    hold_result := create_hold_with_capacity_check(b.id, b.slot_id, b.qty, COALESCE(b.payment_deadline, now() + interval '15 minutes'));
    IF NOT COALESCE((hold_result->>'success')::boolean, false) THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = COALESCE(hold_result->>'error', 'No capacity');
    END IF;
  END IF;
  ids := p_voucher_ids;
  IF p_voucher_ids IS NULL AND p_voucher_codes IS NULL THEN
    SELECT array_agg(voucher_id) INTO ids FROM voucher_reservations WHERE booking_id = b.id AND status = 'reserved';
  END IF;
  IF COALESCE(cardinality(ids), 0) = 0 AND COALESCE(cardinality(p_voucher_codes), 0) > 0 THEN
    SELECT array_agg(id) INTO ids FROM vouchers WHERE business_id = b.business_id AND code = ANY(p_voucher_codes);
    IF COALESCE(cardinality(ids), 0) <> (SELECT count(DISTINCT x) FROM unnest(p_voucher_codes) x) THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Voucher not valid for this operator';
    END IF;
  END IF;
  UPDATE voucher_reservations SET status = 'released' WHERE booking_id = b.id AND status = 'reserved';
  -- Preserve credit already settled by a trusted operator flow.
  SELECT COALESCE(sum(amount), 0) INTO credit FROM voucher_reservations WHERE booking_id = b.id AND status = 'settled';
  FOR v IN SELECT * FROM vouchers WHERE id = ANY(ids) ORDER BY id FOR UPDATE LOOP
    IF v.business_id <> b.business_id OR v.status <> 'ACTIVE' OR v.expires_at <= now() THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'A voucher is no longer available';
    END IF;
    IF net > credit THEN
      r := reserve_voucher_amount(v.id, b.id, b.business_id, net - credit);
      credit := credit + COALESCE((r->>'reserved')::numeric, 0);
    END IF;
  END LOOP;
  IF COALESCE(cardinality(ids), 0) > 0 AND (SELECT count(*) FROM vouchers WHERE id = ANY(ids)) <> (SELECT count(DISTINCT x) FROM unnest(ids) x) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Voucher not found';
  END IF;
  IF COALESCE(b.voucher_amount_paid, 0) > 0 AND credit = 0 AND COALESCE(cardinality(ids), 0) = 0 AND p_voucher_ids IS NULL AND p_voucher_codes IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Please supply the voucher used for this booking';
  END IF;
  UPDATE bookings SET unit_price = unit, original_total = gross, total_amount = net - credit,
    voucher_amount_paid = credit, discount_amount = discount, promo_code = promo,
    discount_type = CASE WHEN promo IS NOT NULL THEN p.discount_type ELSE b.discount_type END,
    discount_percent = CASE WHEN promo IS NOT NULL AND p.discount_type = 'PERCENT' THEN p.discount_value::integer WHEN promo IS NOT NULL THEN 0 ELSE b.discount_percent END,
    expected_amount_cents = round((net - credit) * 100)::integer, checkout_priced_at = now(),
    status = CASE WHEN b.status = 'CONFIRMED' THEN b.status ELSE 'HELD' END WHERE id = b.id;
  RETURN jsonb_build_object('ok', true, 'amount', net - credit, 'total', net, 'voucher_amount', credit,
    'promo_id', p.id, 'promo_code', promo, 'expires_at', hold_result->>'expires_at');
EXCEPTION WHEN SQLSTATE 'PZ001' THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;
REVOKE ALL ON FUNCTION public.prepare_booking_checkout(uuid, text, uuid[], text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_booking_checkout(uuid, text, uuid[], text[], jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_payment_recovery(p_booking_id uuid, p_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; s slots%ROWTYPE; result jsonb; credit numeric; expiry timestamptz; funding record;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT', 'CONFIRMED')
      OR b.payment_status IN ('CAPTURED', 'MISMATCH_QUARANTINE') OR b.total_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This booking is no longer awaiting payment. Refresh the dashboard.');
  END IF;
  IF COALESCE(b.total_captured, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Part payment received. Review the remaining balance in the booking before sending a payment link.');
  END IF;
  IF NULLIF(trim(b.email), '') IS NULL OR NULLIF(b.payment_url, '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Add a customer email and create a Yoco payment link in the booking first.');
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO credit FROM voucher_reservations
    WHERE booking_id = b.id AND business_id = b.business_id AND status IN ('reserved', 'settled');
  IF abs(credit - COALESCE(b.voucher_amount_paid, 0)) > 0.01 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Voucher funding has expired. Review the booking before sending a payment link.');
  END IF;
  SELECT * INTO s FROM slots WHERE id = b.slot_id AND business_id = b.business_id FOR UPDATE;
  IF NOT FOUND OR s.status='CANCELLED' OR ((s.status='CLOSED' OR s.start_time <= now() + interval '60 minutes') AND NOT public.is_operator_departure_override(b.id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This departure is no longer available. Review the booking first.');
  END IF;
  expiry := CASE WHEN public.is_operator_departure_override(b.id) THEN now()+interval '24 hours' ELSE LEAST(now() + interval '24 hours', s.start_time - interval '60 minutes') END;
  SELECT LEAST(expiry, COALESCE(min(v.expires_at), expiry)) INTO expiry
    FROM voucher_reservations vr JOIN vouchers v ON v.id = vr.voucher_id
    WHERE vr.booking_id = b.id AND vr.status = 'reserved';
  -- Confirmed bookings already own booked seats; never add a second capacity hold.
  IF b.status <> 'CONFIRMED' THEN
    UPDATE holds SET expires_at = expiry WHERE booking_id = b.id AND slot_id = s.id
      AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS');
    result := create_hold_with_capacity_check(b.id, b.slot_id, b.qty, expiry);
    IF NOT COALESCE((result->>'success')::boolean, false) THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = COALESCE(result->>'error', 'Reservation unavailable');
    END IF;
  END IF;
  FOR funding IN SELECT vr.voucher_id, vr.amount FROM voucher_reservations vr
      JOIN vouchers v ON v.id = vr.voucher_id WHERE vr.booking_id = b.id AND vr.status = 'reserved'
      ORDER BY v.id FOR UPDATE OF v LOOP
    result := reserve_voucher_amount(funding.voucher_id, b.id, b.business_id, funding.amount);
    IF NOT COALESCE((result->>'success')::boolean, false) OR (result->>'reserved')::numeric <> funding.amount THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Voucher funding is no longer available. Review the booking first.';
    END IF;
  END LOOP;
  UPDATE voucher_reservations SET expires_at = expiry WHERE booking_id = b.id AND status = 'reserved';
  UPDATE holds SET expires_at = expiry WHERE booking_id = b.id AND slot_id = s.id
    AND b.status <> 'CONFIRMED' AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS');
  UPDATE bookings SET payment_deadline = expiry WHERE id = b.id AND b.status <> 'CONFIRMED';
  RETURN jsonb_build_object('ok', true, 'expires_at', expiry);
EXCEPTION WHEN SQLSTATE 'PZ001' THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_booking_payment(
  p_booking_id uuid, p_payment_id text, p_captured_cents integer, p_currency text DEFAULT 'ZAR'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bk bookings%ROWTYPE;
  v_slot slots%ROWTYPE;
  v_expected integer;
  v_held integer;
  v_counted integer;
  v_settle jsonb;
BEGIN
  IF p_captured_cents IS NULL OR p_captured_cents < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  SELECT * INTO v_bk FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_bk.status IN ('PAID', 'COMPLETED') THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true);
  END IF;
  IF v_bk.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT', 'CONFIRMED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_status');
  END IF;
  IF p_captured_cents = 0 AND (v_bk.checkout_priced_at IS NULL OR v_bk.total_amount <> 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  SELECT * INTO v_slot FROM slots WHERE id = v_bk.slot_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found'); END IF;
  IF v_slot.business_id <> v_bk.business_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant_mismatch');
  END IF;
  IF v_slot.status='CANCELLED' OR (v_slot.status='CLOSED' AND NOT public.is_operator_departure_override(v_bk.id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_closed');
  END IF;
  v_expected := COALESCE(v_bk.expected_amount_cents, ROUND(COALESCE(v_bk.total_amount, 0) * 100)::integer);
  IF p_captured_cents <> v_expected
      OR upper(p_currency) IS DISTINCT FROM upper(COALESCE(v_bk.expected_currency, 'ZAR')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch',
      'expected_cents', v_expected, 'captured_cents', p_captured_cents);
  END IF;
  SELECT COALESCE(SUM(qty), 0) INTO v_held FROM (
    SELECT qty FROM holds WHERE booking_id = p_booking_id AND slot_id = v_bk.slot_id
      AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS') FOR UPDATE
  ) own_holds;
  SELECT LEAST(v_bk.qty, COALESCE(sum(qty), 0)) INTO v_counted FROM holds WHERE booking_id = v_bk.id AND slot_id = v_bk.slot_id AND status = 'CONVERTED';
  IF v_bk.qty IS NULL OR v_bk.qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  END IF;
  IF v_slot.capacity_total - COALESCE(v_slot.booked, 0)
      - GREATEST(0, COALESCE(v_slot.held, 0) - v_held) < v_bk.qty - v_counted THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_capacity');
  END IF;
  -- Every capacity check precedes settlement. A funding error rolls back its
  -- deductions; unexpected SQL errors roll back the entire RPC transaction.
  v_settle := settle_voucher_reservations(p_booking_id);
  IF NOT COALESCE((v_settle->>'success')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voucher_shortfall', 'shortfall', v_settle->>'shortfall');
  END IF;
  UPDATE holds SET status = 'CONVERTED' WHERE booking_id = p_booking_id
    AND slot_id = v_bk.slot_id AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS');
  UPDATE slots SET booked = COALESCE(booked, 0) + v_bk.qty - v_counted,
    held = GREATEST(0, COALESCE(held, 0) - v_held) WHERE id = v_bk.slot_id;
  UPDATE bookings SET status = 'PAID', yoco_payment_id = p_payment_id,
    total_captured = p_captured_cents / 100.0, payment_status = 'CAPTURED' WHERE id = p_booking_id;
  RETURN jsonb_build_object('ok', true, 'captured_cents', p_captured_cents);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_payment(uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment(uuid,text,integer,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
