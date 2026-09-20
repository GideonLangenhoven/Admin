ALTER POLICY audit_logs_service_insert          ON public.audit_logs                  USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY chat_messages_service_all          ON public.chat_messages               USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY marketing_automation_steps_service ON public.marketing_automation_steps  USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY marketing_automations_service      ON public.marketing_automations       USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY marketing_campaigns_service        ON public.marketing_campaigns         USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY marketing_contacts_service         ON public.marketing_contacts          USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY marketing_events_service           ON public.marketing_events            USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY marketing_queue_service            ON public.marketing_queue             USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY marketing_templates_service        ON public.marketing_templates         USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY marketing_usage_monthly_service    ON public.marketing_usage_monthly     USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY plans_modify_service               ON public.plans                       USING ((SELECT auth.role()) = 'service_role');
ALTER POLICY unsub_tokens_service               ON public.marketing_unsubscribe_tokens USING ((SELECT auth.role()) = 'service_role');

ALTER POLICY idempotency_keys_service_only ON public.idempotency_keys
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');
ALTER POLICY pending_reschedules_service ON public.pending_reschedules
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

ALTER POLICY tenant_health_superadmin_select ON public.tenant_health
  USING (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid()) AND au.role = 'SUPER_ADMIN'
  ));

ALTER POLICY bookings_anon_select ON public.bookings
  USING (
    COALESCE((SELECT current_setting('request.method', true)), '') = ANY (ARRAY['POST', 'PATCH'])
    OR (SELECT public.bt_request_header('x-booking-success-token')) = (id)::text
    OR (
      (SELECT public.bt_request_header('x-booking-id')) = (id)::text
      AND (SELECT public.bt_request_header('x-booking-waiver-token')) = (waiver_token)::text
    )
  );

ALTER POLICY llm_usage_auth_select ON public.llm_usage
  USING (business_id IN (SELECT unnest((SELECT public.current_business_ids()))));

CREATE INDEX IF NOT EXISTS idx_bookings_business_status   ON public.bookings (business_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_business_slot     ON public.bookings (business_id, slot_id);
CREATE INDEX IF NOT EXISTS idx_logs_business_created      ON public.logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_messages_business     ON public.auto_messages (business_id);
CREATE INDEX IF NOT EXISTS idx_outbox_business_status     ON public.outbox (business_id, status);

DROP INDEX IF EXISTS public.idx_marketing_queue_campaign_id;
ALTER TABLE public.slots    DROP CONSTRAINT IF EXISTS slots_business_tour_start_unique;
ALTER TABLE public.vouchers DROP CONSTRAINT IF EXISTS vouchers_code_unique;;
