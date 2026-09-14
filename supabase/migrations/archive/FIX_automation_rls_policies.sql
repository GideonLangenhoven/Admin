DROP POLICY IF EXISTS marketing_automations_service ON public.marketing_automations;
DROP POLICY IF EXISTS marketing_automations_select_own ON public.marketing_automations;
DROP POLICY IF EXISTS marketing_automations_insert_own ON public.marketing_automations;
DROP POLICY IF EXISTS marketing_automations_update_own ON public.marketing_automations;
DROP POLICY IF EXISTS marketing_automations_delete_own ON public.marketing_automations;

CREATE POLICY marketing_automations_service ON public.marketing_automations
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY marketing_automations_select_own ON public.marketing_automations
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));
CREATE POLICY marketing_automations_insert_own ON public.marketing_automations
  FOR INSERT WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));
CREATE POLICY marketing_automations_update_own ON public.marketing_automations
  FOR UPDATE USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));
CREATE POLICY marketing_automations_delete_own ON public.marketing_automations
  FOR DELETE USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

DROP POLICY IF EXISTS marketing_automation_steps_service ON public.marketing_automation_steps;
DROP POLICY IF EXISTS marketing_automation_steps_select_own ON public.marketing_automation_steps;
DROP POLICY IF EXISTS marketing_automation_steps_insert_own ON public.marketing_automation_steps;
DROP POLICY IF EXISTS marketing_automation_steps_update_own ON public.marketing_automation_steps;
DROP POLICY IF EXISTS marketing_automation_steps_delete_own ON public.marketing_automation_steps;

CREATE POLICY marketing_automation_steps_service ON public.marketing_automation_steps
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY marketing_automation_steps_select_own ON public.marketing_automation_steps
  FOR SELECT USING (automation_id IN (SELECT id FROM public.marketing_automations WHERE business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid())));
CREATE POLICY marketing_automation_steps_insert_own ON public.marketing_automation_steps
  FOR INSERT WITH CHECK (automation_id IN (SELECT id FROM public.marketing_automations WHERE business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid())));
CREATE POLICY marketing_automation_steps_update_own ON public.marketing_automation_steps
  FOR UPDATE USING (automation_id IN (SELECT id FROM public.marketing_automations WHERE business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid())));
CREATE POLICY marketing_automation_steps_delete_own ON public.marketing_automation_steps
  FOR DELETE USING (automation_id IN (SELECT id FROM public.marketing_automations WHERE business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid())));

DROP POLICY IF EXISTS marketing_automation_enrollments_service ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS marketing_automation_enrollments_select_own ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS marketing_automation_enrollments_insert_own ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS marketing_automation_enrollments_update_own ON public.marketing_automation_enrollments;
DROP POLICY IF EXISTS marketing_automation_enrollments_delete_own ON public.marketing_automation_enrollments;

CREATE POLICY marketing_automation_enrollments_service ON public.marketing_automation_enrollments
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY marketing_automation_enrollments_select_own ON public.marketing_automation_enrollments
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));
CREATE POLICY marketing_automation_enrollments_insert_own ON public.marketing_automation_enrollments
  FOR INSERT WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));
CREATE POLICY marketing_automation_enrollments_update_own ON public.marketing_automation_enrollments
  FOR UPDATE USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));
CREATE POLICY marketing_automation_enrollments_delete_own ON public.marketing_automation_enrollments
  FOR DELETE USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

DROP POLICY IF EXISTS marketing_automation_logs_service ON public.marketing_automation_logs;
DROP POLICY IF EXISTS marketing_automation_logs_select_own ON public.marketing_automation_logs;
DROP POLICY IF EXISTS marketing_automation_logs_insert_own ON public.marketing_automation_logs;

CREATE POLICY marketing_automation_logs_service ON public.marketing_automation_logs
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY marketing_automation_logs_select_own ON public.marketing_automation_logs
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));
CREATE POLICY marketing_automation_logs_insert_own ON public.marketing_automation_logs
  FOR INSERT WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

GRANT ALL ON public.marketing_automations TO authenticated;
GRANT ALL ON public.marketing_automation_steps TO authenticated;
GRANT ALL ON public.marketing_automation_enrollments TO authenticated;
GRANT ALL ON public.marketing_automation_logs TO authenticated;
