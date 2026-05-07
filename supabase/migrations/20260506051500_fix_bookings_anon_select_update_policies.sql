-- Anon SELECT: needed for .insert(...).select() read-back and waiver token fetch
CREATE POLICY bookings_anon_select ON public.bookings
  FOR SELECT TO anon USING (true);

-- Grant UPDATE to anon (missing — only INSERT and SELECT were granted)
GRANT UPDATE ON public.bookings TO anon;

-- Anon UPDATE: draft->pending upgrade, voucher->PAID flow
-- Scoped to DRAFT/PENDING rows only — once confirmed/paid by webhook, anon can't modify
CREATE POLICY bookings_anon_update ON public.bookings
  FOR UPDATE TO anon
  USING (status IN ('DRAFT', 'PENDING'))
  WITH CHECK (true);

-- Vouchers: anon needs UPDATE for redeemed_booking_id linking during voucher checkout
GRANT UPDATE ON public.vouchers TO anon;

CREATE POLICY vouchers_anon_update ON public.vouchers
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
