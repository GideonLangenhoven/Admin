-- Gift-voucher payment flow now mirrors normal bookings: no "please pay" email
-- at checkout creation. The Yoco redirect URL is persisted on the voucher, and
-- the cron sends the payment link ONLY if the voucher is still PENDING 15 min
-- later (payment failed / abandoned). payment_reminder_sent_at guards against
-- sending it more than once.
alter table public.vouchers
  add column if not exists payment_url text,
  add column if not exists payment_reminder_sent_at timestamptz;

comment on column public.vouchers.payment_url is
  'Yoco checkout redirect URL, stored at checkout creation. The cron re-sends '
  'this as a payment link if the voucher is still PENDING after 15 minutes.';
comment on column public.vouchers.payment_reminder_sent_at is
  'Set when the 15-min unpaid payment-link reminder was sent, so it fires once.';
