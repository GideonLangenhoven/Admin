-- S7: Reports > "Download settlement register" reads combo_settlements from the browser, but the table had
-- RLS enabled with no policy and no grant for authenticated, so the download failed with a permission error.
-- Combo settlements are the one legitimate cross-tenant flow: exactly the two parties to a settlement
-- (the business that collected and the business that is owed) may read it. Read-only; every write still
-- goes through service-role routes.

GRANT SELECT ON TABLE public.combo_settlements TO authenticated;

CREATE POLICY combo_settlements_parties_select ON public.combo_settlements
  FOR SELECT TO authenticated
  USING (
    collector_business_id = ANY ((SELECT public.current_business_ids())::uuid[])
    OR owed_business_id = ANY ((SELECT public.current_business_ids())::uuid[])
  );
