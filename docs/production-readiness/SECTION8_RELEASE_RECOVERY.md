# Section 8: recovery and release gate

Status: **exact deployment and migrations complete; bounded deployed smoke failed; recovery confirmed**.

Exact application candidates Admin 71da0361db65dd63f90b5110648b96b2c4ff3567 and booking 2ff1d82 are deployed. Local gates pass: 1,355 unit tests with one intentional skip, TypeScript, Edge checks, 181 database checks, four Simple View browser cases, both production builds and a zero-vulnerability npm audit. The deployed browser smoke passes 4/4.

Before further qualification, supply a separate restore target and prove monitoring delivery. The restore drill must cover database, Auth identity linkage, objects, Edge secrets/config and alert delivery without touching the deployed pre-launch target. Record restore duration and measured recovery point.

The controlled five-migration package is applied in the approved order: versioned new-subscription pricing, arrival auditing/privilege hardening, MFA-sensitive business columns/grants, authoritative Auth/password-recovery locking, and durable notification jobs. The remote ledger is exact. File hashes and the original dry-run result are recorded in `evidence/MIGRATION_DRY_RUN.json`; a blanket `supabase db push --include-all` remains prohibited.

The bounded staff smoke reached 500 VUs and was aborted on decisive latency and failure-rate breaches. Integrity stayed clean, one scheduler request timed out during the load window, the next minute recovered, and the post-stop browser smoke passed 4/4. Follow-up Supabase telemetry confirms target-side queueing on base Micro compute, while generator contribution remains possible. A local undeployed patch collapses dashboard reads into one tenant-scoped snapshot RPC and passes 188 database checks plus build/type validation. It requires exact review, migration/deployment approval and a progressive instrumented rerun with the original thresholds.

The 24-hour qualification clock has not started. Provider-double/public/background traffic, Realtime measurement, quota headroom, genuine provider journeys, alert delivery and isolated restore remain blocked. No live provider message, charge/refund, provider-account change, paid scaling, restore or public launch switch occurred. See `evidence/BT500_DEPLOYED_SMOKE_20260922.json`.
