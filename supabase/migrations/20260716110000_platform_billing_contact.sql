-- Platform invoices (BookingTours → operator) were emailed to EVERY admin on
-- the business. Billing should go to one person: the first admin account ever
-- created on the business, unless the operator explicitly picks a different
-- billing contact (Settings → Admins).
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS billing_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL;
