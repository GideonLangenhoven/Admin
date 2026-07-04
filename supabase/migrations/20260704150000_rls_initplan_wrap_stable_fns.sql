-- Performance at scale: wrap per-row RLS function calls in scalar subselects so
-- Postgres evaluates them ONCE per query (initPlan) instead of once per row.
-- `current_business_ids()` and `auth.uid()` are STABLE within a statement, so
-- `x = ANY(current_business_ids())` and `x = ANY((select current_business_ids()))`
-- select the identical set — this changes execution cost only, never which rows
-- match (tenant isolation is preserved by construction). Addresses the 26
-- `auth_rls_initplan` advisor warnings on hot tables (bookings, customers,
-- marketing_contacts, chat_messages, ...).
--
-- Applied programmatically over every affected policy. Transactional: if any
-- ALTER fails the whole migration rolls back. Idempotent: policies already
-- wrapped as `(select ...)` are skipped by the regex guard.

DO $$
DECLARE
  r record;
  nq text;
  nc text;
  stmt text;
BEGIN
  FOR r IN
    SELECT pol.polname,
           c.relname,
           pg_get_expr(pol.polqual, pol.polrelid)      AS qual_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
    FROM pg_policy pol
    JOIN pg_class c     ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')        ~ '(current_business_ids\(\)|auth\.uid\(\))'
        OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~ '(current_business_ids\(\)|auth\.uid\(\))'
      )
  LOOP
    nq := r.qual_expr;
    nc := r.check_expr;

    -- Array-returning current_business_ids() must use IN(SELECT unnest(...)) — the
    -- scalar-subquery wrap `= ANY((select ...))` is the subquery form and fails
    -- (uuid = uuid[]). auth.uid() is scalar and wraps directly. Normalise any
    -- prior wrap first so the migration is idempotent.
    IF nq IS NOT NULL THEN
      nq := replace(nq, '(select auth.uid())', 'auth.uid()');
      nq := replace(nq, '= ANY (current_business_ids())', 'IN (SELECT unnest((select current_business_ids())))');
      nq := replace(nq, 'auth.uid()', '(select auth.uid())');
    END IF;
    IF nc IS NOT NULL THEN
      nc := replace(nc, '(select auth.uid())', 'auth.uid()');
      nc := replace(nc, '= ANY (current_business_ids())', 'IN (SELECT unnest((select current_business_ids())))');
      nc := replace(nc, 'auth.uid()', '(select auth.uid())');
    END IF;

    stmt := format('ALTER POLICY %I ON public.%I', r.polname, r.relname);
    IF nq IS NOT NULL THEN stmt := stmt || format(' USING (%s)', nq); END IF;
    IF nc IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', nc); END IF;

    EXECUTE stmt;
  END LOOP;
END $$;
