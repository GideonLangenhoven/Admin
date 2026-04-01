-- Marketing Automations: triggers, sequences, enrollments, logs

---------------------------------------------------------------------------
-- 1. Automations table — defines automation workflows
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL CHECK (trigger_type IN ('contact_added', 'tag_added', 'post_booking', 'date_field', 'manual')),
  trigger_config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  enrolled_count int NOT NULL DEFAULT 0,
  completed_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_automations_service ON public.marketing_automations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY marketing_automations_select_own ON public.marketing_automations
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_automations_insert_own ON public.marketing_automations
  FOR INSERT WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_automations_update_own ON public.marketing_automations
  FOR UPDATE USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_automations_delete_own ON public.marketing_automations
  FOR DELETE USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

---------------------------------------------------------------------------
-- 2. Automation steps — ordered steps within an automation
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_automation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.marketing_automations(id) ON DELETE CASCADE,
  position int NOT NULL,
  step_type text NOT NULL CHECK (step_type IN ('send_email', 'delay', 'condition', 'generate_voucher')),
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_automation_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_automation_steps_service ON public.marketing_automation_steps
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY marketing_automation_steps_select_own ON public.marketing_automation_steps
  FOR SELECT USING (automation_id IN (
    SELECT id FROM public.marketing_automations WHERE business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  ));

CREATE POLICY marketing_automation_steps_insert_own ON public.marketing_automation_steps
  FOR INSERT WITH CHECK (automation_id IN (
    SELECT id FROM public.marketing_automations WHERE business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  ));

CREATE POLICY marketing_automation_steps_update_own ON public.marketing_automation_steps
  FOR UPDATE USING (automation_id IN (
    SELECT id FROM public.marketing_automations WHERE business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  ));

CREATE POLICY marketing_automation_steps_delete_own ON public.marketing_automation_steps
  FOR DELETE USING (automation_id IN (
    SELECT id FROM public.marketing_automations WHERE business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  ));

---------------------------------------------------------------------------
-- 3. Automation enrollments — contacts progressing through automations
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_automation_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.marketing_automations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.marketing_contacts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  current_step int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'exited', 'paused')),
  next_action_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(automation_id, contact_id)
);

ALTER TABLE public.marketing_automation_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_automation_enrollments_service ON public.marketing_automation_enrollments
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY marketing_automation_enrollments_select_own ON public.marketing_automation_enrollments
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

---------------------------------------------------------------------------
-- 4. Automation logs — audit trail of step executions
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid REFERENCES public.marketing_automation_enrollments(id) ON DELETE SET NULL,
  automation_id uuid NOT NULL REFERENCES public.marketing_automations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.marketing_contacts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  step_position int,
  step_type text,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_automation_logs_service ON public.marketing_automation_logs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY marketing_automation_logs_select_own ON public.marketing_automation_logs
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

---------------------------------------------------------------------------
-- 5. Atomic counter RPC for automations
---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_automation_counter(
  p_automation_id uuid,
  p_column text,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  IF p_column NOT IN ('enrolled_count', 'completed_count') THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE public.marketing_automations SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_column, p_column
  ) USING p_amount, p_automation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_automation_counter TO service_role;

---------------------------------------------------------------------------
-- 6. Indexes for performance
---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_marketing_automations_business ON public.marketing_automations(business_id);
CREATE INDEX IF NOT EXISTS idx_marketing_automation_steps_automation ON public.marketing_automation_steps(automation_id, position);
CREATE INDEX IF NOT EXISTS idx_marketing_automation_enrollments_next ON public.marketing_automation_enrollments(status, next_action_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_marketing_automation_enrollments_automation ON public.marketing_automation_enrollments(automation_id);
CREATE INDEX IF NOT EXISTS idx_marketing_automation_logs_enrollment ON public.marketing_automation_logs(enrollment_id);
