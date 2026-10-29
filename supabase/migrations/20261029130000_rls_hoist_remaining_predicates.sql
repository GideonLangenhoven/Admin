-- Three SELECT policies still evaluated a per-request function once per scanned row:
--   guide_accounts.guide_self                       auth.uid() bare
--   booking_arrival_approvals.arrival_approvals_read   = ANY (current_business_ids()) bare
--   operator_booking_requests.operator_booking_requests_read  = ANY (current_business_ids()) bare
-- Wrapping the call in a scalar subquery lets Postgres evaluate it once per query (InitPlan).
-- Same predicate, same result: an unset auth.uid() is NULL in both forms, and an empty
-- current_business_ids() yields no rows in both forms. Asserted by tests/unit/rls-initplan.test.ts
-- once security-baseline.json is refreshed from live after this migration is applied.

drop policy guide_self on public.guide_accounts;
create policy guide_self on public.guide_accounts for select to authenticated
  using ((select auth.uid()) = user_id and not suspended and not must_set_password);

drop policy arrival_approvals_read on public.booking_arrival_approvals;
create policy arrival_approvals_read on public.booking_arrival_approvals for select to authenticated
  using (business_id in (select unnest((select public.current_business_ids()))));

drop policy operator_booking_requests_read on public.operator_booking_requests;
create policy operator_booking_requests_read on public.operator_booking_requests for select to authenticated
  using (business_id in (select unnest((select public.current_business_ids()))));
