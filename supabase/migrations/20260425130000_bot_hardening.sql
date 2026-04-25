-- ════════════════════════════════════════════════════════════════════
-- MVP bot hardening — supporting tables for the bot-guards module.
--
-- 1. outbox.error column — when sendWA() fails (network, rate-limit,
--    template-fallback failure) we record the failure to outbox with
--    status='FAILED'. The free-text error column makes the failure
--    visible in operator dashboards without needing to parse logs.
--
-- 2. webchat_sessions table — webchat used to keep all state in the
--    browser. That made cross-channel isolation impossible (any client
--    could pretend to be in any state). Webchat now persists state
--    server-side keyed by a per-browser session_id. WhatsApp keeps its
--    own conversations table; the two never cross.
--
-- 3. wa_outbound_failures view (optional) — convenience view over the
--    outbox so operators can filter on status='FAILED' quickly.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. outbox.error column ─────────────────────────────────────────────
ALTER TABLE public.outbox
  ADD COLUMN IF NOT EXISTS error TEXT;

CREATE INDEX IF NOT EXISTS outbox_status_failed_idx
  ON public.outbox (business_id, created_at DESC)
  WHERE status = 'FAILED';

-- ── 2. webchat_sessions (server-side state for the customer widget) ──
CREATE TABLE IF NOT EXISTS public.webchat_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  session_id      text NOT NULL,                     -- client-generated UUID, must be unique per business
  state_data      jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_step    text NOT NULL DEFAULT 'IDLE',
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, session_id)
);

CREATE INDEX IF NOT EXISTS webchat_sessions_last_activity_idx
  ON public.webchat_sessions (last_activity_at DESC);

ALTER TABLE public.webchat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webchat_sessions_anon_all" ON public.webchat_sessions;
CREATE POLICY "webchat_sessions_anon_all" ON public.webchat_sessions
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "webchat_sessions_auth_all" ON public.webchat_sessions;
CREATE POLICY "webchat_sessions_auth_all" ON public.webchat_sessions
  FOR ALL TO authenticated
  USING (business_id = any(public.current_business_ids()))
  WITH CHECK (business_id = any(public.current_business_ids()));

GRANT ALL ON public.webchat_sessions TO authenticated, anon;

-- Cleanup helper: drops any webchat session idle longer than 7 days.
-- Call from cron-tasks or run manually; keeps the table from growing
-- unbounded. NOT a security boundary — purely for housekeeping.
CREATE OR REPLACE FUNCTION public.cleanup_stale_webchat_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.webchat_sessions
    WHERE last_activity_at < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_webchat_sessions TO authenticated;

-- ── 3. last_activity_at on conversations (WhatsApp) ──────────────────
-- Already added by 20260310153000_wa_health_and_dedup.sql but we make
-- sure the column exists + carries an index for stale-session cleanup.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS conversations_last_activity_idx
  ON public.conversations (last_activity_at DESC);

-- Backfill any rows that pre-date the column.
-- conversations table has no created_at column; use updated_at as the
-- best-available timestamp.
UPDATE public.conversations
   SET last_activity_at = COALESCE(last_activity_at, updated_at, NOW())
 WHERE last_activity_at IS NULL;

-- ── 4. Cron-callable helper for stale WA conversation reset ──────────
-- Optional: any conversation with current_state != 'IDLE' that has been
-- idle for > 24h gets reset to IDLE. Idempotent. Call from cron-tasks.
CREATE OR REPLACE FUNCTION public.reset_stale_wa_conversations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reset INTEGER;
BEGIN
    UPDATE public.conversations
       SET current_state = 'IDLE',
           state_data = '{}'::jsonb,
           updated_at = NOW()
     WHERE current_state IS NOT NULL
       AND current_state <> 'IDLE'
       AND COALESCE(last_activity_at, updated_at) < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS v_reset = ROW_COUNT;
    RETURN v_reset;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_stale_wa_conversations TO authenticated;
