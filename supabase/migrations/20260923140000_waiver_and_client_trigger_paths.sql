-- Keep client-originating definer functions on a trusted search path and
-- reject an explicit NULL waiver token before any signing or contact sync.
-- Existing signatures, callers, trigger attachments and grants are retained.
begin;
CREATE OR REPLACE FUNCTION public.sign_waiver(
  p_booking_id uuid,
  p_waiver_token uuid,
  p_signed_name text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status text;
  v_token uuid;
  v_expires timestamptz;
  v_waiver_status text;
  v_dob_text text;
  v_dob date;
  v_email text;
  v_name text;
  v_business_id uuid;
BEGIN
  SELECT status, waiver_token, waiver_token_expires_at, waiver_status
    INTO v_status, v_token, v_expires, v_waiver_status
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND OR v_token IS NULL OR v_token IS DISTINCT FROM p_waiver_token THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF v_expires IS NOT NULL AND v_expires < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF v_waiver_status = 'SIGNED' THEN
    RETURN jsonb_build_object('ok', true, 'already_signed', true);
  END IF;

  UPDATE public.bookings SET
    waiver_status = 'SIGNED',
    waiver_signed_at = now(),
    waiver_signed_name = p_signed_name,
    waiver_payload = COALESCE(p_payload, '{}'::jsonb)
  WHERE id = p_booking_id AND waiver_token = p_waiver_token;

  -- Lead signer's DOB: participants[0].dob (booking-site waiver),
  -- participant_dobs[0] (older payloads), or date_of_birth (waiver-form shape).
  BEGIN
    v_dob_text := COALESCE(
      p_payload->'participants'->0->>'dob',
      p_payload->'participant_dobs'->>0,
      p_payload->>'date_of_birth'
    );
    IF v_dob_text IS NOT NULL AND v_dob_text <> '' THEN
      v_dob := v_dob_text::date;
      -- Reject obviously bogus values rather than feeding automations noise.
      IF v_dob > CURRENT_DATE OR v_dob < DATE '1900-01-01' THEN
        v_dob := NULL;
      END IF;
    END IF;

    IF v_dob IS NOT NULL THEN
      SELECT lower(email), customer_name, business_id
        INTO v_email, v_name, v_business_id
      FROM public.bookings WHERE id = p_booking_id;

      IF v_email IS NOT NULL AND v_email <> '' THEN
        INSERT INTO public.marketing_contacts (business_id, email, first_name, last_name, date_of_birth, source, tags)
        VALUES (
          v_business_id,
          v_email,
          nullif(split_part(coalesce(v_name, p_signed_name, ''), ' ', 1), ''),
          nullif(btrim(substr(coalesce(v_name, p_signed_name, ''), length(split_part(coalesce(v_name, p_signed_name, ''), ' ', 1)) + 1)), ''),
          v_dob,
          'waiver',
          ARRAY['waiver']
        )
        ON CONFLICT (business_id, email) DO UPDATE
          SET date_of_birth = COALESCE(marketing_contacts.date_of_birth, EXCLUDED.date_of_birth),
              updated_at = now();
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Marketing sync must never fail the signing.
    NULL;
  END;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.sign_waiver(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sign_waiver(uuid, uuid, text, jsonb) TO anon, authenticated, service_role;

-- These trigger bodies already preserve their booking and audit semantics.
-- public is client non-writable; explicitly place pg_temp last for relation
-- lookup while pg_catalog resolves built-ins first.
alter function public.ck_sync_marketing_contact() set search_path = pg_catalog, public, pg_temp;
alter function public.audit_super_admin_business_edit() set search_path = pg_catalog, public, pg_temp;

notify pgrst, 'reload schema';
commit;
