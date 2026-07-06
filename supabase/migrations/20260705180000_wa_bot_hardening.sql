-- WhatsApp bot hardening (2026-07-05 audit):
-- 1) processed_wa_messages was referenced by wa-webhook for Meta-retry
--    idempotency but never created — every dedup insert failed silently, so
--    webhook redeliveries double-processed messages (double replies/actions).
-- 2) is_inside_business_hours treated overnight windows (close <= open, e.g.
--    18:00–02:00) as never-inside, flipping OUTSIDE_HOURS bots on during the
--    configured open window.
BEGIN;

CREATE TABLE IF NOT EXISTS public.processed_wa_messages (
  id           text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_wa_messages ENABLE ROW LEVEL SECURITY;
-- Service-role only (wa-webhook); no client policies on purpose.

CREATE INDEX IF NOT EXISTS idx_processed_wa_messages_processed_at
  ON public.processed_wa_messages (processed_at);

CREATE OR REPLACE FUNCTION is_inside_business_hours(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tz text;
  v_hours jsonb;
  v_now timestamptz := now();
  v_local_time time;
  v_local_dow text;
  v_day jsonb;
  v_open time;
  v_close time;
BEGIN
  SELECT timezone, business_hours INTO v_tz, v_hours
  FROM businesses WHERE id = p_business_id;

  IF v_hours IS NULL OR v_tz IS NULL THEN
    RETURN true;  -- no hours configured → treat as always inside (safe default)
  END IF;

  v_local_time := (v_now AT TIME ZONE v_tz)::time;
  v_local_dow := lower(to_char(v_now AT TIME ZONE v_tz, 'dy'));

  v_day := v_hours -> v_local_dow;
  IF v_day IS NULL OR (v_day ->> 'closed')::boolean IS TRUE THEN
    RETURN false;
  END IF;

  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;

  IF v_open IS NULL OR v_close IS NULL THEN
    RETURN true;  -- malformed hours entry → treat as open
  END IF;

  -- Overnight window (e.g. open 18:00, close 02:00): inside = after open OR before close
  IF v_close <= v_open THEN
    RETURN v_local_time >= v_open OR v_local_time < v_close;
  END IF;

  RETURN v_local_time >= v_open AND v_local_time < v_close;
END;
$$;

COMMIT;
