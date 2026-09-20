# COR-02A independent review

Disposition: `APPROVE_TASK` — `COR-02A` only.

Final reviewed candidate: `90eed5ee936252077a611b8cbe602c1fc761c301` against execution base `3ed4a28a62aa620fc5a5c00ca77e0c5340368035`.

Requested reviewer runtime: `gpt-6-astra` / `high`; effective reviewer runtime metadata was not exposed by the host.

The first review of candidate `012284d7122166f6c534a6035ff7f11f0763be80` returned `REQUEST_CHANGES`. It required the retry to persist and reuse the exact provider payload, an immediate per-send voucher-age check so a sequential batch cannot cross the deletion boundary, and nonblank string provider IDs at both acceptance boundaries.

The second review of candidate `2a50404076e6f2fb32cf74e9ff21189e3e26adb7` returned `REQUEST_CHANGES`. A delayed overlapping worker could see that another worker had already stamped the source, fail fresh eligibility, and falsely report failure despite a recorded provider acceptance. The correction now validates intent/source tenant identity first, replays an accepted intent without resubmission, and retains fresh eligibility for every unaccepted intent.

The final reviewer found no blocking task-scope issue. It confirmed that the exact provider payload survives branding drift and transient retry-time branding lookup failure; voucher age is checked immediately before submission and in the database claim; nonblank string provider IDs are required; and an accepted intent can be replayed after a competing source stamp without another provider call, duplicate acceptance count, or foreign-tenant access.

The reviewer independently ran the disposable PostgreSQL suite with 164/164 checks passing. Its first focused test invocation did not recreate the temporary CI-pinned booking symlink and therefore hit an environment `ENOENT`; the core tests passed, and a separate opt-in assertion against the supplied export passed. The primary recorded six-file run with the pinned export passed 115/115. This environment setup miss is not treated as product evidence or a waiver.

Recorded verification also shows TypeScript, Edge checks, targeted lint with no errors, the synthetic-config production build, and diff checks passing. The full unit suite remains non-green at 1,176 passes, three unchanged pinned-companion mobile-contract failures, and one skip.

Approval is limited to truthful voucher-reminder provider acceptance, durable retry/idempotency, and the narrow hold-expiry sibling behavior touched by the task. The migration remains local-only until the target ledger is verified. Hold rediscovery/claim/fairness remains open under `COR-04`; genuine-provider, deployed, load, monitoring, and canary evidence is absent. This is not deployment or release approval.
