-- ════════════════════════════════════════════════════════════════════
-- 2026-05-15 — V-NEW-1: enrollments RLS
--
-- pg_policies query confirmed marketing_automation_enrollments has only a
-- SELECT policy for authenticated and an ALL policy for service_role. No
-- INSERT/UPDATE/DELETE for the admin-app session, so contact_added trigger
-- writes get rejected with:
--   new row violates row-level security policy for table
--     marketing_automation_enrollments
--
-- Recreate the standard auth-side policies keyed off current_business_ids()
-- (same shape used by every other marketing_* table per
--  20260502053731_rls_fix_broken_auth_uid_lookup.sql) and re-grant the
-- table privileges to authenticated. Same shape applied to
-- marketing_automation_logs so step-execution audit can land too.
--
-- W-1 is NOT included in this migration. Diagnostic:
--   SELECT code, valid_from, valid_until FROM promotions WHERE code = 'SUMMEE20'
--   → valid_from=2026-05-02, valid_until=NULL
-- validate_promo_code is doing the right thing — the row has no end date
-- set. Fix lives in the admin UI (clearer "no expiry" indicator + save
-- warning) so operators don't read valid_from as the expiry.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop any prior / conflicting policies. Names from FIX_automation_rls_policies.sql
-- and 20260502053731_rls_fix_broken_auth_uid_lookup.sql are both included so a
-- replay against either prior state is idempotent.
DROP POLICY IF EXISTS marketing_automation_enrollments_insert_own ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS marketing_automation_enrollments_select_own ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS marketing_automation_enrollments_update_own ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS marketing_automation_enrollments_delete_own ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS marketing_automation_enrollments_service ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS "Users can view enrollments for their business" ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS "Users can insert enrollments for their business" ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS mkt_enrollments_auth_select ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS mkt_enrollments_auth_insert ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS mkt_enrollments_auth_update ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS mkt_enrollments_auth_delete ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS mkt_enrollments_service ON public.marketing_automation_enrollments;

CREATE POLICY mkt_enrollments_service ON public.marketing_automation_enrollments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY mkt_enrollments_auth_select ON public.marketing_automation_enrollments
  FOR SELECT TO authenticated
  USING (business_id = ANY (public.current_business_ids()));

CREATE POLICY mkt_enrollments_auth_insert ON public.marketing_automation_enrollments
  FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (public.current_business_ids()));

CREATE POLICY mkt_enrollments_auth_update ON public.marketing_automation_enrollments
  FOR UPDATE TO authenticated
  USING (business_id = ANY (public.current_business_ids()))
  WITH CHECK (business_id = ANY (public.current_business_ids()));

CREATE POLICY mkt_enrollments_auth_delete ON public.marketing_automation_enrollments
  FOR DELETE TO authenticated
  USING (business_id = ANY (public.current_business_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_automation_enrollments TO authenticated;

-- Same shape for the logs table.
DROP POLICY IF EXISTS marketing_automation_logs_insert_own ON public.marketing_automation_logs;
DROP POLICY IF EXISTS marketing_automation_logs_select_own ON public.marketing_automation_logs;
DROP POLICY IF EXISTS marketing_automation_logs_service ON public.marketing_automation_logs;
DROP POLICY IF EXISTS "Users can view automation logs for their business" ON public.marketing_automation_logs;
DROP POLICY IF EXISTS "Users can insert automation logs for their business" ON public.marketing_automation_logs;
DROP POLICY IF EXISTS mkt_auto_logs_auth_select ON public.marketing_automation_logs;
DROP POLICY IF EXISTS mkt_auto_logs_auth_insert ON public.marketing_automation_logs;
DROP POLICY IF EXISTS mkt_auto_logs_service ON public.marketing_automation_logs;

CREATE POLICY mkt_auto_logs_service ON public.marketing_automation_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY mkt_auto_logs_auth_select ON public.marketing_automation_logs
  FOR SELECT TO authenticated
  USING (business_id = ANY (public.current_business_ids()));

CREATE POLICY mkt_auto_logs_auth_insert ON public.marketing_automation_logs
  FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (public.current_business_ids()));

GRANT SELECT, INSERT ON public.marketing_automation_logs TO authenticated;

COMMIT;
