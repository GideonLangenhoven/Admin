-- Security audit fixes (2026-07-13). Each section closes a finding from the
-- pre-launch audit. Verified against actual query sites before writing:
-- every legitimate write to these tables/columns already goes through a
-- service-role edge function, a service-role API route, or a SECURITY
-- DEFINER RPC — none of it goes through the authenticated/anon RLS path
-- being tightened here.

-- ── C1: any authenticated admin could self-promote to SUPER_ADMIN ──
-- admin_users_update_own_tenant only checked business_id membership, never
-- role. Every legitimate role/password/suspended write already happens via
-- app/api/admin/*/route.ts using the service-role client, which is exempt
-- from column grants.
--
-- NOTE: a column-level REVOKE cannot narrow a pre-existing blanket
-- table-level GRANT UPDATE ON admin_users TO authenticated — Postgres grant
-- semantics don't work that way (a column-level revoke only removes a
-- column-level grant if one existed; it doesn't override a broader
-- table-level grant covering that column). This migration was originally
-- applied as a column-level REVOKE and verified NOT to have closed the gap,
-- then corrected live to the table-level REVOKE below (applied as
-- migration 20260713144422_security_audit_fixes_c1_correction). This file
-- reflects the corrected, actually-effective statement so the local repo
-- matches what's live.
revoke update on public.admin_users from authenticated;

-- ── C2: anon could insert a combo_bookings row with payment_status='PAID' ──
-- Real inserts happen in create-paysafe-checkout (service_role). No
-- anon/authenticated path in app/ or booking/app/ ever inserts this table.
drop policy if exists "Anyone can insert combo_bookings" on public.combo_bookings;
drop policy if exists "combo_bookings_anon_insert" on public.combo_bookings;

-- ── H5: anon could insert combo_booking_items with a forged business_id,
-- corrupting cross-tenant settlement splits. Same story: service_role only.
drop policy if exists "combo_booking_items_anon_insert" on public.combo_booking_items;

-- ── M4: anon could insert arbitrary promotion_uses rows to exhaust/forge
-- promo redemptions. Real redemption goes through the apply_promo_code RPC.
drop policy if exists "promotion_uses_anon_insert" on public.promotion_uses;

-- ── M3: holds_authenticated_all's single ALL policy had with_check=true for
-- INSERT, letting any authenticated session (including customer OTP
-- sessions) write a hold against another tenant's slot. The real booking
-- flow creates holds exclusively via create_hold_with_capacity_check, which
-- is SECURITY DEFINER and bypasses this policy entirely — so blocking direct
-- inserts here costs nothing legitimate. Split the ALL policy into
-- per-command policies so SELECT/UPDATE/DELETE keep their existing scope
-- and INSERT is closed.
drop policy if exists "holds_authenticated_all" on public.holds;

create policy "holds_authenticated_select" on public.holds
  for select to authenticated
  using (
    (booking_id is null)
    or (booking_id in (select bookings.id from public.bookings where bookings.business_id in (select unnest(current_business_ids()))))
    or (slot_id in (select slots.id from public.slots where slots.business_id in (select unnest(current_business_ids()))))
  );

create policy "holds_authenticated_update" on public.holds
  for update to authenticated
  using (
    (booking_id is null)
    or (booking_id in (select bookings.id from public.bookings where bookings.business_id in (select unnest(current_business_ids()))))
    or (slot_id in (select slots.id from public.slots where slots.business_id in (select unnest(current_business_ids()))))
  )
  with check (
    (booking_id is null)
    or (booking_id in (select bookings.id from public.bookings where bookings.business_id in (select unnest(current_business_ids()))))
    or (slot_id in (select slots.id from public.slots where slots.business_id in (select unnest(current_business_ids()))))
  );

create policy "holds_authenticated_delete" on public.holds
  for delete to authenticated
  using (
    (booking_id is null)
    or (booking_id in (select bookings.id from public.bookings where bookings.business_id in (select unnest(current_business_ids()))))
    or (slot_id in (select slots.id from public.slots where slots.business_id in (select unnest(current_business_ids()))))
  );
-- No authenticated/anon INSERT policy recreated: direct inserts are now
-- denied by default (RLS default-deny), matching the real write path
-- (SECURITY DEFINER RPC, which bypasses RLS regardless of this policy).

-- ── M2: zero-policy tables carried broad table-level grants they don't use.
-- RLS default-deny already blocked access, but a future policy addition or
-- an accidental RLS-disable would immediately expose full CRUD. These are
-- edge-function-only tables; anon/authenticated never legitimately touch
-- them directly.
revoke all on public.processed_wa_messages from anon;
revoke all on public.processed_wa_messages from authenticated;
revoke all on public.wa_messages from authenticated;
revoke all on public.business_partnerships from authenticated;
revoke all on public.combo_settlements from authenticated;
revoke all on public.invite_tokens from authenticated;
revoke all on public.ngt_intake_submissions from authenticated;
revoke all on public.ngt_payments from authenticated;
revoke all on public.tenant_invoice_sequences from authenticated;
