-- H7 (go-live 2026-10-27): money parked by a weather or operator cancellation
-- (refund_status ACTION_REQUIRED: waiting for the guest's choice, or for the
-- operator when the guest was told they would handle it) counts under
-- "Refunds needing action", as the Refunds page and sidebar badge now show it.
BEGIN;

DO $$
DECLARE
  definition text;
  queue constant text := '''REQUESTED'', ''REFUND_PENDING'', ''MANUAL_EFT_REQUIRED'', ''FAILED'')';
BEGIN
  SELECT pg_get_functiondef('public.get_operator_dashboard(uuid,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure) INTO definition;
  IF (length(definition) - length(replace(definition, queue, ''))) / length(queue) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one refund queue filter in get_operator_dashboard';
  END IF;
  EXECUTE replace(definition, queue, '''REQUESTED'', ''REFUND_PENDING'', ''MANUAL_EFT_REQUIRED'', ''FAILED'', ''ACTION_REQUIRED'')');
END $$;

COMMIT;
