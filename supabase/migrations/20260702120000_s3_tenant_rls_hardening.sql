-- S3 — tenant-isolation RLS hardening (CODE_AUDIT_2026-07-02 + voucher money holes)
--
-- 1. reviews: the authenticated SELECT/UPDATE policies used USING (true), so any
--    logged-in admin of ANY tenant could read and modify (approve/hide/edit)
--    every other tenant's reviews. Scope both to the caller's own tenant(s)
--    via current_business_ids() — the same predicate invoices/vouchers_tenant_*
--    already use. SUPER_ADMIN keeps platform-wide access (current_business_ids()
--    returns all business ids for super-admins).
--
-- 2. vouchers_anon_insert: WITH CHECK (true) let an anonymous caller insert a
--    voucher row with status='ACTIVE' and an arbitrary current_balance —
--    fabricating spendable credit without ever paying. The gift-voucher
--    purchase flow only ever inserts status='PENDING' (the yoco-webhook, running
--    as service_role, flips it to ACTIVE after a confirmed payment), so force
--    PENDING at the RLS layer. Admin comp-vouchers use the authenticated
--    vouchers_tenant_insert policy and are unaffected.
--
-- 3. vouchers_anon_update: USING (true) WITH CHECK (true) let an anonymous caller
--    rewrite ANY voucher (balance, status, business_id). No booking-site flow
--    updates vouchers as anon — redemption/deduction runs in the yoco-webhook as
--    service_role — so drop the policy entirely.

BEGIN;

-- 1. reviews -----------------------------------------------------------------
DROP POLICY IF EXISTS reviews_authenticated_read ON public.reviews;
CREATE POLICY reviews_authenticated_read ON public.reviews
  FOR SELECT TO authenticated
  USING (business_id = ANY (public.current_business_ids()));

DROP POLICY IF EXISTS reviews_authenticated_update ON public.reviews;
CREATE POLICY reviews_authenticated_update ON public.reviews
  FOR UPDATE TO authenticated
  USING (business_id = ANY (public.current_business_ids()))
  WITH CHECK (business_id = ANY (public.current_business_ids()));

-- 2. vouchers anon insert — may only create PENDING (unspendable) vouchers -----
DROP POLICY IF EXISTS vouchers_anon_insert ON public.vouchers;
CREATE POLICY vouchers_anon_insert ON public.vouchers
  FOR INSERT TO anon
  WITH CHECK (
    status = 'PENDING'
    AND business_id::text = public.bt_request_header('x-tenant-business-id')
  );

-- 3. vouchers anon update — no legitimate anon voucher mutation exists ---------
DROP POLICY IF EXISTS vouchers_anon_update ON public.vouchers;

COMMIT;
