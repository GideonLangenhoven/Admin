-- Add per-business email header image columns to businesses table.
-- Each column stores a URL for the header image shown in that email type.
-- When NULL the edge function falls back to the hardcoded default image.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS email_img_payment       text,  -- Payment Link email
  ADD COLUMN IF NOT EXISTS email_img_confirm       text,  -- Booking Confirmation email
  ADD COLUMN IF NOT EXISTS email_img_invoice       text,  -- Invoice email
  ADD COLUMN IF NOT EXISTS email_img_gift          text,  -- Gift Voucher email
  ADD COLUMN IF NOT EXISTS email_img_cancel        text,  -- Cancellation (general) email
  ADD COLUMN IF NOT EXISTS email_img_cancel_weather text, -- Cancellation (weather) email
  ADD COLUMN IF NOT EXISTS email_img_indemnity     text,  -- Waiver / Indemnity Reminder email
  ADD COLUMN IF NOT EXISTS email_img_admin         text,  -- Admin Welcome email
  ADD COLUMN IF NOT EXISTS email_img_voucher       text,  -- Voucher Code email
  ADD COLUMN IF NOT EXISTS email_img_photos        text;  -- Trip Photos email
