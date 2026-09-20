
DROP POLICY IF EXISTS "Allow all operations for marketing_automations" ON public.marketing_automations;
DROP POLICY IF EXISTS "Allow all operations for marketing_automation_enrollments" ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS "Allow all operations for marketing_automation_logs" ON public.marketing_automation_logs;
DROP POLICY IF EXISTS "Allow all operations for marketing_automation_steps" ON public.marketing_automation_steps;
DROP POLICY IF EXISTS "Allow all operations for marketing_campaigns" ON public.marketing_campaigns;
DROP POLICY IF EXISTS "Allow all operations for marketing_events" ON public.marketing_events;
DROP POLICY IF EXISTS "Allow all operations for marketing_queue" ON public.marketing_queue;
DROP POLICY IF EXISTS "Allow all operations for marketing_templates" ON public.marketing_templates;
DROP POLICY IF EXISTS "Allow all operations for marketing_unsubscribe_tokens" ON public.marketing_unsubscribe_tokens;
DROP POLICY IF EXISTS "Allow all operations for marketing_usage_monthly" ON public.marketing_usage_monthly;

DROP POLICY IF EXISTS "Anyone can read active add_ons" ON public.add_ons;
DROP POLICY IF EXISTS "webchat_sessions_anon_all" ON public.webchat_sessions;

CREATE POLICY "add_ons_auth_select"
  ON public.add_ons FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

CREATE POLICY "add_ons_auth_insert"
  ON public.add_ons FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

CREATE POLICY "add_ons_auth_update"
  ON public.add_ons FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids()))
  WITH CHECK (business_id = ANY (current_business_ids()));

CREATE POLICY "add_ons_auth_delete"
  ON public.add_ons FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));
;
