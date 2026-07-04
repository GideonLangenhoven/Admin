-- P1 billing-integrity — subscriptions self-elevation.
-- All subscription mutations flow through /api/billing/* routes using the
-- service_role key (pause/resume/seats/subscription/history). No browser/client
-- page writes public.subscriptions directly. Yet authenticated tenants held
-- INSERT/UPDATE/DELETE RLS on their own row (business_id = ANY(current_business_ids())),
-- so a suspended tenant could bypass the billing routes and the S4 suspension
-- gate by calling PostgREST directly:
--   PATCH /rest/v1/subscriptions?id=eq.<own> {status:'ACTIVE'}
-- flipping themselves back to ACTIVE, bumping seats_purchased, or zeroing overage.
--
-- Drop the tenant write policies; keep SELECT so the billing UI can still read
-- its own plan/seat/status. service_role (the billing routes) bypasses RLS, so
-- legitimate billing operations are unaffected.

DROP POLICY IF EXISTS subscriptions_tenant_insert ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_tenant_update ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_tenant_delete ON public.subscriptions;
