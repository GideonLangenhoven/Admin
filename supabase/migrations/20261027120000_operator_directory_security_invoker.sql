begin;
-- Clears Supabase lint 0010 (security_definer_view) on operator_directory and
-- closes the write hole behind it.
--
-- The view reads past businesses RLS on purpose (businesses_anon_select blocks
-- tenant enumeration, the directory needs every listed operator). But it was
-- also auto-updatable and kept Supabase's default ALL grant to anon, so the
-- public anon key could PATCH/DELETE businesses rows through it (subdomain,
-- booking_site_url, logo_url, names) with RLS bypassed.
--
-- The RLS bypass now lives in a SECURITY DEFINER function in the unexposed
-- app_private schema, and the public view is security_invoker over it. A view
-- over a function is not updatable, and anon/authenticated drop to SELECT.
-- Same columns, same rows: the booking site needs no change.

CREATE OR REPLACE FUNCTION app_private.operator_directory_rows()
RETURNS TABLE (
  id uuid, name text, business_name text, business_tagline text, subdomain text,
  logo_url text, booking_site_url text, location_phrase text,
  hero_image_url text, tour_count bigint, from_price numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    b.id, b.name, b.business_name, b.business_tagline, b.subdomain,
    b.logo_url, b.booking_site_url, b.location_phrase,
    (SELECT t.image_url FROM public.tours t
      WHERE t.business_id = b.id AND t.active = true AND t.image_url IS NOT NULL
      ORDER BY t.sort_order LIMIT 1),
    (SELECT count(*) FROM public.tours t
      WHERE t.business_id = b.id AND t.active = true),
    (SELECT min(t.base_price_per_person) FROM public.tours t
      WHERE t.business_id = b.id AND t.active = true)
  FROM public.businesses b
  WHERE b.directory_visible = true
    AND b.subdomain IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION app_private.operator_directory_rows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.operator_directory_rows() TO anon, authenticated, service_role;

-- CREATE OR REPLACE VIEW resets view options: any later replace of this view
-- must repeat WITH (security_invoker = true) or the lint comes back.
CREATE OR REPLACE VIEW public.operator_directory WITH (security_invoker = true) AS
  SELECT * FROM app_private.operator_directory_rows();

REVOKE ALL ON public.operator_directory FROM anon, authenticated;
GRANT SELECT ON public.operator_directory TO anon, authenticated;
commit;
