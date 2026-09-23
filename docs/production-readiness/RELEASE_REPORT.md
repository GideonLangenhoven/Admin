# BookingTours release report — 23 September 2026 checkpoint

Verdict: **FAILED_GATE**. Routing: **BLOCKED_ROUTING** until this embedded session is switched to and attested as `gpt-6-astra`/`xhigh`. The host accepted explicit Sol max implementation and Astra xhigh review dispatches but did not expose effective runtime settings. The owner chose the Astra switch after this checkpoint. Neither implementation acceptance nor 500-session go-to-market readiness is claimed.

## Exact source and deployment

The Admin release branch began at `52afaff997a22e715e3d51194bd2ea07dfccbc7a`. Its isolated C02 correction is `45e07d80f1cde285505261261887ddc18f373281` plus `b4439f7d1e6412e67d34222b1acd27bc0f817194`; fresh-context review dispatched as Astra xhigh accepted the corrected head for local integration. Current Admin alias deployment `dpl_9e1NYwdPEsrXBeVQ3XX6DpQ6m6qL` reports deployed source `ebb62b8f318d7039efcbf1b66d3f5bce9f02996d`, so C02 is not deployed.

The companion current main is `1cd80384884c5176f60607798b51fd54cf970fb2`. Isolated C01 candidate `34cc24c966436763e0acd6beb5db37cc860ef725` passes dependency checks but **failed independent deployment review**. The booking alias serves `dpl_Gb2ULvtZBjNej8STiNyejxfdbc5i`; its Vercel API did not expose a Git SHA. Historical release records link it to `2ff1d82046c73202c3146d11299cff9bc379ac54`, which is not merged into current main. Enabled onboarding deployment `dpl_AUuC2Hb6ArcHKuPGNqnJS7p4Te6T` likewise has no Git SHA; onboarding main is `4ab0d6993dc8c1f1d2fc1b82fc58e117a5f26616`.

See [RELEASE_MANIFEST.json](RELEASE_MANIFEST.json) for lock hashes and deployment identifiers. No patch was pushed, deployed, or applied to a hosted database in this checkpoint.

## Correction and verification results

C02 normalizes public login/recovery behavior, uses a trusted HTTPS recovery origin, and separates malformed reset traffic from login/token buckets. Its first review found two real regressions; Sol corrected both. Fresh-context review dispatched as Astra xhigh reran 202 focused tests, old and current AuthGate sign-in behavior, malformed reset isolation, and the installed Next `after()` lifecycle; the corrected patch was accepted. Real deployed Auth, email and full browser verification remain.

C01 updates the companion dependency lock to zero full and production-only audit findings. `npm ci`, TypeScript and a Webpack production build passed; default Turbopack build remains unverified and current lint reports 85 pre-existing findings. Independent review rejected the candidate because it loses the deployed booking capability token, multi-leg combo modes, tenant-scoped chat, Paysafe CSP, cancellation recovery and image-proxy guards. A no-network image-route reproduction followed an allowed-origin redirect to loopback and returned a public cached image. No partial correction was added. Enabled onboarding still has 14 audit findings; the prepatch booking lock has 17.

C03–C06 remain open. V01 coverage and same-record continuity are incomplete. V02 genuine provider journeys and twelve anomalies are unresolved. V03 data/topology/provider-double prerequisites are incomplete. V04 mixed-load and corrective smokes failed; full mix, spike, soak and canary have not started. V05 alert delivery and isolated restore are unproven. V06 cannot freeze or deploy this candidate. The exact twelve-item ledger is [ISSUES.json](ISSUES.json); [STATE.md](STATE.md) records current environment facts and the consolidated external prerequisite packet.

The owner confirmed the linked project's 50 booking and customer rows are synthetic/demo, an existing isolated restore target with a ZAR 0 ceiling, and the prior private provider/recipient/monitoring destinations for planning. These answers do not authorize hosted mutation, messages, charges, load, or deployment. The restore target ID, capacity, provider controls, action window and exact blast radius still need verification. No customer records or external accounts were changed here.

## Next checkpoint action

Switch the orchestration host to `gpt-6-astra`/`xhigh` and resume from this branch and the two isolated patch worktrees. Astra should direct complete companion preservation reconciliation before another C01 review, integrate accepted C02, then pursue the remaining C/V gates. Do not claim qualification or launch from local source checks.
