-- S3: remove table grants that anon/authenticated never use.
--
-- RLS already denies every revoked privilege below, so no behaviour changes today. The point is
-- defence in depth: with these grants in place, one permissive policy added by mistake would expose
-- the table. Every revoke is one of:
--   (a) a privilege no API role can use (TRUNCATE ignores RLS; REFERENCES/TRIGGER matter only to owners), or
--   (b) a privilege the role holds on a table where NO permissive policy covers that role + command
--       (derived from pg_policies on 2026-10-29), and no INVOKER function, policy sub-query, view or
--       CHECK constraint reads the table as that role.
-- Deliberately NOT revoked (see supabase/grant-allowlist.json for the full allowed set):
--   * anon SELECT on customers: policy bookings_read sub-queries it, so anon needs the privilege (RLS returns 0 rows).
--   * anon INSERT/UPDATE on bookings, INSERT on vouchers/booking_add_ons, SELECT on storefront tables: storefront flows.
--   * function EXECUTE: triggers, policies and CHECK constraints call functions as the caller, so
--     revoking needs a dependency pass of its own. The allowlist records the current set so it cannot grow.

-- (a) Nothing reachable through PostgREST needs these, on any table or view.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- (b) anon: tables the storefront never reads or writes.
REVOKE ALL ON TABLE
  public.chat_faq_entries,
  public.chatbot_avatars,
  public.combo_bookings,
  public.combo_booking_items,
  public.data_subject_requests,
  public.marketing_automation_revisions,
  public.marketing_deliveries,
  public.marketing_journey_status_events,
  public.marketing_permission_events,
  public.otp_attempts,
  public.pii_anonymization_log,
  public.promotion_uses,
  public.tenant_health
FROM anon;

-- (b) anon: read-only tables and views (customers keeps SELECT, see above).
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.customers,
  public.platform_public_settings,
  public.reviews,
  public.tour_review_stats
FROM anon;

-- (b) authenticated: views are read-only.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.tour_review_stats, public.marketing_eligible_contacts FROM authenticated;

-- (b) authenticated: no permissive policy for the command.
REVOKE INSERT ON TABLE
  public.admin_users, public.combo_booking_items, public.combo_bookings, public.combo_offer_items, public.combo_offers,
  public.data_subject_requests, public.holds, public.marketing_automation_revisions, public.marketing_deliveries,
  public.marketing_journey_status_events, public.marketing_permission_events, public.messages, public.otp_attempts,
  public.pii_anonymization_log, public.promotion_uses, public.referral_uses, public.reviews, public.subscriptions,
  public.tenant_health
FROM authenticated;

REVOKE UPDATE ON TABLE
  public.combo_booking_items, public.combo_bookings, public.combo_offer_items, public.combo_offers,
  public.data_subject_requests, public.marketing_automation_logs, public.marketing_automation_revisions,
  public.marketing_deliveries, public.marketing_journey_status_events, public.marketing_permission_events,
  public.messages, public.otp_attempts, public.pii_anonymization_log, public.promotion_uses, public.referral_uses,
  public.subscriptions, public.tenant_health
FROM authenticated;

REVOKE DELETE ON TABLE
  public.admin_users, public.combo_booking_items, public.combo_bookings, public.combo_offer_items, public.combo_offers,
  public.data_subject_requests, public.marketing_automation_logs, public.marketing_automation_revisions,
  public.marketing_deliveries, public.marketing_journey_status_events, public.marketing_permission_events,
  public.messages, public.otp_attempts, public.pii_anonymization_log, public.promotion_uses, public.referral_uses,
  public.reviews, public.subscriptions, public.tenant_health
FROM authenticated;

REVOKE SELECT ON TABLE
  public.combo_booking_items, public.combo_bookings, public.otp_attempts, public.promotion_uses
FROM authenticated;
