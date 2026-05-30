-- G10 companion — apply only AFTER the booking app is calling confirm_voucher_booking.
--
-- The anon UPDATE policy had WITH CHECK (true), so an anon caller could PATCH a
-- DRAFT/PENDING booking straight to status='PAID' (or 'CONFIRMED') for free — no
-- payment, no voucher. The legitimate full-voucher-cover path now runs through the
-- confirm_voucher_booking SECURITY DEFINER RPC, and real card payments are confirmed
-- by the Yoco/Paysafe webhooks under service_role (RLS-exempt). So anon never needs
-- to set PAID/CONFIRMED itself.
--
-- USING is unchanged: anon may still update its own DRAFT/PENDING rows (customer
-- details, transition to HELD or CANCELLED in the cash flow). We only forbid the
-- new row landing in PAID/CONFIRMED.
DROP POLICY IF EXISTS bookings_anon_update ON public.bookings;
CREATE POLICY bookings_anon_update ON public.bookings
  FOR UPDATE TO anon
  USING (status = ANY (ARRAY['DRAFT'::text, 'PENDING'::text]))
  WITH CHECK (status <> ALL (ARRAY['PAID'::text, 'CONFIRMED'::text]));
