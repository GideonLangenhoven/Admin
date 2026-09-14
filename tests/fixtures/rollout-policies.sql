-- Existing RPCs and RLS policies, schema metadata only; no user records.
CREATE OR REPLACE FUNCTION public.current_business_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (
    SELECT id, business_id, role
    FROM public.admin_users
    WHERE user_id = auth.uid()
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM me WHERE upper(coalesce(role, '')) LIKE 'SUPER%')
      THEN COALESCE((SELECT array_agg(id) FROM public.businesses), '{}'::uuid[])
    ELSE COALESCE((SELECT array_agg(DISTINCT business_id) FROM me WHERE business_id IS NOT NULL), '{}'::uuid[])
  END
$function$
;
CREATE OR REPLACE FUNCTION public.increment_marketing_monthly_usage(p_business_id uuid, p_period text, p_amount integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.marketing_usage_monthly (business_id, period, emails_sent)
  VALUES (p_business_id, p_period, p_amount)
  ON CONFLICT (business_id, period)
  DO UPDATE SET emails_sent = public.marketing_usage_monthly.emails_sent + p_amount,
                updated_at = now();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.upsert_customer(p_business_id uuid, p_email text, p_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT NULL::boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_business_id IS NULL OR p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'business_id and email are required';
  END IF;

  SELECT id INTO v_id
  FROM public.customers
  WHERE business_id = p_business_id
    AND email_lower = lower(p_email)
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.customers SET
      name = COALESCE(NULLIF(trim(p_name), ''), name),
      phone = COALESCE(NULLIF(trim(p_phone), ''), phone),
      marketing_consent = COALESCE(p_marketing_consent, marketing_consent),
      updated_at = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.customers (business_id, email, name, phone, marketing_consent)
  VALUES (
    p_business_id,
    trim(p_email),
    NULLIF(trim(p_name), ''),
    NULLIF(trim(p_phone), ''),
    COALESCE(p_marketing_consent, false)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.calculate_refund_percent(
  p_business_id uuid,
  p_tour_start  timestamptz,
  p_now         timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tiers       jsonb;
  v_hours_left  numeric;
  v_tier        jsonb;
  v_percent     integer := 0;
BEGIN
  SELECT refund_policy_tiers INTO v_tiers
    FROM public.businesses WHERE id = p_business_id;

  IF v_tiers IS NULL OR jsonb_typeof(v_tiers) <> 'array' THEN
    RETURN 0;
  END IF;

  v_hours_left := EXTRACT(EPOCH FROM (p_tour_start - p_now)) / 3600.0;

  FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) ORDER BY (value->>'hours_before')::numeric DESC LOOP
    IF v_hours_left >= (v_tier->>'hours_before')::numeric THEN
      v_percent := (v_tier->>'refund_percent')::integer;
      RETURN GREATEST(0, LEAST(100, v_percent));
    END IF;
  END LOOP;

  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION public.calculate_refund_percent(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_refund_percent(uuid, timestamptz, timestamptz) TO authenticated, service_role;

grant usage on schema public, auth to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
alter table public.admin_users enable row level security;
alter table public.bookings enable row level security;
alter table public.businesses enable row level security;
alter table public.customers enable row level security;
alter table public.reviews enable row level security;
create policy "admin_users_select_own_tenant" on public.admin_users for SELECT to authenticated using ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "admin_users_update_own_tenant" on public.admin_users for UPDATE to authenticated using ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest))) with check ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "bookings_anon_insert" on public.bookings for INSERT to anon,authenticated with check (((status = ANY (ARRAY['DRAFT'::text, 'PENDING'::text])) AND ((business_id)::text = ( SELECT bt_request_header('x-tenant-business-id'::text) AS bt_request_header))));
create policy "bookings_anon_update" on public.bookings for UPDATE to anon,authenticated using (((status = ANY (ARRAY['DRAFT'::text, 'PENDING'::text])) AND ((business_id)::text = ( SELECT bt_request_header('x-tenant-business-id'::text) AS bt_request_header)))) with check (((status <> ALL (ARRAY['PAID'::text, 'CONFIRMED'::text])) AND ((business_id)::text = ( SELECT bt_request_header('x-tenant-business-id'::text) AS bt_request_header))));
create policy "bookings_read" on public.bookings for SELECT to anon,authenticated using ((((COALESCE(( SELECT current_setting('request.method'::text, true) AS current_setting), ''::text) = ANY (ARRAY['POST'::text, 'PATCH'::text])) AND ((business_id)::text = ( SELECT bt_request_header('x-tenant-business-id'::text) AS bt_request_header)) AND (status = ANY (ARRAY['DRAFT'::text, 'PENDING'::text]))) OR (( SELECT bt_request_header('x-booking-success-token'::text) AS bt_request_header) = (id)::text) OR ((( SELECT bt_request_header('x-booking-id'::text) AS bt_request_header) = (id)::text) AND (( SELECT bt_request_header('x-booking-waiver-token'::text) AS bt_request_header) = (waiver_token)::text)) OR (customer_id IN ( SELECT c.id
   FROM customers c
  WHERE (c.user_id = ( SELECT auth.uid() AS uid)))) OR (business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest))));
