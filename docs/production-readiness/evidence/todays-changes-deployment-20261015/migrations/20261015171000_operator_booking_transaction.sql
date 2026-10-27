begin;

-- Unknown historical party composition stays unknown. No guest/child identities are inferred.
alter table public.bookings add column if not exists party_composition jsonb;
create table public.operator_booking_requests (
  id uuid not null,
  business_id uuid not null references public.businesses(id),
  actor_admin_id uuid not null references public.admin_users(id),
  payload_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key(business_id,id)
);
alter table public.operator_booking_requests enable row level security;
create policy operator_booking_requests_read on public.operator_booking_requests for select to authenticated
  using(business_id=any(public.current_business_ids()));
revoke all on public.operator_booking_requests from public,anon,authenticated,service_role;
grant select on public.operator_booking_requests to authenticated,service_role;

-- Validate the existing configured-question model at the transaction boundary.
-- Definition versions are checked as JSON against server-owned configuration before preserving their exact serialized form.
create function public.operator_question_answer(q jsonb, answer jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare multiple boolean; blank boolean; text_value text; value jsonb; options jsonb:=q->'options';
begin
 multiple:=q->>'type'='multiselect' or (q->>'type'='checkbox' and jsonb_array_length(options)>0);
 blank:=answer is null or answer='null'::jsonb or answer='""'::jsonb or answer='[]'::jsonb or (jsonb_typeof(answer)='string' and trim(answer#>>'{}')='');
 if blank then
   if (q->>'required')::boolean then raise exception 'Required booking information: %',q->>'label'; end if;
   return case when multiple then '[]'::jsonb else '""'::jsonb end;
 end if;
 if multiple then
   if jsonb_typeof(answer)<>'array' then raise exception 'Choose listed options for %',q->>'label'; end if;
   if exists(select 1 from jsonb_array_elements(answer) a where jsonb_typeof(a)<>'string' or not exists(select 1 from jsonb_array_elements(options) o where o->'value'=a))
    or jsonb_array_length(answer)<>(select count(distinct a) from jsonb_array_elements(answer) a) then raise exception 'Choose listed options for %',q->>'label'; end if;
   return answer;
 end if;
 if jsonb_typeof(answer) not in ('string','number','boolean') then raise exception 'Invalid answer for %',q->>'label'; end if;
 text_value:=case when q->>'type' in ('select','radio') then answer#>>'{}' else trim(answer#>>'{}') end;
 if length(text_value)>4000 then raise exception 'Answer exceeds 4000 characters: %',q->>'label'; end if;
 if q->>'type'='number' then
   begin
     if text_value::numeric in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or abs(text_value::numeric)>1.7976931348623157e308 then raise invalid_text_representation; end if;
   exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid number for %',q->>'label'; end;
 end if;
 if q->>'type' in ('select','radio') and not exists(select 1 from jsonb_array_elements(options) o where o->>'value'=text_value) then raise exception 'Choose listed options for %',q->>'label'; end if;
 if q->>'type'='checkbox' and jsonb_array_length(options)=0 and text_value not in ('true','false') then raise exception 'Choose Yes or No for %',q->>'label'; end if;
 if q->>'type'='date' then
   begin
     if text_value!~'^\d{4}-\d{2}-\d{2}$' or to_char(text_value::date,'YYYY-MM-DD')<>text_value then raise invalid_datetime_format; end if;
   exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid date for %',q->>'label'; end;
 end if;
 return to_jsonb(text_value);
end $$;
revoke all on function public.operator_question_answer(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.operator_booking_fields(raw jsonb, answers jsonb, party integer, business uuid, tour uuid) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare f jsonb; q jsonb; option jsonb; options jsonb; k text; kind text; scope text; keys text[]:='{}'; definitions jsonb:='[]'; clean jsonb:='{}'; supplied jsonb; version_value jsonb; version_text text; items jsonb; i integer; position integer:=0;
begin
 if jsonb_typeof(raw)<>'array' or jsonb_typeof(answers)<>'object' then raise exception 'Invalid booking question configuration or answers'; end if;
 for f in select value from jsonb_array_elements(raw) with ordinality as fields(value,n) order by case when jsonb_typeof(value->'sort_order')='number' then (value->>'sort_order')::numeric else n-1 end,n loop
   if jsonb_typeof(f)<>'object' then raise exception 'Invalid booking question definition'; end if;
   if f->'enabled'='false'::jsonb or f->'active'='false'::jsonb then continue; end if;
   if coalesce(f->>'business_id','')<>'' and f->>'business_id'<>business::text then continue; end if;
   if coalesce(f->>'tour_id','')<>'' and f->>'tour_id'<>tour::text then continue; end if;
   if f ? 'tour_ids' then
     if jsonb_typeof(f->'tour_ids')<>'array' then raise exception 'Invalid question activity scope'; end if;
     if exists(select 1 from jsonb_array_elements(f->'tour_ids') x where jsonb_typeof(x)<>'string') then raise exception 'Invalid question activity scope'; end if;
     if jsonb_array_length(f->'tour_ids')>0 and not (f->'tour_ids' ? tour::text) then continue; end if;
   end if;
   k:=coalesce(nullif(f->>'key',''),f->>'id','');kind:=coalesce(nullif(f->>'type',''),'text');scope:=coalesce(nullif(f->>'scope',''),'booking');
   if k!~'^[a-zA-Z0-9_-]{1,128}$' or k in ('__booking_questions','__proto__','constructor','prototype') or k=any(keys) then raise exception 'Invalid or duplicate booking question identifier'; end if;
   keys:=array_append(keys,k);
   if jsonb_typeof(f->'label') is distinct from 'string' or trim(f->>'label')='' or kind not in ('text','textarea','number','select','radio','checkbox','multiselect','date') or scope not in ('booking','per_booking','participant','per_participant') then raise exception 'Invalid booking question definition'; end if;
   if f ? 'required' and jsonb_typeof(f->'required')<>'boolean' then raise exception 'Invalid required setting'; end if;
   scope:=case when scope in ('participant','per_participant') then 'participant' else 'booking' end;
   options:='[]';
   if f ? 'options' then
     if jsonb_typeof(f->'options')<>'array' then raise exception 'Invalid booking question choices'; end if;
     for option in select value from jsonb_array_elements(f->'options') loop
       if jsonb_typeof(option)='string' and trim(option#>>'{}')<>'' then option:=jsonb_build_object('value',option,'label',option);
       elsif jsonb_typeof(option)<>'object' or jsonb_typeof(option->'value') is distinct from 'string' or coalesce(option->>'value','')='' or jsonb_typeof(option->'label') is distinct from 'string' or coalesce(trim(option->>'label'),'')='' then raise exception 'Invalid booking question choice'; end if;
       options:=options||jsonb_build_array(jsonb_build_object('value',option->'value','label',option->'label'));
     end loop;
   end if;
   if (kind in ('select','radio','multiselect') and jsonb_array_length(options)=0) or jsonb_array_length(options)<>(select count(distinct o->>'value') from jsonb_array_elements(options) o) then raise exception 'Missing or duplicate question choices'; end if;
   q:=jsonb_build_object('key',k,'label',f->>'label','type',kind,'scope',scope,'required',coalesce((f->>'required')::boolean,false),'placeholder',case when jsonb_typeof(f->'placeholder')='string' then f->>'placeholder' else '' end,'options',options);
   supplied:=answers->'__booking_questions'->'definitions'->position;
   if supplied is null then raise exception 'Booking questions changed. Refresh and review before creating this booking.'; end if;
   begin version_value:=(supplied->>'version')::jsonb; exception when others then raise exception 'Invalid booking question version'; end;
   if supplied-'version'<>q or version_value is distinct from jsonb_build_array(q,coalesce(nullif(f->'version','null'::jsonb),f->'updated_at','null'::jsonb)) then raise exception 'Booking questions changed. Refresh and review before creating this booking.'; end if;
   version_text:=supplied->>'version';definitions:=definitions||jsonb_build_array(q||jsonb_build_object('version',version_text));position:=position+1;
   if scope='participant' then
     if answers ? k and jsonb_typeof(answers->k)<>'array' then raise exception 'Enter separate answers for each guest: %',q->>'label'; end if;
     items:='[]';for i in 0..party-1 loop items:=items||jsonb_build_array(public.operator_question_answer(q,answers->k->i));end loop;
     clean:=clean||jsonb_build_object(k,items);
   else clean:=clean||jsonb_build_object(k,public.operator_question_answer(q,answers->k));end if;
 end loop;
 if jsonb_typeof(answers->'__booking_questions'->'definitions') is distinct from 'array' or jsonb_array_length(answers->'__booking_questions'->'definitions')<>position or answers->'__booking_questions'->>'business_id' is distinct from business::text or answers->'__booking_questions'->>'tour_id' is distinct from tour::text or answers->'__booking_questions'->>'format' is distinct from '1' then raise exception 'Booking questions changed. Refresh and review before creating this booking.'; end if;
 return clean||jsonb_build_object('__booking_questions',jsonb_build_object('format',1,'business_id',business,'tour_id',tour,'definitions',definitions,'captured_at',now()));
end $$;
revoke all on function public.operator_booking_fields(jsonb,jsonb,integer,uuid,uuid) from public,anon,authenticated,service_role;

create function public.create_operator_booking(p_business_id uuid,p_request_id uuid,p_payload jsonb)
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
 email:=lower(trim(p_payload->>'email')); phone:=trim(p_payload->>'phone');
 if state is null or state not in ('PENDING','HELD','CONFIRMED','PAID') then raise exception 'Choose a supported payment action'; end if;
 if coalesce(guest,'')='' or coalesce(email,'')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(phone,'')!~'^[0-9]{7,15}$' then raise exception 'Valid guest name, email and international phone are required'; end if;
 select * into activity from public.tours where id=(p_payload->>'tour_id')::uuid and business_id=p_business_id and active;
 if not found then raise exception 'Activity is unavailable'; end if;
 select * into departure from public.slots where id=(p_payload->>'slot_id')::uuid and tour_id=activity.id and business_id=p_business_id for update;
 if not found or departure.status<>'OPEN' or departure.start_time<=now() then raise exception 'Departure is unavailable'; end if;
 if state in ('PENDING','HELD') and departure.start_time<=now()+interval '60 minutes' then raise exception 'Payment holds close 60 minutes before departure. Choose a supported confirmed/payment-received action or another departure.'; end if;
 checked_fields:=public.operator_booking_fields(coalesce(business.booking_custom_fields,'[]'::jsonb),coalesce(p_payload->'custom_fields','{}'::jsonb),party,p_business_id,activity.id);
 unit:=coalesce(departure.price_per_person_override,activity.base_price_per_person,0);
 if unit<0 then raise exception 'Activity price is invalid'; end if;
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
revoke all on function public.create_operator_booking(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_operator_booking(uuid,uuid,jsonb) to authenticated;
-- Existing checkout routine retained; only verified operator manual quotes bypass repricing.
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
  IF NOT FOUND OR s.status IN ('CLOSED', 'CANCELLED') OR b.qty <= 0 OR b.qty > 50 THEN
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
notify pgrst,'reload schema';
commit;
