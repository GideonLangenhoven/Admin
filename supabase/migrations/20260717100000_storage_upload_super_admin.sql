-- Storage upload RLS: tenant admins can only write inside their own business folder,
-- but SUPER_ADMIN must be able to write into any tenant's folder (cross-tenant admin
-- work, e.g. adding tour images for a tenant). Also fixes marketing-assets policies
-- which compared admin_users.id to auth.uid() (never equal since sessions moved to
-- Supabase Auth — auth.uid() matches admin_users.user_id, not admin_users.id).
--
-- NOTE: this codifies policies that were previously applied straight to the live DB
-- (email_images_authenticated_*): the repo migrations still described the old
-- anon-writable bucket. This file is now the source of truth.

CREATE OR REPLACE FUNCTION public.storage_admin_business_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT business_id::text FROM admin_users
  WHERE user_id = auth.uid() AND NOT COALESCE(suspended, false);
$$;

CREATE OR REPLACE FUNCTION public.storage_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users
    WHERE user_id = auth.uid() AND role = 'SUPER_ADMIN' AND NOT COALESCE(suspended, false)
  );
$$;

-- ── email-images ──
DROP POLICY IF EXISTS "email-images: upload" ON storage.objects;
DROP POLICY IF EXISTS "email-images: update" ON storage.objects;
DROP POLICY IF EXISTS "email-images: delete" ON storage.objects;
DROP POLICY IF EXISTS email_images_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS email_images_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS email_images_authenticated_delete ON storage.objects;

CREATE POLICY email_images_authenticated_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'email-images'
  AND ((storage.foldername(name))[1] IN (SELECT public.storage_admin_business_ids()) OR public.storage_is_super_admin())
);

CREATE POLICY email_images_authenticated_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'email-images'
  AND ((storage.foldername(name))[1] IN (SELECT public.storage_admin_business_ids()) OR public.storage_is_super_admin())
)
WITH CHECK (
  bucket_id = 'email-images'
  AND ((storage.foldername(name))[1] IN (SELECT public.storage_admin_business_ids()) OR public.storage_is_super_admin())
);

CREATE POLICY email_images_authenticated_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'email-images'
  AND ((storage.foldername(name))[1] IN (SELECT public.storage_admin_business_ids()) OR public.storage_is_super_admin())
);

-- ── marketing-assets (fix broken au.id = auth.uid() comparison) ──
DROP POLICY IF EXISTS marketing_assets_insert ON storage.objects;
DROP POLICY IF EXISTS marketing_assets_delete ON storage.objects;

CREATE POLICY marketing_assets_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'marketing-assets'
  AND ((storage.foldername(name))[1] IN (SELECT public.storage_admin_business_ids()) OR public.storage_is_super_admin())
);

CREATE POLICY marketing_assets_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'marketing-assets'
  AND ((storage.foldername(name))[1] IN (SELECT public.storage_admin_business_ids()) OR public.storage_is_super_admin())
);
