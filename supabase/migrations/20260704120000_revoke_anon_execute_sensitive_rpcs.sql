-- Scale/security hardening: revoke default anon/authenticated EXECUTE on
-- SECURITY DEFINER RPCs that are only ever invoked server-side (service_role).
--
-- Supabase grants EXECUTE on every public function to anon+authenticated by
-- default and exposes them at /rest/v1/rpc/<fn>. Several of these functions
-- perform privileged, unverified state changes and must NOT be reachable by
-- untrusted clients.
--
-- P0 — confirm_combo_payment_atomic: flips a combo's child bookings to
-- status='PAID' given only a combo_booking_id, with NO payment verification
-- (being called IS the confirmation). Only caller is paysafe-webhook
-- (service_role). Anon EXECUTE = anyone who knows/guesses a combo UUID can mark
-- bookings PAID without paying. Payment bypass across tenants.
--
-- P1 — get_business_credentials / set_yoco_test_credentials: read/write the
-- encrypted Yoco/Paysafe/WhatsApp secrets. Only callers are _shared/tenant.ts
-- and the credentials API route, both service_role. Defense-in-depth: without
-- anon EXECUTE, a leaked SETTINGS_ENCRYPTION_KEY still can't be used to pull all
-- tenants' secrets directly through PostgREST.
--
-- P1 — deduct_voucher_balance: reduces a voucher's balance with no auth check.
-- No anon caller exists (confirm_voucher_booking wraps it server-side and, being
-- SECURITY DEFINER, invokes it as the function owner regardless of this grant).
-- Anon EXECUTE = drain/zero any voucher by UUID (griefing). Authenticated is
-- retained: the admin booking detail page calls it directly.

-- NB: Supabase's default EXECUTE grant is to PUBLIC (proacl shows `=X/postgres`),
-- which anon/authenticated inherit. Revoking from anon/authenticated alone is a
-- no-op; the grant must be revoked from PUBLIC, then re-granted to the roles that
-- legitimately need it.

REVOKE EXECUTE ON FUNCTION public.confirm_combo_payment_atomic(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_combo_payment_atomic(uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_business_credentials(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_business_credentials(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_yoco_test_credentials(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_yoco_test_credentials(uuid, text, text, text, boolean) TO service_role;

-- deduct_voucher_balance: admin booking-detail page calls it directly as an
-- authenticated user, so keep authenticated; strip PUBLIC/anon.
REVOKE EXECUTE ON FUNCTION public.deduct_voucher_balance(uuid, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.deduct_voucher_balance(uuid, numeric) TO authenticated, service_role;
