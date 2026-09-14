-- Extend storefront anon policies to the authenticated role (belt-and-braces).
--
-- Incident 2026-07-06: the *_anon_* policies were scoped to the anon role only.
-- Visitors carrying a persisted /my-bookings auth session sent an authenticated
-- JWT from the booking storefront, so none of these policies applied — every
-- public read returned zero rows and checkout inserts were rejected, leaving
-- the storefront stuck on loading skeletons (silent failure: PostgREST returns
-- 200 + empty set, supabase-js returns {data:null} without throwing).
--
-- The app-side fix (booking commit 37e342c) pins storefront clients to the anon
-- key via persistSession:false. This migration removes the remaining foot-gun at
-- the source: the policies' USING/WITH CHECK expressions (tenant headers, booking
-- tokens, voucher codes) are the real guard — restricting them to the anon ROLE
-- added no security, because any authenticated user can simply drop their token
-- and query as anon. Extending to authenticated is therefore NOT a widening; it
-- makes public storefront access role-agnostic so no future client that happens
-- to carry a session can regress the storefront.
--
-- ALTER POLICY ... TO keeps the existing USING/WITH CHECK expressions unchanged.

ALTER POLICY add_ons_anon_select            ON public.add_ons             TO anon, authenticated;
ALTER POLICY booking_add_ons_anon_insert    ON public.booking_add_ons     TO anon, authenticated;
ALTER POLICY booking_add_ons_anon_select    ON public.booking_add_ons     TO anon, authenticated;
ALTER POLICY bookings_anon_insert           ON public.bookings            TO anon, authenticated;
ALTER POLICY bookings_anon_select           ON public.bookings            TO anon, authenticated;
ALTER POLICY bookings_anon_update           ON public.bookings            TO anon, authenticated;
ALTER POLICY businesses_anon_select         ON public.businesses          TO anon, authenticated;
ALTER POLICY combo_booking_items_anon_insert ON public.combo_booking_items TO anon, authenticated;
ALTER POLICY combo_bookings_anon_insert     ON public.combo_bookings      TO anon, authenticated;
ALTER POLICY combo_offer_items_anon_select  ON public.combo_offer_items   TO anon, authenticated;
ALTER POLICY combo_offers_anon_select       ON public.combo_offers        TO anon, authenticated;
ALTER POLICY plans_anon_select              ON public.plans               TO anon, authenticated;
ALTER POLICY promotion_uses_anon_insert     ON public.promotion_uses      TO anon, authenticated;
ALTER POLICY promotions_anon_select         ON public.promotions          TO anon, authenticated;
ALTER POLICY reviews_anon_read              ON public.reviews             TO anon, authenticated;
ALTER POLICY slots_anon_select              ON public.slots               TO anon, authenticated;
ALTER POLICY tours_anon_select              ON public.tours               TO anon, authenticated;
ALTER POLICY vouchers_anon_insert           ON public.vouchers            TO anon, authenticated;
ALTER POLICY vouchers_anon_select           ON public.vouchers            TO anon, authenticated;
