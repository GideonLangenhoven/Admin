BEGIN;
-- The refund ceiling is recorded cash, not the advertised ticket price.
-- Preserve the existing durable-operation implementation and its service-only grants.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.reserve_refund_request(uuid,uuid,numeric,jsonb,boolean)'::regprocedure)
    INTO definition;
  IF position('COALESCE(NULLIF(b.total_captured, 0), b.total_amount)' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected refund implementation; review before applying';
  END IF;
  EXECUTE replace(definition, 'COALESCE(NULLIF(b.total_captured, 0), b.total_amount)', 'COALESCE(b.total_captured, 0)');
END $$;
COMMIT;
