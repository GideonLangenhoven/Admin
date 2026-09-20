# DEMO-AUTH-01 independent review

Disposition: `APPROVE_TASK` — partial `SEC-11` only.

Reviewed candidate: `37f94bc2374fe987226055ecb810253addcf5faf` against base `e2a7b735b809c37a633f1d44438ef7ba501a9a03`.

Requested reviewer runtime: `gpt-6-astra` / `high`; effective reviewer runtime metadata was not exposed by the host.

The independent reviewer reproduced both original defects in isolated, network-disabled execution. The base allowed a read-only identity with a stale or misconfigured `SUPER_ADMIN` role to select another tenant through the shared Next.js helper, and the Edge `canAccessBusiness` helper ignored `readOnly` for that role. Composing the actual auth helper, role checks, and OTA GET handler also exposed foreign fixture data on the base through a route-specific query selector.

The candidate rejects foreign target headers for read-only identities, returns only effective `MAIN_ADMIN` authority to downstream callers without changing the stored role, and independently constrains Edge read-only access to the bound tenant. The reviewer confirmed own-tenant demo browsing still returns 200, writable `SUPER_ADMIN` foreign-tenant support still returns 200, and a foreign read-only request returns 403 before tenant-data access.

Independent affected tests passed 38/38. TypeScript, targeted ESLint, and diff checks also passed. Recorded evidence additionally shows focused 10/10, Edge checks, and the application build passing. The full unit suite remains non-green with 1,158 passes, the same three companion UI-contract failures, and one skip.

No scoped code finding remains. This does not complete `SEC-11`: the existing `current_business_ids()` SQL helper still grants `SUPER_ADMIN` broad tenant reads without a read-only ceiling, while the demo migration adds write triggers rather than equivalent read isolation. Actual migration-ledger/order, low-privilege database, Storage, deployed-browser, and remaining service-wrapper evidence are unresolved. The approval is not deployment or release readiness.
