
-- Fix all policies using broken au.id = auth.uid() (should be au.user_id = auth.uid()).
-- Replace with current_business_ids() for consistency with working policies.

-- audit_logs
DROP POLICY IF EXISTS "audit_logs_select_own_business" ON public.audit_logs;
CREATE POLICY "audit_logs_select_own_business" ON public.audit_logs FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- chat_messages
DROP POLICY IF EXISTS "chat_messages_select_own_business" ON public.chat_messages;
CREATE POLICY "chat_messages_select_own_business" ON public.chat_messages FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "chat_messages_insert_own_business" ON public.chat_messages;
CREATE POLICY "chat_messages_insert_own_business" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

-- marketing_automation_enrollments
DROP POLICY IF EXISTS "marketing_automation_enrollments_select_own" ON public.marketing_automation_enrollments;
CREATE POLICY "marketing_automation_enrollments_select_own" ON public.marketing_automation_enrollments FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- marketing_automation_logs
DROP POLICY IF EXISTS "marketing_automation_logs_select_own" ON public.marketing_automation_logs;
CREATE POLICY "marketing_automation_logs_select_own" ON public.marketing_automation_logs FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- marketing_automations
DROP POLICY IF EXISTS "marketing_automations_select_own" ON public.marketing_automations;
CREATE POLICY "marketing_automations_select_own" ON public.marketing_automations FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_automations_insert_own" ON public.marketing_automations;
CREATE POLICY "marketing_automations_insert_own" ON public.marketing_automations FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_automations_update_own" ON public.marketing_automations;
CREATE POLICY "marketing_automations_update_own" ON public.marketing_automations FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids())) WITH CHECK (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_automations_delete_own" ON public.marketing_automations;
CREATE POLICY "marketing_automations_delete_own" ON public.marketing_automations FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- marketing_contacts
DROP POLICY IF EXISTS "marketing_contacts_select_own" ON public.marketing_contacts;
CREATE POLICY "marketing_contacts_select_own" ON public.marketing_contacts FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_contacts_insert_own" ON public.marketing_contacts;
CREATE POLICY "marketing_contacts_insert_own" ON public.marketing_contacts FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_contacts_update_own" ON public.marketing_contacts;
CREATE POLICY "marketing_contacts_update_own" ON public.marketing_contacts FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids())) WITH CHECK (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_contacts_delete_own" ON public.marketing_contacts;
CREATE POLICY "marketing_contacts_delete_own" ON public.marketing_contacts FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- marketing_events
DROP POLICY IF EXISTS "marketing_events_select_own" ON public.marketing_events;
CREATE POLICY "marketing_events_select_own" ON public.marketing_events FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- marketing_queue
DROP POLICY IF EXISTS "marketing_queue_select_own" ON public.marketing_queue;
CREATE POLICY "marketing_queue_select_own" ON public.marketing_queue FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_queue_insert_own" ON public.marketing_queue;
CREATE POLICY "marketing_queue_insert_own" ON public.marketing_queue FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_queue_update_own" ON public.marketing_queue;
CREATE POLICY "marketing_queue_update_own" ON public.marketing_queue FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids())) WITH CHECK (business_id = ANY (current_business_ids()));

-- marketing_templates
DROP POLICY IF EXISTS "marketing_templates_select_own" ON public.marketing_templates;
CREATE POLICY "marketing_templates_select_own" ON public.marketing_templates FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_templates_insert_own" ON public.marketing_templates;
CREATE POLICY "marketing_templates_insert_own" ON public.marketing_templates FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_templates_update_own" ON public.marketing_templates;
CREATE POLICY "marketing_templates_update_own" ON public.marketing_templates FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids())) WITH CHECK (business_id = ANY (current_business_ids()));
DROP POLICY IF EXISTS "marketing_templates_delete_own" ON public.marketing_templates;
CREATE POLICY "marketing_templates_delete_own" ON public.marketing_templates FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- marketing_usage_monthly
DROP POLICY IF EXISTS "marketing_usage_monthly_read_own" ON public.marketing_usage_monthly;
CREATE POLICY "marketing_usage_monthly_read_own" ON public.marketing_usage_monthly FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- marketing_automation_steps (join-based via marketing_automations)
DROP POLICY IF EXISTS "marketing_automation_steps_select_own" ON public.marketing_automation_steps;
CREATE POLICY "marketing_automation_steps_select_own" ON public.marketing_automation_steps FOR SELECT TO authenticated
  USING (automation_id IN (SELECT id FROM marketing_automations WHERE business_id = ANY (current_business_ids())));
DROP POLICY IF EXISTS "marketing_automation_steps_insert_own" ON public.marketing_automation_steps;
CREATE POLICY "marketing_automation_steps_insert_own" ON public.marketing_automation_steps FOR INSERT TO authenticated
  WITH CHECK (automation_id IN (SELECT id FROM marketing_automations WHERE business_id = ANY (current_business_ids())));
DROP POLICY IF EXISTS "marketing_automation_steps_update_own" ON public.marketing_automation_steps;
CREATE POLICY "marketing_automation_steps_update_own" ON public.marketing_automation_steps FOR UPDATE TO authenticated
  USING (automation_id IN (SELECT id FROM marketing_automations WHERE business_id = ANY (current_business_ids())));
DROP POLICY IF EXISTS "marketing_automation_steps_delete_own" ON public.marketing_automation_steps;
CREATE POLICY "marketing_automation_steps_delete_own" ON public.marketing_automation_steps FOR DELETE TO authenticated
  USING (automation_id IN (SELECT id FROM marketing_automations WHERE business_id = ANY (current_business_ids())));

-- promotions (had NO authenticated policies)
CREATE POLICY "promotions_auth_select" ON public.promotions FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));
CREATE POLICY "promotions_auth_insert" ON public.promotions FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));
CREATE POLICY "promotions_auth_update" ON public.promotions FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids())) WITH CHECK (business_id = ANY (current_business_ids()));
CREATE POLICY "promotions_auth_delete" ON public.promotions FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));
;
