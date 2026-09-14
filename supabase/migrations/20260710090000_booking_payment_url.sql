-- Store the Yoco checkout redirect URL on the booking so the cron hold-expiry
-- sweep can email the SAME payment link when a checkout is abandoned (15-min
-- hold lapses unpaid). Reusing the original checkout keeps its voucher/promo
-- metadata intact — creating a fresh checkout at cron time would drop them.
-- The immediate payment-link email/WhatsApp at checkout time is gone: the
-- customer is already on the payment page at that moment.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_url text;
