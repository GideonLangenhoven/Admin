ALTER POLICY add_ons_anon_select ON public.add_ons
  USING (active = true AND (business_id)::text = NULLIF((SELECT public.bt_request_header('x-tenant-business-id')), ''));

ALTER POLICY businesses_anon_select ON public.businesses
  USING (
    (id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
    OR subdomain = (SELECT public.bt_request_header('x-tenant-subdomain'))
    OR regexp_replace(COALESCE(booking_site_url, ''), '/+$', '') = regexp_replace(
         COALESCE(NULLIF((SELECT public.bt_request_header('origin')), ''), (SELECT public.bt_request_header('x-tenant-origin'))), '/+$', '')
  );

ALTER POLICY promotions_anon_select ON public.promotions
  USING ((business_id)::text = NULLIF((SELECT public.bt_request_header('x-tenant-business-id')), ''));

ALTER POLICY slots_anon_select ON public.slots
  USING (
    (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
    AND status = 'OPEN'
    AND start_time > (now() - '7 days'::interval)
  );

ALTER POLICY tours_anon_select ON public.tours
  USING (
    (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
    AND active = true
    AND COALESCE(hidden, false) = false
  );

ALTER POLICY vouchers_anon_insert ON public.vouchers
  WITH CHECK (
    status = 'PENDING'
    AND (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
  );

ALTER POLICY vouchers_anon_select ON public.vouchers
  USING (
    upper(regexp_replace(code, '\s+', '', 'g')) = upper(regexp_replace((SELECT public.bt_request_header('x-voucher-code')), '\s+', '', 'g'))
    AND (SELECT public.bt_request_header('x-voucher-code')) <> ''
    AND (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
  );;
