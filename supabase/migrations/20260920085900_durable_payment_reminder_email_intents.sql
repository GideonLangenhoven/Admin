BEGIN;

-- Freeze the exact provider request before submitting a payment reminder.
-- Resend rejects reuse of an idempotency key with a changed payload, so a
-- retry must not re-render mutable tenant branding. This table is service-only
-- because the payload contains recipient details and rendered email content.
CREATE TABLE public.payment_reminder_email_intents (
  intent_key text PRIMARY KEY CHECK (length(intent_key) BETWEEN 1 AND 256),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('VOUCHER', 'HOLD')),
  source_id uuid NOT NULL,
  provider_payload jsonb NOT NULL CHECK (
    jsonb_typeof(provider_payload) = 'object'
    AND octet_length(provider_payload::text) <= 262144
  ),
  provider_message_id text CHECK (
    provider_message_id IS NULL OR length(btrim(provider_message_id)) BETWEEN 1 AND 256
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  last_attempt_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX payment_reminder_email_intents_created_idx
  ON public.payment_reminder_email_intents (created_at);

ALTER TABLE public.payment_reminder_email_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_reminder_email_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_reminder_email_intents TO service_role;

CREATE POLICY payment_reminder_email_intents_service_only
  ON public.payment_reminder_email_intents
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

CREATE OR REPLACE FUNCTION public.claim_payment_reminder_email_intent(
  p_intent_key text,
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_provider_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_status text;
  v_created_at timestamptz;
  v_reminder_sent_at timestamptz;
  v_intent public.payment_reminder_email_intents%ROWTYPE;
BEGIN
  IF p_intent_key IS NULL OR p_business_id IS NULL OR p_source_id IS NULL
     OR p_source_type NOT IN ('VOUCHER', 'HOLD')
     OR jsonb_typeof(p_provider_payload) IS DISTINCT FROM 'object'
     OR octet_length(p_provider_payload::text) > 262144 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_intent');
  END IF;

  IF p_source_type = 'VOUCHER' THEN
    IF p_intent_key <> 'voucher-payment-reminder/' || p_source_id::text THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_intent_key');
    END IF;
    SELECT business_id, status, created_at, payment_reminder_sent_at
      INTO v_business_id, v_status, v_created_at, v_reminder_sent_at
      FROM public.vouchers
     WHERE id = p_source_id
     FOR UPDATE;
    IF NOT FOUND OR v_business_id IS DISTINCT FROM p_business_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voucher_not_found');
    END IF;
  ELSE
    IF p_intent_key <> 'hold-expiry-payment-link/' || p_source_id::text THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_intent_key');
    END IF;
    SELECT b.business_id, b.status
      INTO v_business_id, v_status
      FROM public.holds h
      JOIN public.bookings b ON b.id = h.booking_id
     WHERE h.id = p_source_id
     FOR UPDATE OF h;
    IF NOT FOUND OR v_business_id IS DISTINCT FROM p_business_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'hold_not_found');
    END IF;
  END IF;

  -- An accepted intent is authoritative even if another worker has since
  -- stamped the source. Validate the immutable identity first, then replay
  -- that acceptance without applying fresh-send eligibility a second time.
  SELECT * INTO v_intent
    FROM public.payment_reminder_email_intents
   WHERE intent_key = p_intent_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_intent.business_id IS DISTINCT FROM p_business_id
       OR v_intent.source_type IS DISTINCT FROM p_source_type
       OR v_intent.source_id IS DISTINCT FROM p_source_id THEN
      RAISE EXCEPTION 'payment reminder intent identity mismatch' USING ERRCODE = '23505';
    END IF;
    IF v_intent.provider_message_id IS NOT NULL THEN
      UPDATE public.payment_reminder_email_intents
         SET attempts = attempts + 1,
             last_attempt_at = now(),
             updated_at = now()
       WHERE intent_key = p_intent_key;
      RETURN jsonb_build_object(
        'ok', true,
        'provider_payload', v_intent.provider_payload,
        'provider_message_id', v_intent.provider_message_id
      );
    END IF;
  END IF;

  IF p_source_type = 'VOUCHER' THEN
    -- One-minute guard exceeds the bounded 10-second provider request and
    -- prevents a sequential batch racing the 24-hour deletion sweep.
    IF v_status <> 'PENDING' OR v_reminder_sent_at IS NOT NULL
       OR v_created_at > now() - interval '15 minutes'
       OR v_created_at <= now() - interval '23 hours 59 minutes' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voucher_not_eligible');
    END IF;
  ELSIF v_status NOT IN ('HELD', 'PENDING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hold_not_eligible');
  END IF;

  INSERT INTO public.payment_reminder_email_intents (
    intent_key, business_id, source_type, source_id, provider_payload
  ) VALUES (
    p_intent_key, p_business_id, p_source_type, p_source_id, p_provider_payload
  )
  ON CONFLICT (intent_key) DO NOTHING;

  SELECT * INTO v_intent
    FROM public.payment_reminder_email_intents
   WHERE intent_key = p_intent_key
   FOR UPDATE;

  IF v_intent.business_id IS DISTINCT FROM p_business_id
     OR v_intent.source_type IS DISTINCT FROM p_source_type
     OR v_intent.source_id IS DISTINCT FROM p_source_id THEN
    RAISE EXCEPTION 'payment reminder intent identity mismatch' USING ERRCODE = '23505';
  END IF;

  UPDATE public.payment_reminder_email_intents
     SET attempts = attempts + 1,
         last_attempt_at = now(),
         updated_at = now()
   WHERE intent_key = p_intent_key;

  RETURN jsonb_build_object(
    'ok', true,
    'provider_payload', v_intent.provider_payload,
    'provider_message_id', v_intent.provider_message_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_reminder_email_acceptance(
  p_intent_key text,
  p_provider_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing text;
BEGIN
  IF p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_provider_message_id');
  END IF;
  SELECT provider_message_id INTO v_existing
    FROM public.payment_reminder_email_intents
   WHERE intent_key = p_intent_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intent_not_found');
  END IF;
  IF v_existing IS NOT NULL AND v_existing <> btrim(p_provider_message_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_message_id_mismatch');
  END IF;
  UPDATE public.payment_reminder_email_intents
     SET provider_message_id = COALESCE(provider_message_id, btrim(p_provider_message_id)),
         accepted_at = COALESCE(accepted_at, now()),
         last_error = NULL,
         updated_at = now()
   WHERE intent_key = p_intent_key;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_reminder_email_failure(
  p_intent_key text,
  p_error text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.payment_reminder_email_intents
     SET last_error = left(COALESCE(p_error, 'send_failed'), 1000),
         updated_at = now()
   WHERE intent_key = p_intent_key
     AND provider_message_id IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_payment_reminder_email_intents(
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH doomed AS (
    SELECT intent_key
      FROM public.payment_reminder_email_intents
     WHERE created_at < now() - interval '7 days'
     ORDER BY created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 1000))
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.payment_reminder_email_intents i
   USING doomed d
   WHERE i.intent_key = d.intent_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_payment_reminder_email_intent(text, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_payment_reminder_email_acceptance(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_payment_reminder_email_failure(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_payment_reminder_email_intents(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_reminder_email_intent(text, uuid, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_reminder_email_acceptance(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_reminder_email_failure(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_payment_reminder_email_intents(integer) TO service_role;

COMMIT;
