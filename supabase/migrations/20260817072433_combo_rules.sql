alter table public.combo_offers
  add column if not exists cancellation_policy text not null default 'VOUCHER_ONLY';

alter table public.combo_offers
  drop constraint if exists combo_offers_cancellation_policy_check;
alter table public.combo_offers
  add constraint combo_offers_cancellation_policy_check
  check (cancellation_policy in ('VOUCHER_ONLY', 'NO_CANCEL', 'POLICY_REFUND'));

alter table public.combo_offers
  add column if not exists combo_rules jsonb not null default '{}';

comment on column public.combo_offers.combo_rules is
  'Offer-level booking rules: {min_gap_days, max_gap_days, enforce_order}. Enforced in create-paysafe-checkout and rebook-booking; the storefront mirrors them for UX only.';

alter table public.combo_settlements
  drop constraint if exists combo_settlements_status_check;
alter table public.combo_settlements
  add constraint combo_settlements_status_check
  check (status in ('PENDING', 'PENDING_PAYMENT', 'PAID', 'SETTLED', 'SUPERSEDED', 'FAILED', 'DISPUTED'));;
