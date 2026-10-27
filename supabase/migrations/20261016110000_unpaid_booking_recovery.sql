BEGIN;

-- Operators can save name-only bookings and add contact details later.
ALTER TABLE public.bookings ALTER COLUMN email DROP NOT NULL;

create or replace function public.create_operator_booking(p_business_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor public.admin_users%rowtype; business public.businesses%rowtype; departure public.slots%rowtype; activity public.tours%rowtype;
 prior public.operator_booking_requests%rowtype; saved public.bookings%rowtype;
 checked_fields jsonb; item record; extra public.add_ons%rowtype; promo public.promotions%rowtype; promo_result jsonb; capacity_result jsonb;
 adults integer; children integer; party integer; state text; email text; phone text; guest text;
 unit numeric; extras numeric:=0; gross numeric; discount numeric:=0; total numeric; override_total numeric;
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
 adults:=(p_payload->>'adults')::integer; children:=(p_payload->>'children')::integer;
 if adults is null or children is null or adults<0 or children<0 or adults+children not between 1 and 50 then raise exception 'Enter 1 to 50 guests using whole numbers'; end if;
 party:=adults+children; state:=p_payload->>'status'; guest:=trim(p_payload->>'customer_name');
 email:=nullif(lower(trim(p_payload->>'email')),''); phone:=nullif(trim(p_payload->>'phone'),'');
 if state is null or state not in ('PENDING','HELD','CONFIRMED','PAID') then raise exception 'Choose a supported payment action'; end if;
 if coalesce(guest,'')='' then raise exception 'Guest name is required'; end if;
 if email is not null and email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email or leave it blank'; end if;
 if phone is not null and phone!~'^[0-9]{7,15}$' then raise exception 'Enter a valid international phone or leave it blank'; end if;
 select * into activity from public.tours where id=(p_payload->>'tour_id')::uuid and business_id=p_business_id and active;
 if not found then raise exception 'Activity is unavailable'; end if;
 select * into departure from public.slots where id=(p_payload->>'slot_id')::uuid and tour_id=activity.id and business_id=p_business_id for update;
 if not found or departure.status<>'OPEN' or departure.start_time<=now() then raise exception 'Departure is unavailable'; end if;
 if state in ('PENDING','HELD') and departure.start_time<=now()+interval '60 minutes' then raise exception 'Payment holds close 60 minutes before departure. Choose a supported confirmed/payment-received action or another departure.'; end if;
 checked_fields:=public.operator_booking_fields(coalesce(business.booking_custom_fields,'[]'::jsonb),coalesce(p_payload->'custom_fields','{}'::jsonb),party,p_business_id,activity.id);
 unit:=coalesce(departure.price_per_person_override,activity.base_price_per_person);
 if unit is null or unit<0 or unit in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then raise exception 'Activity price is unavailable or invalid'; end if;
 for item in select key,value from jsonb_each_text(coalesce(p_payload->'add_ons','{}'::jsonb)) loop
   if item.value!~'^[0-9]+$' or item.value::integer not between 1 and 50 then raise exception 'Invalid extra quantity'; end if;
   select * into extra from public.add_ons where id=item.key::uuid and business_id=p_business_id and active;
   if not found or extra.price<0 then raise exception 'An extra is no longer available'; end if;
   extras:=extras+round(extra.price*item.value::integer,2);
 end loop;
 gross:=round(party*unit+extras,2); total:=gross;
 if p_payload->>'discount_type'='manual' then
   if actor.role not in ('ADMIN','MAIN_ADMIN','SUPER_ADMIN') then raise exception 'Admin permission required for a price override' using errcode='42501'; end if;
   override_total:=(p_payload->>'override_total')::numeric;
   if override_total is null or override_total<0 or override_total='NaN'::numeric or coalesce(trim(p_payload->>'discount_reason'),'')='' then raise exception 'Override amount and reason are required'; end if;
   total:=round(override_total+extras,2); discount:=greatest(0,gross-total);
 elsif p_payload->>'discount_type'='promo' then
   select * into promo from public.promotions where business_id=p_business_id and upper(code)=upper(trim(p_payload->>'promo_code')) for update;
   if not found then raise exception 'Promo code is unavailable'; end if;
   promo_result:=public.validate_promo_code(p_business_id,promo.code,gross,email);
   if not coalesce((promo_result->>'valid')::boolean,false) then raise exception '%',promo_result->>'error'; end if;
   discount:=least(gross,round(case when promo.discount_type='PERCENT' then gross*promo.discount_value/100 else promo.discount_value end,2));
   total:=greatest(0,gross-discount);
 end if;
 if total>99999999.99 or total<>round((p_payload->>'expected_total')::numeric,2) or p_payload->>'expected_total' is null then
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
 capacity_result:=public.account_manual_booking(saved.id,p_business_id,false,'Admin (Manual)');
 if not coalesce((capacity_result->>'ok')::boolean,false) then raise exception '%',capacity_result->>'error'; end if;
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
   'total_captured',saved.total_captured,'waiver_status',saved.waiver_status,'invoice_number',invoice_number,'start_time',departure.start_time,'payment_deadline',saved.payment_deadline,'replay',false);
 insert into public.operator_booking_requests(id,business_id,actor_admin_id,payload_hash,receipt) values(p_request_id,p_business_id,actor.id,md5((p_payload #- '{custom_fields,__booking_questions,captured_at}')::text),receipt);
 return receipt;
end $$;

-- Invoker rights preserve bookings RLS, including tenant and shared-guide restrictions.
CREATE VIEW public.payment_recovery_bookings WITH (security_invoker = true) AS
SELECT id, business_id, customer_name, email, phone, status, total_amount, total_captured,
  payment_url, payment_status, created_at, payment_failed_at, payment_failure_reason,
  payment_recovery_emailed_at, COALESCE(payment_failed_at, created_at) AS recovery_at,
  CASE WHEN status IN ('CANCELLED', 'EXPIRED') THEN 0
    ELSE GREATEST(0, COALESCE(total_amount, 0) - CASE
      WHEN COALESCE(total_captured, 0) > 0 THEN total_captured
      WHEN status IN ('PAID', 'COMPLETED') THEN COALESCE(total_amount, 0)
      ELSE 0 END)
  END AS amount_due
FROM public.bookings WHERE status <> 'DRAFT';
REVOKE ALL ON public.payment_recovery_bookings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.payment_recovery_bookings TO authenticated, service_role;

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
  IF NOT FOUND OR s.status IN ('CLOSED', 'CANCELLED') OR s.start_time <= now() + interval '60 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This departure is no longer available. Review the booking first.');
  END IF;
  expiry := LEAST(now() + interval '24 hours', s.start_time - interval '60 minutes');
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

NOTIFY pgrst, 'reload schema';
COMMIT;
