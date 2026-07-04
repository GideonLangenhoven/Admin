-- Two confirmed cross-tenant RLS holes found in the 2000-tenant readiness audit.
--
-- P0 — bookings_anon_insert had WITH CHECK (true). The booking client only ever
-- inserts status='DRAFT' (booking/app/book/page.tsx), and the ck_before_booking_paid_status
-- trigger's only guard on a PAID row is the monthly quota check
-- (ck_assert_paid_booking_allowed) — it does NOT verify payment. So an anon caller
-- with the public anon key could INSERT status='PAID', total>0, business_id=<any
-- tenant> and, while that tenant is under quota, create a free confirmed booking
-- that lands in their manifest/reports and burns their billing quota. Payment is
-- meant to be confirmed only by webhooks under service_role.
-- Fix: constrain the anon INSERT to the non-paid statuses the real flow uses.
-- (Deliberately not adding a tenant-header predicate here: the insert client's
-- header presence isn't guaranteed and a bad predicate would break all bookings.
-- A DRAFT/PENDING row burns no quota and is reaped by cron; tenant-scoping the
-- anon insert is a follow-up once header propagation is confirmed.)

DROP POLICY IF EXISTS bookings_anon_insert ON public.bookings;
CREATE POLICY bookings_anon_insert ON public.bookings
  FOR INSERT TO anon
  WITH CHECK (status IN ('DRAFT', 'PENDING'));

-- P1 — combo_bookings had SELECT policy "Anyone can read combo_bookings"
-- (FOR SELECT TO public USING (true)) while anon holds the table SELECT grant, so
-- any anonymous client could page every tenant's combo bookings including
-- customer_name / customer_email / customer_phone and payment IDs (POPIA breach).
-- Every legitimate reader of combo_bookings is service_role (paysafe-webhook,
-- create-paysafe-checkout) or a service_role API route (combo-settlements,
-- combo-cancel) — all of which bypass RLS. No anon/authenticated browser path
-- reads this table, so removing the public read policy closes the leak with no
-- functional impact (default-deny for anon/authenticated; service_role unaffected).

DROP POLICY IF EXISTS "Anyone can read combo_bookings" ON public.combo_bookings;
