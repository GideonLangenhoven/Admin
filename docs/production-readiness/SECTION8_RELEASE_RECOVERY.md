# Section 8: recovery and release gate

Status: **packet ready; external execution not authorized**.

Exact candidates are Admin 04cf19e98271ea634a4fa68b16e89a0fae65ebd6 and booking 2ff1d82. Local gates pass: 1,324 unit tests with one intentional skip, TypeScript, Edge checks, 172 database checks, four Simple View browser cases, both production builds and a zero-vulnerability npm audit.

Before execution, record a separate restore target, monitoring receiver, deployment target, maintenance window, cost ceiling and approval reference in SECTION8_EXECUTION.json. The restore drill must prove database, Auth identity linkage, objects, Edge secrets/config and alert delivery without touching production. Record restore duration and measured recovery point.

Apply migrations in timestamp order: versioned new-subscription pricing, arrival auditing/privilege hardening, then MFA-sensitive business columns and grants. Stop if ledger order differs, preservation checks fail, audit rows are missing, privileges widen, provider guards are absent or monitoring is silent.

After restore and target checks pass, deploy the exact Admin and booking commits. Use forward repair for non-destructive application defects and restore/rollback only from a verified compatible point. Canary stages are 5, 25, 100, 250 and 500 authenticated users. Hold each stage long enough to inspect auth errors, queue age, booking/payment invariants, database saturation and alert receipt. Abort on any security or financial invariant violation, unexpected valid-traffic failure rate at or above 0.1 percent, breached latency budgets, queue starvation or less than 30 percent sustained resource headroom.

A production deployment and 24-hour canary remain blocked until the named inputs and explicit authorization are supplied. No push, remote migration, restore or deployment was performed while preparing this packet.
