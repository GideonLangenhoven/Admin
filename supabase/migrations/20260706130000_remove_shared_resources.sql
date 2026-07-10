-- Remove the "shared resources / capacity pools" feature entirely.
--
-- Verified before writing this migration: resources and tour_resources both
-- have 0 live rows across the whole platform (2 tenants). Postgres's own
-- table statistics (pg_stat_user_tables: n_tup_ins=1, n_tup_del=1 on both,
-- never vacuumed/analyzed) show exactly one row was ever inserted into each,
-- then deleted — consistent with a single manual test, never real tenant
-- adoption. No booking has ever been made against a resource-linked tour.
-- The feature is architecturally isolated: only slot_available_capacity's
-- read-only resource_capacity branch references it; the actual booking/hold
-- write path (create_hold_with_capacity_check, adjust_slot_capacity) never
-- has. It is unrelated to combo bookings (separate tables, cross-tenant by
-- design; this feature is single-tenant only).
BEGIN;

-- Simplify back to pure direct-capacity math (the resource_capacity CTE and
-- its LEAST() clamp are removed; list_available_slots/slot_has_capacity call
-- this function and need no changes themselves).
CREATE OR REPLACE FUNCTION public.slot_available_capacity(p_slot_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  select greatest(s.capacity_total - coalesce(s.booked, 0) - coalesce(s.held, 0), 0)
  from public.slots s
  where s.id = p_slot_id
$function$;

DROP TABLE IF EXISTS public.tour_resources;
DROP TABLE IF EXISTS public.resources;

COMMIT;
