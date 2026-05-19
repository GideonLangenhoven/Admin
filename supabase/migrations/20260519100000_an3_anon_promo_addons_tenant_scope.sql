-- AN3 P0 fix: scope anon SELECT on promotions and add_ons to the requesting
-- tenant only. Pre-fix policies were qual=true (promotions) and
-- qual=(active=true) (add_ons), which let any anon caller paginate every
-- tenant's data. Booking site always sends `x-tenant-business-id` via
-- createTenantSupabase, so the only callers affected are anon clients
-- without that header — i.e. exactly the cross-tenant probes we want to block.
-- Same idiom as the existing businesses_anon_select policy.

drop policy if exists promotions_anon_select on public.promotions;
create policy promotions_anon_select on public.promotions
  for select to anon
  using (
    business_id::text = nullif(bt_request_header('x-tenant-business-id'), '')
  );

drop policy if exists add_ons_anon_select on public.add_ons;
create policy add_ons_anon_select on public.add_ons
  for select to anon
  using (
    active = true
    and business_id::text = nullif(bt_request_header('x-tenant-business-id'), '')
  );
