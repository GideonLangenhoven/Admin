alter table public.topup_orders
  add column if not exists yoco_payment_id text,
  add column if not exists yoco_checkout_id text;

create unique index if not exists topup_orders_yoco_payment_id_uidx
  on public.topup_orders (yoco_payment_id)
  where yoco_payment_id is not null;

create unique index if not exists topup_orders_yoco_checkout_id_uidx
  on public.topup_orders (yoco_checkout_id)
  where yoco_checkout_id is not null;
