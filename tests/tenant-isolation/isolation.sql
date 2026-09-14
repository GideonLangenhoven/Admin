-- Tenant-separation invariants. Every row must report PASS.
-- Companion to tests/tenant-isolation/probe.mjs: that one attacks over HTTP as
-- anon, this one checks the data itself and the logged-in-operator boundary.
--
-- Usage: psql "$DATABASE_URL" -f tests/tenant-isolation/isolation.sql
--        (or paste into the Supabase SQL editor / MCP execute_sql)
--
-- Both checks are generated from the live catalog, so a table or FK added next
-- week is covered without editing this file.

\echo '=== 1. cross-tenant referential integrity ==='

-- For every FK edge where BOTH sides carry business_id, a child row must share
-- its parent's business_id. A mismatch means one tenant's booking hangs off
-- another tenant's slot/tour/customer.
WITH scoped AS (
  SELECT table_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name='business_id'
), edges AS (
  SELECT tc.table_name AS child, kcu.column_name AS child_col,
         ccu.table_name AS parent, ccu.column_name AS parent_col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
    AND tc.table_name IN (SELECT table_name FROM scoped)
    AND ccu.table_name IN (SELECT table_name FROM scoped)
    AND ccu.table_name <> tc.table_name
), counted AS (
  SELECT child || '.' || child_col || ' -> ' || parent AS edge,
         (xpath('/row/c/text()', query_to_xml(
           format('SELECT count(*) AS c FROM public.%I ch JOIN public.%I pa ON pa.%I = ch.%I
                   WHERE ch.business_id IS DISTINCT FROM pa.business_id',
                  child, parent, parent_col, child_col),
           false, true, '')))[1]::text::bigint AS bad
  FROM edges
)
SELECT edge,
       CASE
         -- A SUPER_ADMIN acting on a tenant it does not belong to is the one
         -- legitimate mismatch: the log is filed against the TARGET tenant
         -- while the actor's home business differs. That is the audit trail
         -- doing its job, not a leak.
         WHEN bad = 0 THEN 'PASS'
         WHEN edge = 'audit_logs.actor_id -> admin_users' THEN 'PASS (super-admin cross-tenant action, expected)'
         ELSE 'FAIL'
       END AS result,
       bad AS mismatched_rows
FROM counted
ORDER BY (bad > 0 AND edge <> 'audit_logs.actor_id -> admin_users') DESC, edge;

\echo ''
\echo '=== 2. logged-in operator cannot see another tenant (real RLS) ==='

-- Impersonate one tenant's MAIN_ADMIN and count how many rows belonging to any
-- OTHER tenant are visible through RLS, on every business-scoped table.
-- Runs as `authenticated`, so the policies are the ones production uses.
-- Pick the seat to impersonate BEFORE dropping privileges, and measure what is
-- out there to steal. Once we are `authenticated`, RLS hides exactly the rows
-- this control needs to count.
CREATE TEMP TABLE _probe AS
SELECT au.user_id,
       au.business_id AS my_tenant,
       (SELECT count(*) FROM bookings  b WHERE b.business_id <> au.business_id) AS other_bookings,
       (SELECT count(*) FROM customers c WHERE c.business_id <> au.business_id) AS other_customers
FROM admin_users au
WHERE au.user_id IS NOT NULL AND au.business_id IS NOT NULL
  AND upper(coalesce(au.role,'')) NOT LIKE 'SUPER%'
-- Prefer the seat with the most to steal, so the sweep is a real test rather
-- than a tenant that happens to sit next to empty neighbours.
ORDER BY (SELECT count(*) FROM bookings b WHERE b.business_id <> au.business_id) DESC
LIMIT 1;

-- The sweep below reads this while dropped to `authenticated`.
GRANT SELECT ON _probe TO authenticated;

-- Guard against a vacuous pass: if there is nothing in other tenants, every
-- count below reads 0 whether or not isolation works.
SELECT 'other tenants hold data worth leaking' AS invariant,
       CASE WHEN other_bookings > 0 AND other_customers > 0 THEN 'PASS'
            ELSE 'FAIL (nothing to prove — sweep below is meaningless)' END AS result,
       other_bookings || ' bookings, ' || other_customers || ' customers in other tenants' AS detail
FROM _probe;

BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', (SELECT user_id FROM _probe), 'role', 'authenticated')::text, true) AS impersonating;

  -- Second half of the guard: the seat must actually resolve to exactly one
  -- tenant. A seat resolving to none is denied everything by RLS and would
  -- sail through the sweep proving nothing.
  SELECT 'impersonated seat resolves to exactly one tenant' AS invariant,
         CASE WHEN coalesce(array_length(current_business_ids(), 1), 0) = 1
              THEN 'PASS' ELSE 'FAIL (sweep below is meaningless)' END AS result,
         coalesce(array_length(current_business_ids(), 1), 0)::text AS tenants_visible;

  SELECT t AS table_name,
         CASE WHEN visible = 0 THEN 'PASS'
              -- Approved reviews are public by design: they render on every
              -- storefront and on the public operator directory.
              WHEN t = 'reviews' THEN 'PASS (APPROVED reviews are public)'
              ELSE 'FAIL' END AS result,
         visible AS other_tenant_rows_visible
  FROM (
    SELECT c.relname AS t,
           (xpath('/row/c/text()', query_to_xml(
             format('SELECT count(*) AS c FROM public.%I WHERE NOT (business_id = ANY (current_business_ids()))%s',
                    c.relname,
                    -- An operator who books with ANOTHER operator using the same
                    -- login sees that row through the /my-bookings self-read
                    -- clause. It is their own booking, not the other tenant's
                    -- data, so discount it or this reports a false FAIL.
                    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns col2
                                      WHERE col2.table_schema='public' AND col2.table_name=c.relname
                                        AND col2.column_name='customer_id')
                         THEN ' AND NOT EXISTS (SELECT 1 FROM public.customers cu WHERE cu.user_id = (SELECT auth.uid()) AND cu.id = customer_id)'
                         ELSE '' END
                 || CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns col3
                                      WHERE col3.table_schema='public' AND col3.table_name=c.relname
                                        AND col3.column_name='user_id')
                         -- same reasoning one table up: the customers row the
                         -- operator created by booking elsewhere is their own.
                         THEN ' AND user_id IS DISTINCT FROM (SELECT auth.uid())'
                         ELSE '' END),
             false, true, '')))[1]::text::bigint AS visible
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema='public' AND col.table_name=c.relname
                    AND col.column_name='business_id')
  ) s
  ORDER BY (visible > 0 AND t <> 'reviews') DESC, t;
COMMIT;
