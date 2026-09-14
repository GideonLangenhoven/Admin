-- Scale hardening: stop RLS re-evaluating per row, and give the tenant filter
-- an index to stand on.
--
-- Neither change alters who can see what. Every policy below keeps its exact
-- predicate; the only difference is that a per-request value is now computed
-- once per query instead of once per row. `auth.role()` and `bt_request_header`
-- are both STABLE, so wrapping them in a scalar subquery forces Postgres to
-- evaluate them as an InitPlan. That is the documented Supabase fix for the
-- auth_rls_initplan advisor.
--
-- Invisible at 172 bookings. At 4M rows a seq scan that also calls a function
-- per row is the difference between a page load and a timeout.

BEGIN;

-- ── 1. RLS: hoist per-request values out of the row loop ────────────────────

-- 13 service-role gates, all the same shape.
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

-- Two of them also carry a WITH CHECK, which has the same problem on writes.
ALTER POLICY idempotency_keys_service_only ON public.idempotency_keys
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');
ALTER POLICY pending_reschedules_service ON public.pending_reschedules
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- Super-admin lookup: the auth.uid() inside the EXISTS was re-run per row.
ALTER POLICY tenant_health_superadmin_select ON public.tenant_health
  USING (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid()) AND au.role = 'SUPER_ADMIN'
  ));

-- The one that matters most, because bookings is the table that grows to
-- millions of rows: three per-request header reads, each previously evaluated
-- for every row scanned.
ALTER POLICY bookings_anon_select ON public.bookings
  USING (
    COALESCE((SELECT current_setting('request.method', true)), '') = ANY (ARRAY['POST', 'PATCH'])
    OR (SELECT public.bt_request_header('x-booking-success-token')) = (id)::text
    OR (
      (SELECT public.bt_request_header('x-booking-id')) = (id)::text
      AND (SELECT public.bt_request_header('x-booking-waiver-token')) = (waiver_token)::text
    )
  );

-- llm_usage was the single policy in the whole schema still using the bare
-- `= ANY (current_business_ids())` form — my own, added yesterday, copied from
-- an older migration instead of the hoisted form the other 165 policies use.
-- It is also the fastest-growing table (one row per model call), so it was the
-- worst possible place to get this wrong.
ALTER POLICY llm_usage_auth_select ON public.llm_usage
  USING (business_id IN (SELECT unnest((SELECT public.current_business_ids()))));

-- The anon storefront read path. The advisor never flagged these — it only
-- looks for auth.*() and current_setting() — but bt_request_header is the same
-- class of problem, and these are the policies every visitor to every booking
-- site goes through. slots in particular grows to millions of rows (one per
-- tour per departure per tenant).
ALTER POLICY add_ons_anon_select ON public.add_ons
  USING (active = true AND (business_id)::text = NULLIF((SELECT public.bt_request_header('x-tenant-business-id')), ''));

ALTER POLICY businesses_anon_select ON public.businesses
  USING (
    (id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
    OR subdomain = (SELECT public.bt_request_header('x-tenant-subdomain'))
    OR regexp_replace(COALESCE(booking_site_url, ''), '/+$', '') = regexp_replace(
         COALESCE(NULLIF((SELECT public.bt_request_header('origin')), ''), (SELECT public.bt_request_header('x-tenant-origin'))), '/+$', '')
  );

ALTER POLICY promotions_anon_select ON public.promotions
  USING ((business_id)::text = NULLIF((SELECT public.bt_request_header('x-tenant-business-id')), ''));

ALTER POLICY slots_anon_select ON public.slots
  USING (
    (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
    AND status = 'OPEN'
    AND start_time > (now() - '7 days'::interval)
  );

ALTER POLICY tours_anon_select ON public.tours
  USING (
    (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
    AND active = true
    AND COALESCE(hidden, false) = false
  );

ALTER POLICY vouchers_anon_insert ON public.vouchers
  WITH CHECK (
    status = 'PENDING'
    AND (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
  );

ALTER POLICY vouchers_anon_select ON public.vouchers
  USING (
    upper(regexp_replace(code, '\s+', '', 'g')) = upper(regexp_replace((SELECT public.bt_request_header('x-voucher-code')), '\s+', '', 'g'))
    AND (SELECT public.bt_request_header('x-voucher-code')) <> ''
    AND (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
  );

-- ── 2. Indexes: give the tenant filter something to use ────────────────────
--
-- bookings carried 14 indexes and not one of them served `WHERE business_id
-- = ?`, which is the shape of nearly every query the application makes. At 172
-- rows Postgres seq-scans regardless and nobody notices. At 4M rows every
-- tenant-scoped read scans every other tenant's rows to find its own.
--
-- Composite rather than bare business_id: a leading-column index serves the
-- bare filter too, so (business_id, status) covers both `business_id = ?` and
-- `business_id = ? AND status IN (...)` without a second index.
--
-- Plain CREATE INDEX, not CONCURRENTLY: these tables are small today so the
-- ACCESS EXCLUSIVE lock is sub-millisecond, and CONCURRENTLY cannot run inside
-- a transaction. Anything added once these tables are large must use
-- CONCURRENTLY outside a migration transaction.
CREATE INDEX IF NOT EXISTS idx_bookings_business_status   ON public.bookings (business_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_business_slot     ON public.bookings (business_id, slot_id);
CREATE INDEX IF NOT EXISTS idx_logs_business_created      ON public.logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_messages_business     ON public.auto_messages (business_id);
CREATE INDEX IF NOT EXISTS idx_outbox_business_status     ON public.outbox (business_id, status);

-- ── 3. Duplicate indexes ────────────────────────────────────────────────────
--
-- Provably redundant: an identical index already exists on each of these, so
-- dropping one changes no query plan and no constraint. This is the only
-- index-removal in this migration that is safe to make from the advisor alone
-- — see the note below about "unused" indexes.
DROP INDEX IF EXISTS public.idx_marketing_queue_campaign_id;

-- These two pairs are both constraint-backed, so the constraint goes rather
-- than the index. The surviving constraint enforces exactly the same rule.
ALTER TABLE public.slots    DROP CONSTRAINT IF EXISTS slots_business_tour_start_unique;
ALTER TABLE public.vouchers DROP CONSTRAINT IF EXISTS vouchers_code_unique;

-- Deliberately NOT dropping the 34 indexes the advisor reports as unused.
-- "Unused" there means idx_scan = 0, and with 172 bookings Postgres prefers a
-- seq scan over any index, so almost everything looks unused. That statistic
-- measures the size of the dataset, not the value of the index. Revisit once
-- these tables are large enough for the planner to have made real choices.

COMMIT;
