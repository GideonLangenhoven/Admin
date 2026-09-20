ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS allow_unpaid boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.bookings.allow_unpaid IS
  'Admin override: let this booking proceed without payment — the payment-reminder flow skips both the reminder and the auto-cancel for it.';;
