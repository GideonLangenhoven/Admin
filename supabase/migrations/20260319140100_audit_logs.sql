-- Append-only audit trail for sensitive admin operations.
-- No UPDATE or DELETE policies are created — this table is write-once by design.

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid REFERENCES public.admin_users(id),
  business_id   uuid NOT NULL,
  action_type   text NOT NULL,          -- e.g. REFUND, PRICE_OVERRIDE, BOOKING_DELETE
  target_entity text,                   -- e.g. bookings, invoices, tours
  target_id     uuid,
  before_state  jsonb,
  after_state   jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_id ON public.audit_logs (business_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at  ON public.audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id    ON public.audit_logs (actor_id);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Service role can INSERT (Edge Functions log audit entries)
CREATE POLICY audit_logs_service_insert
  ON public.audit_logs
  FOR ALL
  USING (auth.role() = 'service_role');

-- Authenticated admins can SELECT their own business audit entries (read-only)
CREATE POLICY audit_logs_select_own_business
  ON public.audit_logs
  FOR SELECT
  USING (
    business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies — audit_logs is append-only.
