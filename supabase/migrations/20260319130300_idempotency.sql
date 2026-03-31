-- Idempotency keys table to prevent duplicate webhook processing
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key ON public.idempotency_keys (key);

-- Auto-cleanup: remove keys older than 7 days (webhook retries won't last that long)
-- Can be called periodically from cron-tasks
CREATE OR REPLACE FUNCTION public.cleanup_old_idempotency_keys()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.idempotency_keys WHERE created_at < now() - interval '7 days';
$$;

-- RLS: only service_role should access this table
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.idempotency_keys TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_idempotency_keys() TO service_role;
