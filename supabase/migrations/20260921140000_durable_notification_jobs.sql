-- Transactional reminder intent. Financial/capacity state and the intent to
-- notify are committed together; the Edge worker then claims jobs with a
-- recoverable lease and sends with a stable provider idempotency key.
CREATE TABLE IF NOT EXISTS public.notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'EMAIL' CHECK (channel = 'EMAIL'),
  template_type text NOT NULL,
  recipient text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'PROCESSING', 'ACCEPTED', 'FAILED', 'CANCELLED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  first_attempt_at timestamptz,
  acceptance_uncertain boolean NOT NULL DEFAULT false,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_id uuid,
  claimed_at timestamptz,
  accepted_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_jobs_due_idx
  ON public.notification_jobs (status, next_attempt_at, created_at)
  WHERE status IN ('QUEUED', 'PROCESSING');
CREATE INDEX IF NOT EXISTS notification_jobs_business_idx
  ON public.notification_jobs (business_id, created_at DESC);

ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.notification_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_notification_jobs(
  p_claim_id uuid,
  p_limit integer DEFAULT 100,
  p_per_business integer DEFAULT 5
) RETURNS SETOF public.notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- A stale final attempt gets one idempotent recovery. If that recovery also
  -- crashes, stop claiming it forever and surface the uncertain outcome.
  UPDATE public.notification_jobs
  SET status = 'FAILED', acceptance_uncertain = true,
      last_error = 'Provider acceptance remained uncertain after final crash recovery; reconciliation required',
      claim_id = NULL, claimed_at = NULL, updated_at = now()
  WHERE status = 'PROCESSING' AND claimed_at < now() - interval '5 minutes'
    AND attempts > max_attempts;

  RETURN QUERY
  WITH ranked AS (
    SELECT id,
      row_number() OVER (PARTITION BY business_id ORDER BY next_attempt_at, created_at, id) AS tenant_rank
    FROM public.notification_jobs
    WHERE (status = 'QUEUED' AND attempts < max_attempts AND next_attempt_at <= now())
       OR (status = 'PROCESSING' AND attempts <= max_attempts AND claimed_at < now() - interval '5 minutes')
  ), candidates AS (
    SELECT j.id
    FROM public.notification_jobs j
    JOIN ranked r ON r.id = j.id
    WHERE r.tenant_rank <= greatest(1, least(p_per_business, 25))
    ORDER BY r.tenant_rank, j.next_attempt_at, j.created_at, j.id
    FOR UPDATE OF j SKIP LOCKED
    LIMIT greatest(1, least(p_limit, 500))
  )
  UPDATE public.notification_jobs j
  SET status = 'PROCESSING',
      claim_id = p_claim_id,
      claimed_at = now(),
      attempts = j.attempts + 1,
      first_attempt_at = COALESCE(j.first_attempt_at, now()),
      updated_at = now()
  FROM candidates c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_notification_job(
  p_job_id uuid,
  p_claim_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.notification_jobs%ROWTYPE;
  payable boolean := true;
  reason text;
BEGIN
  SELECT * INTO target
  FROM public.notification_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR target.status <> 'PROCESSING' OR target.claim_id IS DISTINCT FROM p_claim_id THEN
    RETURN 'STALE_CLAIM';
  END IF;

  IF target.source_type = 'VOUCHER_PAYMENT_REMINDER' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.vouchers
      WHERE id = target.source_id AND business_id = target.business_id
        AND status = 'PENDING'
        AND payment_url IS NOT DISTINCT FROM target.payload->>'payment_url'
        AND yoco_checkout_id IS NOT DISTINCT FROM target.payload->>'yoco_checkout_id'
        AND lower(trim(buyer_email)) IS NOT DISTINCT FROM target.recipient
    ) INTO payable;
    reason := 'Voucher is no longer awaiting payment';
  ELSIF target.source_type = 'HOLD_PAYMENT_REMINDER' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bookings
      WHERE id = target.booking_id AND business_id = target.business_id
        AND status IN ('HELD', 'PENDING', 'PENDING PAYMENT')
        AND payment_url IS NOT DISTINCT FROM target.payload->>'payment_url'
        AND yoco_checkout_id IS NOT DISTINCT FROM target.payload->>'yoco_checkout_id'
        AND lower(trim(email)) IS NOT DISTINCT FROM target.recipient
    ) INTO payable;
    reason := 'Booking is no longer awaiting payment';
  END IF;

  IF payable THEN
    RETURN 'ELIGIBLE';
  END IF;

  UPDATE public.notification_jobs
  SET status = 'CANCELLED', last_error = reason,
      claim_id = NULL, claimed_at = NULL, updated_at = now()
  WHERE id = target.id;
  RETURN 'CANCELLED';
