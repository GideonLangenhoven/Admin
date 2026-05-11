-- OTP brute-force protection: DB-backed send throttles and verify attempts.
-- Edge Functions use service_role; no anon/authenticated table access exists.

CREATE TABLE IF NOT EXISTS public.otp_attempts (
  token_hash text PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email text NOT NULL,
  phone_tail text,
  code_hash text,
  ip_address text,
  purpose text NOT NULL DEFAULT 'my_bookings',
  attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.otp_attempts ADD COLUMN IF NOT EXISTS phone_tail text;
ALTER TABLE public.otp_attempts ADD COLUMN IF NOT EXISTS code_hash text;
ALTER TABLE public.otp_attempts ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE public.otp_attempts ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'my_bookings';

CREATE INDEX IF NOT EXISTS idx_otp_attempts_expiry ON public.otp_attempts (expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_attempts_email_created ON public.otp_attempts (email, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_attempts_ip_created ON public.otp_attempts (ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_attempts_purpose_created ON public.otp_attempts (purpose, created_at);

ALTER TABLE public.otp_attempts ENABLE ROW LEVEL SECURITY;

-- Only edge functions (service_role) touch this table
DROP POLICY IF EXISTS otp_attempts_service ON public.otp_attempts;
CREATE POLICY otp_attempts_service ON public.otp_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.bt_record_otp_failed_attempt(
  p_token_hash text,
  p_max_attempts int DEFAULT 5,
  p_lock_minutes int DEFAULT 15
)
RETURNS TABLE(attempts int, locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.otp_attempts oa
  SET attempts = oa.attempts + 1,
      locked_until = CASE
        WHEN oa.attempts + 1 >= p_max_attempts THEN
          GREATEST(COALESCE(oa.locked_until, '-infinity'::timestamptz), now() + make_interval(mins => p_lock_minutes))
        ELSE oa.locked_until
      END
  WHERE oa.token_hash = p_token_hash
  RETURNING oa.attempts, oa.locked_until;
END;
$$;

REVOKE ALL ON FUNCTION public.bt_record_otp_failed_attempt(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bt_record_otp_failed_attempt(text, int, int) TO service_role;
