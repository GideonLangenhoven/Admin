-- RLS Fix: replace broken au.id = auth.uid() policies with current_business_ids().
-- These 26 policies across 11 tables used the wrong column (au.id instead of au.user_id)
-- to match admin_users to the current session. They were masked by USING(true) overrides
-- that were dropped in migration 20260502060000_rls_tighten_tenant_isolation.sql.
--
-- Also adds missing authenticated CRUD policies for promotions.

BEGIN;

-- ============================================================
-- 1. audit_logs — replace broken SELECT policy
-- ============================================================

DROP POLICY IF EXISTS "Users can view audit logs for their business" ON public.audit_logs;
CREATE POLICY "audit_logs_auth_select"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- ============================================================
-- 2. chat_messages — replace broken SELECT/INSERT policies
-- ============================================================

DROP POLICY IF EXISTS "Users can view chat messages for their business" ON public.chat_messages;
CREATE POLICY "chat_messages_auth_select"
  ON public.chat_messages FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert chat messages for their business" ON public.chat_messages;
CREATE POLICY "chat_messages_auth_insert"
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

-- ============================================================
-- 3. marketing_automation_enrollments — replace broken SELECT/INSERT
-- ============================================================

DROP POLICY IF EXISTS "Users can view enrollments for their business" ON public.marketing_automation_enrollments;
CREATE POLICY "mkt_enrollments_auth_select"
  ON public.marketing_automation_enrollments FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert enrollments for their business" ON public.marketing_automation_enrollments;
CREATE POLICY "mkt_enrollments_auth_insert"
  ON public.marketing_automation_enrollments FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

-- ============================================================
-- 4. marketing_automation_logs — replace broken SELECT/INSERT
-- ============================================================

DROP POLICY IF EXISTS "Users can view automation logs for their business" ON public.marketing_automation_logs;
CREATE POLICY "mkt_auto_logs_auth_select"
  ON public.marketing_automation_logs FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert automation logs for their business" ON public.marketing_automation_logs;
CREATE POLICY "mkt_auto_logs_auth_insert"
  ON public.marketing_automation_logs FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

-- ============================================================
-- 5. marketing_automation_steps — replace broken SELECT/INSERT/UPDATE/DELETE
-- ============================================================

DROP POLICY IF EXISTS "Users can view automation steps for their business" ON public.marketing_automation_steps;
CREATE POLICY "mkt_auto_steps_auth_select"
  ON public.marketing_automation_steps FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert automation steps for their business" ON public.marketing_automation_steps;
CREATE POLICY "mkt_auto_steps_auth_insert"
  ON public.marketing_automation_steps FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can update automation steps for their business" ON public.marketing_automation_steps;
CREATE POLICY "mkt_auto_steps_auth_update"
  ON public.marketing_automation_steps FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids()))
  WITH CHECK (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can delete automation steps for their business" ON public.marketing_automation_steps;
CREATE POLICY "mkt_auto_steps_auth_delete"
  ON public.marketing_automation_steps FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- ============================================================
-- 6. marketing_automations — replace broken SELECT/INSERT/UPDATE/DELETE
-- ============================================================

DROP POLICY IF EXISTS "Users can view automations for their business" ON public.marketing_automations;
CREATE POLICY "mkt_automations_auth_select"
  ON public.marketing_automations FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert automations for their business" ON public.marketing_automations;
CREATE POLICY "mkt_automations_auth_insert"
  ON public.marketing_automations FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can update automations for their business" ON public.marketing_automations;
CREATE POLICY "mkt_automations_auth_update"
  ON public.marketing_automations FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids()))
  WITH CHECK (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can delete automations for their business" ON public.marketing_automations;
CREATE POLICY "mkt_automations_auth_delete"
  ON public.marketing_automations FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- ============================================================
-- 7. marketing_contacts — replace broken SELECT/INSERT/UPDATE
-- ============================================================

DROP POLICY IF EXISTS "Users can view contacts for their business" ON public.marketing_contacts;
CREATE POLICY "mkt_contacts_auth_select"
  ON public.marketing_contacts FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert contacts for their business" ON public.marketing_contacts;
CREATE POLICY "mkt_contacts_auth_insert"
  ON public.marketing_contacts FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can update contacts for their business" ON public.marketing_contacts;
CREATE POLICY "mkt_contacts_auth_update"
  ON public.marketing_contacts FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids()))
  WITH CHECK (business_id = ANY (current_business_ids()));

-- ============================================================
-- 8. marketing_events — replace broken SELECT/INSERT
-- ============================================================

DROP POLICY IF EXISTS "Users can view events for their business" ON public.marketing_events;
CREATE POLICY "mkt_events_auth_select"
  ON public.marketing_events FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert events for their business" ON public.marketing_events;
CREATE POLICY "mkt_events_auth_insert"
  ON public.marketing_events FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

-- ============================================================
-- 9. marketing_queue — replace broken SELECT/INSERT/UPDATE
-- ============================================================

DROP POLICY IF EXISTS "Users can view queue for their business" ON public.marketing_queue;
CREATE POLICY "mkt_queue_auth_select"
  ON public.marketing_queue FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert queue for their business" ON public.marketing_queue;
CREATE POLICY "mkt_queue_auth_insert"
  ON public.marketing_queue FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can update queue for their business" ON public.marketing_queue;
CREATE POLICY "mkt_queue_auth_update"
  ON public.marketing_queue FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids()))
  WITH CHECK (business_id = ANY (current_business_ids()));

-- ============================================================
-- 10. marketing_templates — replace broken SELECT/INSERT/UPDATE/DELETE
-- ============================================================

DROP POLICY IF EXISTS "Users can view templates for their business" ON public.marketing_templates;
CREATE POLICY "mkt_templates_auth_select"
  ON public.marketing_templates FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert templates for their business" ON public.marketing_templates;
CREATE POLICY "mkt_templates_auth_insert"
  ON public.marketing_templates FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can update templates for their business" ON public.marketing_templates;
CREATE POLICY "mkt_templates_auth_update"
  ON public.marketing_templates FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids()))
  WITH CHECK (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can delete templates for their business" ON public.marketing_templates;
CREATE POLICY "mkt_templates_auth_delete"
  ON public.marketing_templates FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- ============================================================
-- 11. marketing_usage_monthly — replace broken SELECT/INSERT/UPDATE
-- ============================================================

DROP POLICY IF EXISTS "Users can view usage for their business" ON public.marketing_usage_monthly;
CREATE POLICY "mkt_usage_auth_select"
  ON public.marketing_usage_monthly FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can insert usage for their business" ON public.marketing_usage_monthly;
CREATE POLICY "mkt_usage_auth_insert"
  ON public.marketing_usage_monthly FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

DROP POLICY IF EXISTS "Users can update usage for their business" ON public.marketing_usage_monthly;
CREATE POLICY "mkt_usage_auth_update"
  ON public.marketing_usage_monthly FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids()))
  WITH CHECK (business_id = ANY (current_business_ids()));

-- ============================================================
-- 12. promotions — add missing authenticated CRUD policies
-- ============================================================

CREATE POLICY "promotions_auth_select"
  ON public.promotions FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

CREATE POLICY "promotions_auth_insert"
  ON public.promotions FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

CREATE POLICY "promotions_auth_update"
  ON public.promotions FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids()))
  WITH CHECK (business_id = ANY (current_business_ids()));

CREATE POLICY "promotions_auth_delete"
  ON public.promotions FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));

COMMIT;
