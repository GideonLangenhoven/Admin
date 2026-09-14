-- S1 (stress-test finding): chat_intent_daily is an analytics view over
-- chat_messages grouped by business_id. anon + authenticated held SELECT (plus
-- blanket ALL grants), and the view ran with definer rights, bypassing
-- chat_messages RLS -> any anon could read every tenant's message volumes,
-- intent mix and bot auto-reply rates. No app code reads this view; it is
-- dashboard-only (service_role, RLS-exempt).
--
-- Fix: run the view with the caller's rights (RLS applies), and remove every
-- anon/authenticated grant. service_role keeps access for dashboard analytics.

BEGIN;

ALTER VIEW public.chat_intent_daily SET (security_invoker = on);

REVOKE ALL ON public.chat_intent_daily FROM anon;
REVOKE ALL ON public.chat_intent_daily FROM authenticated;

COMMIT;
