# BookingTours production-readiness checkpoint

Updated: 2026-09-21T12:54:38Z
Verdict: IN_PROGRESS.

The isolated Admin candidate is 7d3e7b338afdcee4c06aa460ccfe206c726e6243; the reconciled booking companion is 2ff1d82. Both are committed. Original dirty checkouts remain untouched.

Local corrective work is integrated. Supabase Auth is authoritative for linked staff, legacy hashes migrate once and are cleared, password reauthentication cannot replace the shared browser session, and setup-token issuance and completion use one database ownership lock. A validly claimed token can finalize if it expires during the Auth call. The full unit suite passes 1,333 tests with one intentional skip. TypeScript, Edge checks, both production builds, the four-case responsive Simple View browser run, 176 disposable PostgreSQL checks and npm audit with zero vulnerabilities pass. The database rehearsal includes 100 of 100 same-record continuity, concurrent setup-token claims, guarded token rotation, expiry-safe finalization, versioned new-subscription pricing, arrival audit/privilege checks and MFA migration/grants.

OPERATOR refund access is retained. Bank-account changes and WhatsApp/Yoco linking require MFA. Verified SUPER_ADMIN-assisted recovery and on-behalf changes require the SUPER_ADMIN own MFA, an explicit target and durable attribution. Existing subscriptions and open billing lines are preserved.

Section 6 has passed local synthetic continuity but still fails its release gate until the complete deployed role matrix and genuine provider sandbox journeys run. Section 7 has passed the 500-session authenticated read smoke; the 60-minute mixed load, 50 actions per second steady proof, write paths, spike, recovery and 24-hour soak remain open. Section 8 now has a concrete recovery/deployment packet but lacks external targets and authorization. Section 9 handoff passes with an IN_PROGRESS verdict.

No push, deployment, remote migration, production mutation, genuine provider action, restore or canary occurred. The 24-hour qualification clock has not started because the exact candidate and migration are not deployed.

Read-only target discovery confirms the mismatch: the hosted Admin reports commit 6a630c0, the storefront reports 99b71f0, and neither is the release candidate. Admin functions are in Vercel iad1, storefront functions in cdg1, and Supabase is in eu-west-3. These regions must remain explicit in latency evidence.

The owner subsequently confirmed that the current environment has no real customers and may be used directly for pre-launch qualification, including replacement of synthetic data. It is therefore the authorized qualification target without a second staging environment. A test email, WhatsApp recipient and monitoring receiver were supplied outside the repository, and the preferred 24-hour window starts immediately after deployment. Yoco remains test-mode-only because no numeric live-charge ceiling was supplied. Real charges/refunds, unrestricted outbound messaging, provider-account changes and the public launch switch remain separately gated. The restore drill still needs a second disposable target because restoring an environment into itself cannot prove recoverability safely.
