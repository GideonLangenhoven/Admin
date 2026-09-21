# Section 7: 500-user qualification packet

Status: **500-user authenticated read smoke passed; full qualification incomplete**. Profile: `BT500-LAUNCH-V1` v1.0. [WORKLOAD.json](WORKLOAD.json) is the current machine-readable contract. The user replaced the earlier 2,000-session target with 500 sessions on 21 September 2026 and authorized replacement of synthetic test data. The current project is explicitly authorized as a pre-launch target with no customers. High-volume messages and payments remain blocked; one supplied email/WhatsApp recipient and Yoco test-mode journeys are separately approved.

The read smoke reached500 distinct authenticated users across167 synthetic businesses. It completed17,356 actions and69,424 requests with zero failed checks, HTTP failures or dropped iterations. Overall action rate was40.58/s including ramps; the contract's steady50/s rate was not separately certified. Read latency was p95 415.21ms and p99 1.28s; action latency was p95 559ms and p99 1.47s. The single-origin generator hit Supabase's configured per-IP boundary at request33. For steady-session testing, the limit was temporarily raised, sessions were issued at one/second, and the limit was restored to30 before load. Marker teardown restored the original row counts. See [BT500_READ_SMOKE_RESULT.json](evidence/BT500_READ_SMOKE_RESULT.json).

`AUTH-LOGIN-RATE-01` fixes the shared-server bottleneck in source: the server validates/migrates the account, then the browser mints its Supabase session using the user's network IP. A429 no longer counts as a bad password. Focused tests pass135/135 and TypeScript passes. Deployment and distributed-origin login-load proof remain open.

This is a read smoke, not a full `BT500-LAUNCH-V1` pass. The representative dataset, write/checkout/webhook/job mixes,60-minute target, double-rate spike, recovery, Realtime footprint, genuine provider journeys and24-hour soak remain unexecuted.

Section 5's local corrective implementation is committed and the integrated suite passes. Its remaining external Auth/provider, notification, CI, provenance and acceptance gates are listed in [SECTION5_CHECKPOINT.json](evidence/SECTION5_CHECKPOINT.json) and [ISSUES.json](ISSUES.json). Section 6 passed 100-account local synthetic continuity but still has external role/provider gates. Section 8 has a concrete recovery and deployment packet awaiting targets and approval. Section 9's truthful handoff is complete under the user's scope override.

## Workload

| Item | Required target |
|---|---|
| Staff |500 distinct accounts and simultaneously active sessions across167 synthetic businesses; three per business and two in the final business |
| Staff actions |50/second:35 reads,10 legitimate writes,5 other workflows; same per-session rate as the superseded profile |
| Concurrent traffic |5 public browse/availability actions/s;0.5 checkouts/s;1.25 controlled webhooks/s;500 transactional jobs over600 seconds; approved marketing load |
| Data |250,000 bookings;62,500 slots;25,000 customer relationships;500,000 message/audit rows; busy tenant with25,000 bookings |
| Sequence |Correctness first;100/250/500 session ramp;60-minute target;5-minute double-rate spike;recovery within10 minutes;actual24-hour soak |
| Providers |Isolated doubles for volume. Genuine provider journeys require separate approval and are not implied by simulated results. |

## Pass/fail contract

Measure each critical journey at steady target. Reads:p95≤750ms,p99≤1,500ms. Writes:p95≤1,500ms,p99≤3,000ms. Unexpected valid-traffic failures<0.1%; zero security/financial invariant violations and zero dropped scheduled iterations. Webhook acknowledgement:p95≤1s including verification/durable acceptance; accepted payment application:p95≤10s; Realtime UI update:p95≤2s. Transactional queue start:p95≤60s;oldest eligible job≤120s;burst completion≤600s from last scheduled enqueue. Sustained resource/quota headroom≥30%. Threshold breaches must fail the run.

WORKLOAD.json contains proposed observation points, failure denominators, rolling windows, terminal outcomes, spike scope and headroom calculations for approval. Action mappings, real Realtime channels/connections, marketing rate and soak activity cycle still need validation. Existing stronger budgets remain in force. No thresholds may be lowered after a failure and represented as a pass of this profile.

## Inputs needed before execution

- Dedicated non-production app URLs and Supabase project/database identity, synthetic accounts and an exact accepted candidate manifest.
- Test regions, infrastructure/quotas, approved storage/compute ceiling and execution window.
- Approved action mapping, product Realtime footprint, marketing rate, soak cycle and metric definitions.
- Verified production-rejecting/outbound guards and a complete candidate-specific runner; the older `tests/stress` probes alone are insufficient.

The temporary 500-user synthetic read-smoke fleet was seeded, exercised and removed with original row counts restored. No mixed write load, soak or provider action occurred. The current Supabase project is approved for pre-launch qualification, but the exact candidate, full mixed runner, product Realtime topology and provider doubles must be in place before its 24-hour clock can start.

## Executable preflight

Run `npm run test:qualification:contract` to verify that the frozen workload and thresholds have not drifted. Before any qualifying run, fill `BT500_EXECUTION.json` with the exact candidate commit/tree, target, regions, cost ceiling, window, four explicit approvals, outbound controls and four required evidence artifacts. Then run `npm run test:qualification:preflight`.

The execution preflight currently fails by design: it identifies the linked Supabase project as production/shared and all missing approvals. It performs no network calls and cannot start load. The old files in `tests/stress` remain narrow race probes; they are not the Section 7 runner.
