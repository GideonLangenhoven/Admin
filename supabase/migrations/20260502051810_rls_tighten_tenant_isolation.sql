-- RLS Audit: tighten tenant isolation on CRITICAL and HIGH findings.
-- Drops "Allow all operations" USING(true) policies that defeat proper tenant-scoped policies.
-- All affected tables already have correct business_id-scoped policies underneath.
--
-- Deferred to Prompt 9: booking_add_ons, combo_bookings, combo_offers, combo_offer_items,
--   combo_booking_items, promotions (anon SELECT), messages, referral_uses, idempotency_keys,
--   businesses (anon SELECT for tenant resolution).

BEGIN;

-- ============================================================
-- 1. CRITICAL: Drop USING(true) "Allow all operations" policies
--    on marketing tables (10 tables). Each has proper tenant-scoped
--    policies that will take effect once the override is removed.
-- ============================================================

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

-- ============================================================
-- 2. CRITICAL: Drop USING(true) on add_ons (public can read all)
--    and webchat_sessions (anon can read/write all).
--    webchat_sessions already has tenant-scoped auth policy.
--    add_ons needs new authenticated CRUD policies (added below).
-- ============================================================

DROP POLICY IF EXISTS "Anyone can read active add_ons" ON public.add_ons;
DROP POLICY IF EXISTS "webchat_sessions_anon_all" ON public.webchat_sessions;

-- ============================================================
-- 3. HIGH: Add tenant-scoped CRUD policies for add_ons
--    (had no authenticated policies at all — only anon SELECT).
-- ============================================================

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

COMMIT;
