-- Add columns referenced by edge functions but missing from schema.
-- send-email queries businesses.notification_email (lines 179, 190, 216);
-- create-checkout / rebook-booking read bookings.voucher_amount_paid
-- (create-checkout/index.ts:101, 163; rebook-booking/index.ts:490).
-- Without these columns the SELECTs fail and the functions return 500,
-- so paid bookings never receive their confirmation emails.

alter table public.businesses
  add column if not exists notification_email text;

comment on column public.businesses.notification_email is
  'Tenant reply-to address for customer-facing transactional emails. '
  'When set, customer replies to confirmation/cancellation emails go here '
  'instead of the platform default.';

alter table public.bookings
  add column if not exists voucher_amount_paid numeric(12, 2) not null default 0;

comment on column public.bookings.voucher_amount_paid is
  'Portion of total_amount covered by gift vouchers applied to this booking. '
  'Zero when no voucher was used. Used by create-checkout to compute the '
  'remaining card-payable balance.';
