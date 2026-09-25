-- check_ins_admin recorded the bare `= ANY(current_business_ids())` form, which
-- PostgreSQL evaluates as a per-row Filter (see tests/unit/rls-initplan.test.ts).
-- Same authorized rows, once-per-statement evaluation: the reviewed spelling the
-- 20260704150000 convention migration rewrites every other policy to.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
drop policy if exists check_ins_admin on public.slot_check_ins;
create policy check_ins_admin on public.slot_check_ins for all to authenticated
  using (business_id in (select unnest((select public.current_business_ids()))))
  with check (business_id in (select unnest((select public.current_business_ids()))));
notify pgrst, 'reload schema';
commit;
