-- Waivers are normally signed AFTER payment (link is in the confirmation email).
-- The anon UPDATE policy on bookings only matches DRAFT/PENDING rows, so a direct
-- PostgREST UPDATE from the public waiver page silently affects 0 rows on PAID
-- bookings (PostgREST returns 204 → false-positive "signed" UI, no data written).
--
-- Fix: a SECURITY DEFINER RPC that validates the waiver_token server-side and writes
-- ONLY the waiver columns, regardless of booking status. This avoids widening the
-- anon UPDATE surface to PAID rows (which would expose financial/status columns).
CREATE OR REPLACE FUNCTION public.sign_waiver(
  p_booking_id uuid,
  p_waiver_token uuid,
  p_signed_name text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_token uuid;
  v_expires timestamptz;
  v_waiver_status text;
BEGIN
  SELECT status, waiver_token, waiver_token_expires_at, waiver_status
    INTO v_status, v_token, v_expires, v_waiver_status
  FROM bookings
  WHERE id = p_booking_id;

  IF NOT FOUND OR v_token IS NULL OR v_token <> p_waiver_token THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF v_expires IS NOT NULL AND v_expires < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF v_waiver_status = 'SIGNED' THEN
    RETURN jsonb_build_object('ok', true, 'already_signed', true);
  END IF;

  UPDATE bookings SET
    waiver_status = 'SIGNED',
    waiver_signed_at = now(),
    waiver_signed_name = p_signed_name,
    waiver_payload = COALESCE(p_payload, '{}'::jsonb)
  WHERE id = p_booking_id AND waiver_token = p_waiver_token;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.sign_waiver(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sign_waiver(uuid, uuid, text, jsonb) TO anon, authenticated, service_role;
