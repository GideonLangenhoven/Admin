-- Security audit fixes (2026-07-13). Each section closes a finding from the
-- pre-launch audit. Verified against actual query sites before writing:
-- every legitimate write to these tables/columns already goes through a
-- service-role edge function, a service-role API route, or a SECURITY
-- DEFINER RPC — none of it goes through the authenticated/anon RLS path
-- being tightened here.

-- ── C1: any authenticated admin could self-promote to SUPER_ADMIN ──
revoke update (role, password_hash, suspended, must_set_password, user_id)
  on public.admin_users from authenticated;

-- ── C2: anon could insert a combo_bookings row with payment_status='PAID' ──
drop policy if exists "Anyone can insert combo_bookings" on public.combo_bookings;
drop policy if exists "combo_bookings_anon_insert" on public.combo_bookings;

-- ── H5: anon could insert combo_booking_items with a forged business_id ──
drop policy if exists "combo_booking_items_anon_insert" on public.combo_booking_items;

-- ── M4: anon could insert arbitrary promotion_uses rows ──
drop policy if exists "promotion_uses_anon_insert" on public.promotion_uses;

-- ── M3: holds_authenticated_all's INSERT with_check was unconditional true ──
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

-- ── M2: zero-policy tables carried broad table-level grants they don't use ──
revoke all on public.processed_wa_messages from anon;
revoke all on public.processed_wa_messages from authenticated;
revoke all on public.wa_messages from authenticated;
revoke all on public.business_partnerships from authenticated;
revoke all on public.combo_settlements from authenticated;
revoke all on public.invite_tokens from authenticated;
revoke all on public.ngt_intake_submissions from authenticated;
revoke all on public.ngt_payments from authenticated;
revoke all on public.tenant_invoice_sequences from authenticated;
;
