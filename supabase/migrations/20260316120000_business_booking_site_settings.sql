ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS booking_site_url text,
  ADD COLUMN IF NOT EXISTS manage_bookings_url text,
  ADD COLUMN IF NOT EXISTS gift_voucher_url text,
  ADD COLUMN IF NOT EXISTS booking_success_url text,
  ADD COLUMN IF NOT EXISTS booking_cancel_url text,
  ADD COLUMN IF NOT EXISTS voucher_success_url text,
  ADD COLUMN IF NOT EXISTS nav_gift_voucher_label text,
  ADD COLUMN IF NOT EXISTS nav_my_bookings_label text,
  ADD COLUMN IF NOT EXISTS card_cta_label text,
  ADD COLUMN IF NOT EXISTS chat_widget_label text,
  ADD COLUMN IF NOT EXISTS footer_line_one text,
  ADD COLUMN IF NOT EXISTS footer_line_two text;
