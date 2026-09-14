BEGIN;
-- Reservations are accessed only by server-side payment transactions.
-- Keep both permissions and row policies closed to browser sessions.
REVOKE ALL ON public.voucher_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.voucher_reservations TO service_role;
COMMIT;