END;
$$;

-- Cancel queued payment reminders in the same transaction that makes their
-- payment target ineligible. PROCESSING jobs have crossed the external HTTP
-- boundary and retain their provider outcome; the worker also revalidates
-- after every claim to cover missed or pre-existing transitions.
CREATE OR REPLACE FUNCTION public.cancel_voucher_notification_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.status = 'PENDING' AND NEW.status IS DISTINCT FROM 'PENDING') THEN
    UPDATE public.notification_jobs
    SET status = 'CANCELLED', last_error = 'Voucher is no longer awaiting payment',
        claim_id = NULL, claimed_at = NULL, updated_at = now()
    WHERE business_id = OLD.business_id
      AND source_type = 'VOUCHER_PAYMENT_REMINDER' AND source_id = OLD.id
      AND status = 'QUEUED';
  ELSIF NEW.status = 'PENDING' THEN
    UPDATE public.notification_jobs
    SET status = 'CANCELLED', last_error = 'Voucher payment details changed',
        claim_id = NULL, claimed_at = NULL, updated_at = now()
    WHERE business_id = NEW.business_id
      AND source_type = 'VOUCHER_PAYMENT_REMINDER' AND source_id = NEW.id
      AND status = 'QUEUED'
      AND (recipient IS DISTINCT FROM lower(trim(NEW.buyer_email))
        OR payload->>'payment_url' IS DISTINCT FROM NEW.payment_url
        OR payload->>'yoco_checkout_id' IS DISTINCT FROM NEW.yoco_checkout_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking_notification_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (
    OLD.status IN ('HELD', 'PENDING', 'PENDING PAYMENT')
    AND NEW.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT')
  ) THEN
    UPDATE public.notification_jobs
    SET status = 'CANCELLED', last_error = 'Booking is no longer awaiting payment',
        claim_id = NULL, claimed_at = NULL, updated_at = now()
    WHERE business_id = OLD.business_id AND booking_id = OLD.id
      AND source_type = 'HOLD_PAYMENT_REMINDER' AND status = 'QUEUED';
  ELSIF NEW.status IN ('HELD', 'PENDING', 'PENDING PAYMENT') THEN
    UPDATE public.notification_jobs
    SET status = 'CANCELLED', last_error = 'Booking payment details changed',
        claim_id = NULL, claimed_at = NULL, updated_at = now()
    WHERE business_id = NEW.business_id AND booking_id = NEW.id
      AND source_type = 'HOLD_PAYMENT_REMINDER' AND status = 'QUEUED'
      AND (recipient IS DISTINCT FROM lower(trim(NEW.email))
        OR payload->>'payment_url' IS DISTINCT FROM NEW.payment_url
        OR payload->>'yoco_checkout_id' IS DISTINCT FROM NEW.yoco_checkout_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cancel_voucher_notification_jobs ON public.vouchers;
CREATE TRIGGER cancel_voucher_notification_jobs
BEFORE UPDATE OF status, payment_url, yoco_checkout_id, buyer_email OR DELETE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.cancel_voucher_notification_jobs();

DROP TRIGGER IF EXISTS cancel_booking_notification_jobs ON public.bookings;
CREATE TRIGGER cancel_booking_notification_jobs
BEFORE UPDATE OF status, payment_url, yoco_checkout_id, email OR DELETE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.cancel_booking_notification_jobs();

CREATE OR REPLACE FUNCTION public.enqueue_replacement_booking_notification_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  previous public.notification_jobs%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT')
    OR NEW.payment_url IS NULL OR NEW.email IS NULL OR position('@' IN NEW.email) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO previous
  FROM public.notification_jobs
  WHERE business_id = NEW.business_id AND booking_id = NEW.id
    AND source_type = 'HOLD_PAYMENT_REMINDER'
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.notification_jobs (
    business_id, booking_id, source_type, source_id, template_type, recipient, payload, dedupe_key
  ) VALUES (
    NEW.business_id, NEW.id, 'HOLD_PAYMENT_REMINDER', previous.source_id, 'PAYMENT_LINK', lower(trim(NEW.email)),
    previous.payload || jsonb_build_object(
      'business_id', NEW.business_id, 'booking_id', NEW.id,
      'customer_name', COALESCE(NEW.customer_name, 'there'), 'ref', upper(left(NEW.id::text, 8)),
      'qty', COALESCE(NEW.qty, 1),
      'total_amount', to_char(COALESCE(NEW.total_amount, 0), 'FM999999990.00'),
      'payment_url', NEW.payment_url, 'yoco_checkout_id', NEW.yoco_checkout_id
    ),
    'hold-payment-link/' || previous.source_id::text || '/' ||
      md5(COALESCE(NEW.yoco_checkout_id, '') || E'\n' || NEW.payment_url || E'\n' || lower(trim(NEW.email)))
  ) ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_replacement_booking_notification_job ON public.bookings;
CREATE TRIGGER enqueue_replacement_booking_notification_job
AFTER UPDATE OF payment_url, yoco_checkout_id, email ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enqueue_replacement_booking_notification_job();

CREATE OR REPLACE FUNCTION public.finish_notification_job(
  p_job_id uuid,
  p_claim_id uuid,
  p_accepted boolean,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_retryable boolean DEFAULT true,
  p_acceptance_uncertain boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.notification_jobs%ROWTYPE;
  next_status text;
BEGIN
  SELECT * INTO target
  FROM public.notification_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR target.status <> 'PROCESSING' OR target.claim_id IS DISTINCT FROM p_claim_id THEN
    RETURN 'STALE_CLAIM';
  END IF;

  IF p_accepted THEN
    UPDATE public.notification_jobs
    SET status = 'ACCEPTED', accepted_at = now(), provider_message_id = p_provider_message_id,
        acceptance_uncertain = false, last_error = NULL,
        claim_id = NULL, claimed_at = NULL, updated_at = now()
    WHERE id = target.id;
    IF target.source_type = 'VOUCHER_PAYMENT_REMINDER' THEN
      UPDATE public.vouchers
      SET payment_reminder_sent_at = COALESCE(payment_reminder_sent_at, now())
      WHERE id = target.source_id AND business_id = target.business_id;
    END IF;
    RETURN 'ACCEPTED';
  END IF;

  next_status := CASE WHEN p_retryable AND target.attempts < target.max_attempts THEN 'QUEUED' ELSE 'FAILED' END;
  UPDATE public.notification_jobs
  SET status = next_status,
      next_attempt_at = CASE WHEN next_status = 'QUEUED'
        THEN now() + make_interval(secs => least(900, 15 * (2 ^ least(target.attempts, 6))::integer))
        ELSE next_attempt_at END,
      last_error = left(COALESCE(p_error, 'Notification delivery failed'), 2000),
      acceptance_uncertain = p_acceptance_uncertain,
      claim_id = NULL,
      claimed_at = NULL,
      updated_at = now()
  WHERE id = target.id;
  RETURN next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_voucher_payment_reminder(p_voucher_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v public.vouchers%ROWTYPE;
  inserted_id uuid;
BEGIN
  SELECT * INTO v FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND OR v.status <> 'PENDING' OR v.payment_url IS NULL
    OR v.payment_reminder_sent_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'NOT_ELIGIBLE');
  END IF;
  IF v.buyer_email IS NULL OR position('@' IN v.buyer_email) = 0 OR v.business_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'INVALID_RECIPIENT');
  END IF;

  INSERT INTO public.notification_jobs (
    business_id, source_type, source_id, template_type, recipient, payload, dedupe_key
  ) VALUES (
    v.business_id, 'VOUCHER_PAYMENT_REMINDER', v.id, 'VOUCHER_PAYMENT_LINK', lower(trim(v.buyer_email)),
    jsonb_build_object(
      'business_id', v.business_id,
      'buyer_name', COALESCE(v.buyer_name, 'there'),
      'recipient_name', COALESCE(v.recipient_name, 'your recipient'),
      'tour_name', COALESCE(v.tour_name, 'Gift Voucher'),
      'total_amount', to_char(COALESCE(v.value, v.purchase_amount, 0), 'FM999999990.00'),
      'payment_url', v.payment_url, 'yoco_checkout_id', v.yoco_checkout_id
    ),
    'voucher-payment-link/' || v.id::text || '/' ||
      md5(COALESCE(v.yoco_checkout_id, '') || E'\n' || v.payment_url || E'\n' || lower(trim(v.buyer_email)))
  ) ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO inserted_id;

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN inserted_id IS NULL THEN 'ALREADY_QUEUED' ELSE 'QUEUED' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_voucher_payment_reminders(
  p_limit integer DEFAULT 100,
  p_per_business integer DEFAULT 5
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted_count integer;
BEGIN
  WITH ranked AS (
    SELECT v.id,
      row_number() OVER (PARTITION BY v.business_id ORDER BY v.created_at, v.id) AS tenant_rank
    FROM public.vouchers v
    WHERE v.status = 'PENDING' AND v.payment_url IS NOT NULL
      AND v.payment_reminder_sent_at IS NULL
      AND v.buyer_email IS NOT NULL AND position('@' IN v.buyer_email) > 0
      AND v.created_at < now() - interval '15 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_jobs j
        WHERE j.dedupe_key = 'voucher-payment-link/' || v.id::text || '/' ||
          md5(COALESCE(v.yoco_checkout_id, '') || E'\n' || v.payment_url || E'\n' || lower(trim(v.buyer_email)))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_jobs j
        WHERE j.source_type = 'VOUCHER_PAYMENT_REMINDER' AND j.source_id = v.id
          AND j.status = 'PROCESSING'
      )
  ), candidates AS (
    SELECT v.*
    FROM public.vouchers v
    JOIN ranked r ON r.id = v.id
    WHERE r.tenant_rank <= greatest(1, least(p_per_business, 25))
    ORDER BY r.tenant_rank, v.created_at, v.id
    FOR UPDATE OF v SKIP LOCKED
    LIMIT greatest(1, least(p_limit, 500))
  ), inserted AS (
    INSERT INTO public.notification_jobs (
      business_id, source_type, source_id, template_type, recipient, payload, dedupe_key
    )
    SELECT v.business_id, 'VOUCHER_PAYMENT_REMINDER', v.id, 'VOUCHER_PAYMENT_LINK', lower(trim(v.buyer_email)),
      jsonb_build_object(
        'business_id', v.business_id,
        'buyer_name', COALESCE(v.buyer_name, 'there'),
        'recipient_name', COALESCE(v.recipient_name, 'your recipient'),
        'tour_name', COALESCE(v.tour_name, 'Gift Voucher'),
        'total_amount', to_char(COALESCE(v.value, v.purchase_amount, 0), 'FM999999990.00'),
        'payment_url', v.payment_url, 'yoco_checkout_id', v.yoco_checkout_id
      ),
      'voucher-payment-link/' || v.id::text || '/' ||
        md5(COALESCE(v.yoco_checkout_id, '') || E'\n' || v.payment_url || E'\n' || lower(trim(v.buyer_email)))
    FROM candidates v
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO inserted_count FROM inserted;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_notification_job(
  p_job_id uuid,
  p_business_id uuid,
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.notification_jobs%ROWTYPE;
  actor public.admin_users%ROWTYPE;
BEGIN
  SELECT * INTO target
  FROM public.notification_jobs
  WHERE id = p_job_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 'NOT_FOUND'); END IF;
  SELECT * INTO actor FROM public.admin_users WHERE id = p_actor_id;
  IF NOT FOUND OR actor.suspended OR actor.read_only
    OR actor.role NOT IN ('MAIN_ADMIN', 'SUPER_ADMIN')
    OR (actor.role = 'MAIN_ADMIN' AND actor.business_id IS DISTINCT FROM p_business_id)
    OR (actor.role = 'MAIN_ADMIN' AND NOT EXISTS (
      SELECT 1 FROM public.businesses b WHERE b.id = p_business_id
        AND upper(b.subscription_status) IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
    )) THEN
    RETURN jsonb_build_object('ok', false, 'status', 'FORBIDDEN');
  END IF;
  IF target.status <> 'FAILED' THEN RETURN jsonb_build_object('ok', false, 'status', 'NOT_FAILED'); END IF;
  IF target.acceptance_uncertain AND target.first_attempt_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 'RECONCILIATION_REQUIRED');
  END IF;
  IF target.first_attempt_at IS NOT NULL
    AND target.first_attempt_at <= now() - interval '23 hours' THEN
    RETURN jsonb_build_object('ok', false, 'status',
      CASE WHEN target.acceptance_uncertain THEN 'RECONCILIATION_REQUIRED' ELSE 'RETRY_WINDOW_EXPIRED' END);
  END IF;
  IF target.attempts >= 10 THEN RETURN jsonb_build_object('ok', false, 'status', 'RETRY_LIMIT'); END IF;

  UPDATE public.notification_jobs
  SET status = 'QUEUED', max_attempts = greatest(max_attempts, attempts + 1),
      next_attempt_at = now(), claim_id = NULL, claimed_at = NULL, updated_at = now()
  WHERE id = target.id;

  INSERT INTO public.audit_logs (
    actor_id, business_id, action_type, target_entity, target_id, metadata
  ) VALUES (
    p_actor_id, p_business_id, 'NOTIFICATION_JOB_RETRY', 'notification_jobs', target.id,
    jsonb_build_object('outcome', 'queued', 'attempts', target.attempts,
      'acceptance_uncertain', target.acceptance_uncertain)
  );
  RETURN jsonb_build_object('ok', true, 'status', 'QUEUED');
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_abandoned_voucher(p_voucher_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v public.vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND OR v.status <> 'PENDING' OR v.created_at >= now() - interval '24 hours' THEN
    RETURN false;
  END IF;
  -- Let an active reminder reach a truthful provider outcome before removing
  -- its payment target. The next sweep deletes the voucher once the job is
  -- ACCEPTED, FAILED or CANCELLED.
  IF EXISTS (
    SELECT 1 FROM public.notification_jobs
    WHERE source_type = 'VOUCHER_PAYMENT_REMINDER' AND source_id = v.id
      AND status IN ('QUEUED', 'PROCESSING')
  ) THEN
    RETURN false;
  END IF;
  DELETE FROM public.vouchers WHERE id = v.id;
  RETURN true;
END;
$$;

-- Preserve the established capacity/payment rules while adding the reminder
-- intent in the same transaction as a regular unpaid hold expiry.
CREATE OR REPLACE FUNCTION public.expire_single_hold(p_hold_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  h holds%ROWTYPE; b bookings%ROWTYPE; amendment boolean; promo record;
  tour_name text; slot_start timestamptz;
BEGIN
  SELECT * INTO h FROM holds WHERE id = p_hold_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT * INTO b FROM bookings WHERE id = h.booking_id FOR UPDATE;
  PERFORM id FROM slots WHERE id = h.slot_id AND business_id = b.business_id FOR UPDATE;
  SELECT * INTO h FROM holds WHERE id = p_hold_id FOR UPDATE;
  IF h.status <> 'ACTIVE' THEN RETURN jsonb_build_object('ok', true, 'already', h.status); END IF;
  IF h.expires_at > now() - interval '5 minutes' THEN RETURN jsonb_build_object('ok', false, 'error', 'in_grace'); END IF;
  amendment := COALESCE(h.hold_type IN ('RESCHEDULE', 'ADD_GUESTS'), false);
  IF NOT amendment AND b.status <> 'CANCELLED' AND (b.status IN ('PAID', 'COMPLETED', 'CONFIRMED') OR b.allow_unpaid) THEN
    UPDATE holds SET status = 'CONVERTED' WHERE id = h.id;
    UPDATE slots SET held = GREATEST(0, COALESCE(held, 0) - h.qty), booked = COALESCE(booked, 0) + h.qty
      WHERE id = h.slot_id AND business_id = b.business_id;
    IF b.allow_unpaid AND b.status IN ('HELD', 'PENDING', 'PENDING PAYMENT') THEN UPDATE bookings SET status = 'CONFIRMED' WHERE id = b.id; END IF;
    RETURN jsonb_build_object('ok', true, 'converted', true);
  END IF;
  UPDATE holds SET status = 'EXPIRED' WHERE id = h.id;
  UPDATE slots SET held = GREATEST(0, COALESCE(held, 0) - h.qty) WHERE id = h.slot_id AND business_id = b.business_id;
  IF amendment THEN
    UPDATE pending_reschedules SET status = 'EXPIRED', expired_at = now() WHERE hold_id = h.id AND status = 'PENDING';
  ELSIF b.status NOT IN ('PAID', 'CONFIRMED', 'COMPLETED') THEN
    PERFORM release_voucher_reservations(b.id);
    FOR promo IN DELETE FROM promotion_uses WHERE booking_id = b.id RETURNING promotion_id LOOP
      UPDATE promotions SET used_count = GREATEST(0, used_count - 1) WHERE id = promo.promotion_id;
    END LOOP;
    IF b.status IN ('HELD', 'PENDING', 'PENDING PAYMENT') AND b.email IS NOT NULL AND b.payment_url IS NOT NULL THEN
      SELECT t.name, s.start_time INTO tour_name, slot_start
      FROM slots s LEFT JOIN tours t ON t.id = b.tour_id
      WHERE s.id = h.slot_id AND s.business_id = b.business_id;
      INSERT INTO notification_jobs (
        business_id, booking_id, source_type, source_id, template_type, recipient, payload, dedupe_key
      ) VALUES (
        b.business_id, b.id, 'HOLD_PAYMENT_REMINDER', h.id, 'PAYMENT_LINK', lower(trim(b.email)),
        jsonb_build_object(
          'business_id', b.business_id, 'booking_id', b.id,
          'customer_name', COALESCE(b.customer_name, 'there'),
          'ref', upper(left(b.id::text, 8)), 'tour_name', COALESCE(tour_name, 'your tour'),
          'tour_date_raw', slot_start, 'qty', COALESCE(b.qty, 1),
          'total_amount', to_char(COALESCE(b.total_amount, 0), 'FM999999990.00'),
          'payment_url', b.payment_url, 'yoco_checkout_id', b.yoco_checkout_id
        ),
        'hold-payment-link/' || h.id::text || '/' ||
          md5(COALESCE(b.yoco_checkout_id, '') || E'\n' || b.payment_url || E'\n' || lower(trim(b.email)))
      ) ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'expired', true, 'hold_type', h.hold_type);
END $$;

REVOKE ALL ON FUNCTION public.claim_notification_jobs(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_notification_job(uuid, uuid, boolean, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_notification_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_voucher_payment_reminder(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_voucher_payment_reminders(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_notification_job(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_abandoned_voucher(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_single_hold(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_voucher_notification_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_booking_notification_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_replacement_booking_notification_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_jobs(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification_job(uuid, uuid, boolean, text, text, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_notification_job(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_voucher_payment_reminder(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_voucher_payment_reminders(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_notification_job(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_voucher(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_single_hold(uuid) TO service_role;

-- Keep the five-minute full maintenance sweep, and add a small dedicated
-- notification invocation so newly queued jobs start within one minute. The
-- URL is inherited from the reviewed existing cron job and the credential is
-- resolved from Vault at execution time; neither can drift into this migration.
DO $notification_schedule$
DECLARE
  source_command text;
  job_url text;
  secret_count integer;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Provision the edge_jobs_service_role_key Vault secret before scheduling notification jobs';
  END IF;

  SELECT command INTO source_command
  FROM cron.job
  WHERE jobname = 'cron-tasks-every-5-minutes';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot derive notification worker URL: cron-tasks-every-5-minutes is missing';
  END IF;
  job_url := (regexp_match(source_command, $re$url\s*:=\s*'([^']+)'$re$, 'i'))[1];
  IF job_url IS NULL OR job_url !~ '^https://[a-zA-Z0-9.-]+/functions/v1/cron-tasks$' THEN
    RAISE EXCEPTION 'Unexpected cron-tasks URL; review the existing schedule before rollout';
  END IF;

  SELECT count(*) INTO secret_count
  FROM vault.decrypted_secrets
  WHERE name = 'edge_jobs_service_role_key' AND length(btrim(decrypted_secret)) > 20;
  IF secret_count <> 1 THEN
    RAISE EXCEPTION 'Exactly one edge_jobs_service_role_key Vault secret is required';
  END IF;

  PERFORM cron.unschedule('notification-jobs-every-minute')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-jobs-every-minute');
  PERFORM cron.schedule(
    'notification-jobs-every-minute',
    '* * * * *',
    format($command$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT btrim(decrypted_secret) FROM vault.decrypted_secrets WHERE name = 'edge_jobs_service_role_key'),
          'apikey', (SELECT btrim(decrypted_secret) FROM vault.decrypted_secrets WHERE name = 'edge_jobs_service_role_key')
        ),
        body := '{"action":"notification_jobs"}'::jsonb,
        timeout_milliseconds := 55000
      );
    $command$, job_url)
  );
END;
$notification_schedule$;
