GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_contacts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_campaigns TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_queue TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_unsubscribe_tokens TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_usage_monthly TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_automations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_automation_steps TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_automation_enrollments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_automation_logs TO anon;
