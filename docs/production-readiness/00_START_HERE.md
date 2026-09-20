# BookingTours — Sol/max implementation takeover

Prepared 20 September 2026. Status: prompts only; application implementation and release qualification have not started in this handoff.

This is the canonical corrected takeover edition of the supplied v2 pack. The user's later request lets **Sol/max lead implementation and maintain checkpoints**. It replaces the earlier requirement that only an Astra primary session could assign work. Independent Astra/high review of critical changes and final release evidence remains required. Customer protections, production approval boundaries, and the `BT2000-LAUNCH-V2` release gates remain in force.

Select `gpt-5.6-sol` with reasoning effort `max` in a supported host, then paste:

```text
Take over BookingTours production-readiness implementation in GideonLangenhoven/Admin.

Read docs/production-readiness/01_SOL_TAKEOVER.md completely and follow it.
Read 03_RELEASE_CONTRACT.md, 04_REVALIDATION_BACKLOG.md, and
09_WORKLOAD_PROPOSAL.json in that directory. If STATE.md exists, resume it
instead of restarting discovery. Follow applicable project instructions.

Required implementation runtime: gpt-5.6-sol / max. Verify actual routing;
the prompt is not configuration. Use independent gpt-6-astra / high review
for critical changes and final evidence; do not self-approve those changes.

Required source branch: feature/launch-rollout-2026-09-20.
Inspected baseline: 76d00f3157acb2c73159bef6b8d40a108a9e767d.
Resolve current HEAD, retain legitimate descendants, and preserve unrelated work.

Establish G0 and then implement dependency-ready fixes with failing-before /
passing-after behavioral regressions. Use 11_FIRST_TASK.json only when its
prerequisites are satisfied. Continue independent safe work around blockers.
Do not change customer-facing chatbot models, require customer re-onboarding,
restrict OPERATOR refunds without resolving the documented policy conflict,
or apply the existing pricing migration without checking its approved scope.

Production changes, real messages, financial operations, destructive actions,
and consequential paid/load changes need explicit approval. Report precise
remaining gates; never infer ROLLOUT_READY_2000 from a build or mock result.
```

For a later session, use [07_RESUME_PROMPT.md](07_RESUME_PROMPT.md). For independent review, use [06_REVIEW_PROMPT.md](06_REVIEW_PROMPT.md) in a fresh Astra/high context with a concrete base/candidate and evidence packet.

The [release contract](03_RELEASE_CONTRACT.md) preserves sections A–I and the numeric targets from the supplied contract. The [corrected backlog](04_REVALIDATION_BACKLOG.md) records the source findings and policy conflicts. The [workload proposal](09_WORKLOAD_PROPOSAL.json) remains unapproved. The [first task](11_FIRST_TASK.json) is a template, not evidence or permission to run financial operations.

The previous review session recorded Astra/xhigh for its primary and Astra/high for its independent reviewer. No Sol/max implementation session was started or verified. Those historical observations do not establish the next session's routing. The [official Sol model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol) documents `max`; verify that the actual host accepts and uses it. No host configuration is changed by these files.