create policy "bookings_tenant_delete" on public.bookings for DELETE to authenticated using ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "bookings_tenant_insert" on public.bookings for INSERT to authenticated with check ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "bookings_tenant_update" on public.bookings for UPDATE to authenticated using ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest))) with check ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "businesses_anon_select" on public.businesses for SELECT to anon,authenticated using ((((id)::text = ( SELECT bt_request_header('x-tenant-business-id'::text) AS bt_request_header)) OR (subdomain = ( SELECT bt_request_header('x-tenant-subdomain'::text) AS bt_request_header)) OR (regexp_replace(COALESCE(booking_site_url, ''::text), '/+$'::text, ''::text) = regexp_replace(COALESCE(NULLIF(( SELECT bt_request_header('origin'::text) AS bt_request_header), ''::text), ( SELECT bt_request_header('x-tenant-origin'::text) AS bt_request_header)), '/+$'::text, ''::text))));
create policy "businesses_select_own" on public.businesses for SELECT to authenticated using ((id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "businesses_super_admin_all" on public.businesses for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = ( SELECT auth.uid() AS uid)) AND (upper(COALESCE(au.role, ''::text)) ~~ 'SUPER%'::text))))) with check ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE ((au.user_id = ( SELECT auth.uid() AS uid)) AND (upper(COALESCE(au.role, ''::text)) ~~ 'SUPER%'::text)))));
create policy "businesses_update_own" on public.businesses for UPDATE to authenticated using ((id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest))) with check ((id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "customers_modify_own_business" on public.customers for ALL to authenticated using ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest))) with check ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "customers_select_own_business" on public.customers for SELECT to authenticated using ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "customers_self_read" on public.customers for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "customers_self_update" on public.customers for UPDATE to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "customers_service_all" on public.customers for ALL to service_role using (true) with check (true);
create policy "reviews_anon_read" on public.reviews for SELECT to anon,authenticated using ((status = 'APPROVED'::text));
create policy "reviews_authenticated_read" on public.reviews for SELECT to authenticated using ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "reviews_authenticated_update" on public.reviews for UPDATE to authenticated using ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest))) with check ((business_id IN ( SELECT unnest(( SELECT current_business_ids() AS current_business_ids)) AS unnest)));
create policy "reviews_service_insert" on public.reviews for INSERT to service_role with check (true);
create policy "reviews_service_update" on public.reviews for UPDATE to service_role using (true);
revoke select on public.businesses from anon;
grant select (id, name, business_name, subdomain, booking_site_url) on public.businesses to anon;

-- Existing related-table reads, verified from read-only metadata 9 September.
alter table public.slots enable row level security;
alter table public.tours enable row level security;
create policy slots_read on public.slots for select to anon, authenticated using (
  (business_id::text = (select bt_request_header('x-tenant-business-id')) and status = 'OPEN' and start_time > now() - interval '7 days')
  or business_id = any((select current_business_ids())::uuid[])
);
create policy tours_read on public.tours for select to anon, authenticated using (
  (business_id::text = (select bt_request_header('x-tenant-business-id')) and active and not coalesce(hidden, false))
  or business_id = any((select current_business_ids())::uuid[])
);
