-- ════════════════════════════════════════════════════════════════════
-- 2026-05-16 — V-14: marketing_automation_steps_step_type_check did not
-- include 'generate_promo'. The UI advertised the step type and the
-- admin save toast said "Automation activated", but the row INSERT
-- failed silently against the CHECK constraint and the step was
-- rolled out of the transaction. Effect: every Birthday / Welcome
-- automation that used the Generate Promo step was unsavable.
--
-- Fix: replace the CHECK constraint with the full step_type set the
-- editor exposes. Applied directly to ukdsrndqhsatjkmxijuj prior to
-- being committed here so the live constraint matches what the UI
-- offers.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.marketing_automation_steps
  DROP CONSTRAINT IF EXISTS marketing_automation_steps_step_type_check;

ALTER TABLE public.marketing_automation_steps
  ADD CONSTRAINT marketing_automation_steps_step_type_check
  CHECK (step_type IN ('send_email', 'delay', 'condition', 'generate_voucher', 'generate_promo'));

COMMIT;
