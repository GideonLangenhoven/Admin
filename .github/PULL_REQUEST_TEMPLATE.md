# Description



## Pre-merge checklist

- [ ] Lint + typecheck pass locally
- [ ] If changing edge functions: every new `db.from(...)` against a tenant-owned table has `.eq("business_id", X)` (or filters by PK with downstream tenant verification)
- [ ] If changing RLS / migrations: `supabase/security-baseline.json` updated in the same commit
- [ ] If adding a public route: PII / auth implications reviewed
- [ ] Sentry tested locally if observability changed
