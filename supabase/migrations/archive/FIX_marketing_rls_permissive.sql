CREATE POLICY "Allow all operations for marketing_contacts" ON public.marketing_contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_templates" ON public.marketing_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_campaigns" ON public.marketing_campaigns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_queue" ON public.marketing_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_events" ON public.marketing_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_unsubscribe_tokens" ON public.marketing_unsubscribe_tokens FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_usage_monthly" ON public.marketing_usage_monthly FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_automations" ON public.marketing_automations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_automation_steps" ON public.marketing_automation_steps FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_automation_enrollments" ON public.marketing_automation_enrollments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for marketing_automation_logs" ON public.marketing_automation_logs FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
