-- Tighten remaining customer-facing anon reads.
--
-- These tables are intentionally readable by the booking site, but only in the
-- context of one tenant or, for vouchers, a specific voucher code. No-header
-- anon reads must not enumerate tenants, schedules, catalogs, or vouchers.

BEGIN;

CREATE OR REPLACE FUNCTION public.bt_request_header(header_name text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.headers', true), '')::jsonb ->> lower(header_name),
    ''
  );
$$;

DROP POLICY IF EXISTS "Allow all operations to maintain existing functionality" ON public.slots;
DROP POLICY IF EXISTS slots_anon_select ON public.slots;
CREATE POLICY slots_anon_select ON public.slots
  FOR SELECT TO anon
  USING (
    business_id::text = public.bt_request_header('x-tenant-business-id')
    AND status = 'OPEN'
    AND start_time > (now() - interval '7 days')
  );

DROP POLICY IF EXISTS "Allow all operations to maintain existing functionality" ON public.tours;
DROP POLICY IF EXISTS tours_anon_select ON public.tours;
CREATE POLICY tours_anon_select ON public.tours
  FOR SELECT TO anon
  USING (
    business_id::text = public.bt_request_header('x-tenant-business-id')
    AND active = true
    AND COALESCE(hidden, false) = false
  );

DROP POLICY IF EXISTS "Allow all operations to maintain existing functionality" ON public.vouchers;
DROP POLICY IF EXISTS vouchers_anon_select ON public.vouchers;
CREATE POLICY vouchers_anon_select ON public.vouchers
  FOR SELECT TO anon
  USING (
    upper(regexp_replace(code::text, '\s+', '', 'g')) =
      upper(regexp_replace(public.bt_request_header('x-voucher-code'), '\s+', '', 'g'))
    AND public.bt_request_header('x-voucher-code') <> ''
  );

DROP POLICY IF EXISTS "Allow all operations to maintain existing functionality" ON public.businesses;
DROP POLICY IF EXISTS businesses_anon_select ON public.businesses;
CREATE POLICY businesses_anon_select ON public.businesses
  FOR SELECT TO anon
  USING (
    id::text = public.bt_request_header('x-tenant-business-id')
    OR subdomain = public.bt_request_header('x-tenant-subdomain')
    OR regexp_replace(COALESCE(booking_site_url, ''), '/+$', '') =
      regexp_replace(COALESCE(NULLIF(public.bt_request_header('origin'), ''), public.bt_request_header('x-tenant-origin')), '/+$', '')
  );

COMMIT;
