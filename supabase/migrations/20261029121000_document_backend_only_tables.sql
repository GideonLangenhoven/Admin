-- S7: tables with RLS enabled and no policy deny everything to anon and authenticated. That is intended for
-- these tables: they are backend-only (service_role). The comment records the decision so the next reviewer
-- (and the Supabase advisor, which flags policy-less tables) can see it was deliberate.
-- If an admin screen ever needs to read one, add a narrowly scoped read policy or a server function; do not add a broad grant.
-- ngt_intake_submissions and ngt_payments are already documented. combo_settlements is not here: it has a
-- party-scoped read policy (20261029120000_combo_settlements_party_read.sql).

COMMENT ON TABLE public.admin_kb_chunks IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.admin_web_push_subscriptions IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.api_rate_limits IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.business_partnerships IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.client_release_checks IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.combo_booking_items IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.combo_bookings IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.guide_photo_uploads IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.ingress_rate_limits IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.invite_tokens IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.kb_chunks IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.mfa_recovery_state IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.notification_jobs IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.operator_dashboard_layouts IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.ota_runtime_boundary IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.platform_invoices IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.platform_settings IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.processed_wa_messages IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.promotion_uses IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.refund_batches IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.refund_operations IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.tenant_invoice_sequences IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
COMMENT ON TABLE public.wa_messages IS 'Backend-only: RLS is enabled with no policies by design, so anon and authenticated have no access. Read and written by edge functions and server routes using the service role.';
