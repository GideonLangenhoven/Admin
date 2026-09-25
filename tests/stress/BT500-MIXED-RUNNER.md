# BT500 mixed staff runner

`scripts/bt500-run-mixed.mjs` drives the authenticated staff portion of
`BT500-LAUNCH-V1`: 500 distinct staff accounts over 167 synthetic businesses,
500 active logical sessions, and a deterministic 70% read / 20% safe arrival
write / 10% other-workflow mix. The qualification defaults ramp through
100/250/500 sessions, hold 500 for 60 minutes, run a five-minute 2x action-rate
spike, recover for ten minutes, and retain 500 sessions for a 24-hour soak.

The runner never seeds or tears down data. It accepts only the marker-scoped,
mode-0600 credential bundle produced by the existing guarded BT500 seeder. Each
credential owns one eligible synthetic booking and includes a rotating refresh
token, so runs longer than one hour refresh sessions without sharing identities.
Arrival retries reuse `bt500-20260921:<run-id>:vu-<n>:iteration-<n>` and therefore
cannot duplicate a check-in event.

Validate the frozen contract and resolved phase configuration without making a
network request:

```sh
node scripts/bt500-run-mixed.mjs --dry-run
node --test tests/stress/bt500-mixed-config.test.mjs
```

An actual run is intentionally blocked until `BT500_EXECUTION.json` records an
exact approved candidate and non-production/pre-launch URL. It additionally
requires `BT500_ALLOW_LOAD=YES`, `BT500_ALLOW_SHARED_PROJECT=YES`, a stable
`BT500_RUN_ID`, `BT500_ADMIN_BASE`, `DATABASE_URL`, and the credential file. Use
`BT500_MODE=smoke` plus short phase variables only for a labelled,
non-qualifying harness check. Qualification mode refuses steady, spike,
recovery, or soak durations below the frozen contract.

```sh
BT500_RUN_ID=candidate-20260921-01 \
BT500_ADMIN_BASE=https://exact-approved-candidate.example \
BT500_ALLOW_LOAD=YES \
BT500_ALLOW_SHARED_PROJECT=YES \
BT500_CREDENTIALS_FILE=/private/tmp/bt500-credentials.json \
DATABASE_URL=postgresql://... \
node scripts/bt500-run-mixed.mjs --run
```

k6 thresholds fail the process for read p95/p99 above 750/1500 ms, write
p95/p99 above 1500/3000 ms, unexpected valid-action failures at or above 0.1%,
dropped iterations, runtime tenant-isolation violations, or missed steady/spike
throughput. The launcher then runs `bt500-invariants.sql`; any money, capacity,
marker-boundary, or check-in audit violation is fatal.

This runner does not cover high-volume public checkout, webhook/provider
doubles, the browser Realtime footprint, or genuine provider journeys. Those
remain explicit gates, and this work does not set `mixed_runner_complete`.
