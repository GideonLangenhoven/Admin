alter table public.vouchers
  add column if not exists payment_url text,
  add column if not exists payment_reminder_sent_at timestamptz;

comment on column public.vouchers.payment_url is
  'Yoco checkout redirect URL, stored at checkout creation. The cron re-sends this as a payment link if the voucher is still PENDING after 15 minutes.';
comment on column public.vouchers.payment_reminder_sent_at is
  'Set when the 15-min unpaid payment-link reminder was sent, so it fires once.';;
