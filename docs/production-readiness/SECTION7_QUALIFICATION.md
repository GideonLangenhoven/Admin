# Section 7: 500-user qualification packet

Status: **deployed 500-VU staff smoke failed; full qualification not started**. Profile: `BT500-LAUNCH-V1` v1.0. [WORKLOAD.json](WORKLOAD.json) is the current machine-readable contract. The user replaced the earlier 2,000-session target with 500 sessions on 21 September 2026 and authorized replacement of synthetic test data. The current project is explicitly authorized as a pre-launch target with no customers. High-volume messages and payments remain blocked; one supplied email/WhatsApp recipient and Yoco test-mode journeys are separately approved.

The read smoke reached500 distinct authenticated users across167 synthetic businesses. It completed17,356 actions and69,424 requests with zero failed checks, HTTP failures or dropped iterations. Overall action rate was40.58/s including ramps; the contract's steady50/s rate was not separately certified. Read latency was p95 415.21ms and p99 1.28s; action latency was p95 559ms and p99 1.47s. The single-origin generator hit Supabase's configured per-IP boundary at request33. For steady-session testing, the limit was temporarily raised, sessions were issued at one/second, and the limit was restored to30 before load. Marker teardown restored the original row counts. See [BT500_READ_SMOKE_RESULT.json](evidence/BT500_READ_SMOKE_RESULT.json).

`AUTH-LOGIN-RATE-01` fixes the shared-server bottleneck in source: the server validates/migrates the account, then the browser mints its Supabase session using the user's network IP. A429 no longer counts as a bad password. Focused tests pass135/135 and TypeScript passes. The fix is deployed; distributed-origin login-load proof remains open.

The guarded mixed-staff runner models 500 unique users across 167 tenants, deterministic 70/20/10 actions, 100/250/500 ramp, a 60-minute steady phase, double-rate spike, recovery and a 24-hour soak. Fresh independent Astra/xhigh review accepted its frozen source after offline probes. A shortened deployed smoke reached 500 VUs and failed with 35.19% unexpected action failures, 30.82% HTTP failures, read-action p95 30.004 seconds and write-action p95 61.486 seconds. It was stopped after approximately 144 seconds; post-abort invariants and browser recovery passed. Follow-up Supabase edge telemetry records 2xx responses but approximately 12-second origin p95 during the failure minute, confirming target-side queueing on base Micro compute; generator contribution remains possible. See [BT500_DEPLOYED_SMOKE_20260922.json](evidence/BT500_DEPLOYED_SMOKE_20260922.json) and [BT500_CAPACITY_DIAGNOSIS_20260922.json](evidence/BT500_CAPACITY_DIAGNOSIS_20260922.json).

Section 5's corrective implementation is deployed and the integrated suite passes. Its remaining external Auth/provider, notification, CI and acceptance gates are listed in [SECTION5_CHECKPOINT.json](evidence/SECTION5_CHECKPOINT.json) and [ISSUES.json](ISSUES.json). Section 6 passed 100-account local synthetic continuity but still has external role/provider gates. Section 8 records exact deployment, migrations and recovery after the failed smoke; restore and alert drills remain open. Section 9's truthful `FAILED_GATE` handoff is complete under the user's scope override.

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

WORKLOAD.json freezes the action observation points, failure denominators, terminal outcomes, spike scope and source-derived Realtime footprint. Actual Realtime connections/channels, quota headroom, marketing rate and the provider-double/public/background harness still need deployed measurement. Existing stronger budgets remain in force. No thresholds may be lowered after a failure and represented as a pass of this profile.

## Inputs needed before execution

- Observed infrastructure quotas with at least 30% headroom inside the ZAR 0 ceiling.
- Review, approve, deploy and progressively retest the local dashboard snapshot correction with an instrumented independent generator and remote resource metrics; retain the original thresholds.
- Provider-double public checkout/webhook/background traffic and runtime outbound-guard negative tests.
- Exact-candidate browser measurement of the frozen 500-connection Realtime topology, plus the marketing rate and soak activity cycle.

The temporary 500-user synthetic mixed-smoke fleet was seeded, exercised and removed with original row counts restored. Legitimate marker-only arrival writes occurred; no soak or provider action occurred. Provider doubles, runtime guards, quota proof, product Realtime measurement and a passing unchanged-threshold smoke must be in place before the 24-hour clock can start.

## Executable preflight

Run `npm run test:qualification:contract` to verify that the frozen workload and thresholds have not drifted. Before any qualifying run, fill `BT500_EXECUTION.json` with the exact candidate commit/tree, target, regions, cost ceiling, window, four explicit approvals, outbound controls and four required evidence artifacts. Then run `npm run test:qualification:preflight`.

The execution preflight still blocks a qualifying run because full-harness prerequisites are absent. It performs no network calls and cannot start load. The mixed-staff runner is `scripts/bt500-run-mixed.mjs`; its offline contract and k6 inspection pass, while its bounded deployed smoke evidence records a failed gate rather than qualification.
