-- Per-business sender email for Resend
-- e.g. "bookings@capekayak.co.za" or "hello@atlanticskydive.co.za"
-- Must be a verified domain in your Resend account
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS from_email text;
