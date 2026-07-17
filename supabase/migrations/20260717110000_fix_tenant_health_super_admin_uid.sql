-- Same auth.uid()-vs-admin_users.id bug found and fixed for storage policies
-- (20260717100000_storage_upload_super_admin.sql): admin_users.id is the row's
-- own primary key, not the Supabase Auth user id — auth.uid() matches
-- admin_users.user_id. This policy could never match any SUPER_ADMIN.
-- No app code reads tenant_health yet, so this has caused no live incident,
-- but it's the same class of bug and cheap to close now.
DROP POLICY IF EXISTS tenant_health_superadmin_select ON public.tenant_health;
CREATE POLICY tenant_health_superadmin_select ON public.tenant_health
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid() AND au.role = 'SUPER_ADMIN'
    )
  );
