-- Operator-set rules for combo offers, plus two constraint fixes.
--
-- NOTE: the combo tables in prod are ahead of the checked-in migrations
-- (combo_offer_items, combo_booking_items, combo_settlements and several
-- columns were applied out-of-band). Everything here is expand-only against
-- the LIVE schema; IF NOT EXISTS documents columns that may already exist.

-- 1. Per-offer rules.
--    cancellation_policy already exists live (default VOUCHER_ONLY) but is
--    enforced by nothing; this adds the third value and the code starts
--    reading it. Semantics: the policy decides the FORM of compensation,
--    each leg's refund_policy_tiers still decide the AMOUNT.
--      VOUCHER_ONLY  - self-service cancel issues a credit voucher
--      NO_CANCEL     - no customer self-service cancellation
--      POLICY_REFUND - cash refund per each leg's own operator tiers
alter table public.combo_offers
  add column if not exists cancellation_policy text not null default 'VOUCHER_ONLY';

alter table public.combo_offers
  drop constraint if exists combo_offers_cancellation_policy_check;
alter table public.combo_offers
  add constraint combo_offers_cancellation_policy_check
  check (cancellation_policy in ('VOUCHER_ONLY', 'NO_CANCEL', 'POLICY_REFUND'));

-- Date rules between legs, keyed jsonb so new rules need no DDL (same pattern
-- as businesses.automation_config). Known keys, all optional:
--   min_gap_days   int  - consecutive legs at least N calendar days apart
--   max_gap_days   int  - all legs within N calendar days of each other
--   enforce_order  bool - legs must be dated in position order
alter table public.combo_offers
  add column if not exists combo_rules jsonb not null default '{}';

comment on column public.combo_offers.combo_rules is
  'Offer-level booking rules: {min_gap_days, max_gap_days, enforce_order}. Enforced in create-paysafe-checkout and rebook-booking; the storefront mirrors them for UX only.';

-- 2. Fix: the settlement code writes PENDING_PAYMENT / PAID / SUPERSEDED /
--    FAILED (combo-settlement-link, yoco-webhook) but the live CHECK only
--    allowed PENDING / SETTLED / DISPUTED, so every one of those writes threw
--    23514 and the deployed settlement-links flow could never record a status.
alter table public.combo_settlements
  drop constraint if exists combo_settlements_status_check;
alter table public.combo_settlements
  add constraint combo_settlements_status_check
  check (status in ('PENDING', 'PENDING_PAYMENT', 'PAID', 'SETTLED', 'SUPERSEDED', 'FAILED', 'DISPUTED'));
