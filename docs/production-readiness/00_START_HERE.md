# BookingTours readiness: resume here

Current status: `IN_PROGRESS`. Read [STATE.md](STATE.md), [APPROVALS.json](APPROVALS.json), [RELEASE_MANIFEST.json](RELEASE_MANIFEST.json), and [ISSUES.json](ISSUES.json) before assigning work.

Current scoped outputs: [Section6 functionality and continuity](SECTION6_FUNCTIONALITY.md), [Section7 qualification](SECTION7_QUALIFICATION.md), [Section8 recovery and release packet](SECTION8_RELEASE_RECOVERY.md), and [Section9 final handoff](SECTION9_HANDOFF.md). Local continuity and the 500-session read smoke pass. External role/provider, mixed-load, restore, deployment and canary gates remain open, so no readiness verdict is claimed.

The 21 September session supersedes the older takeover prompts for source and engineering routing. The selected Admin source is `feature/simple-view-2026-09-20`, remote baseline `181267717e2fc116599df04e8444e9e94fb3c0b6`. Work continues in `/private/tmp/bookingtours-simple-view-1812677`; preserve the original dirty checkout and nested booking repository. The manifest records accepted commits and unaccepted patches separately.

User-requested routing is Astra/xhigh for orchestration and fresh independent critical review, and Sol/max for implementation. At most two disjoint source writers; serialize shared authentication, schema, financial contracts and lockfiles. Observe actual configuration metadata; prompts alone do not attest backend routing.

Resolved product policy: keep OPERATOR refund access; require action-level MFA for invoice-bank changes and WhatsApp/Yoco linking; verified platform-admin-assisted MFA recovery; own-MFA Super Admin may make these changes on behalf of an explicitly selected business with attributable audit; pricing changes affect new subscriptions only. Ordinary authorized booking work remains available during MFA recovery. Preserve existing subscriptions and open billing lines.

The [release contract](03_RELEASE_CONTRACT.md) still defines customer protection and qualification gates. Its older branch/routing introduction and the other numbered takeover prompts are historical where they conflict with the current checkpoint. Local implementation and synthetic tests are authorized. Production mutation, push/deployment, remote migration, genuine messages/financial transactions, provider changes, paid resources, consequential load, restore and canary need the scoped approvals recorded in APPROVALS.json.

Continue safe independent work around external gates. Do not describe builds, mocked providers or local PostgreSQL checks as staging, customer continuity, genuine delivery, capacity qualification or production readiness. See [RELEASE_REPORT.md](RELEASE_REPORT.md) for the current evidence limits.
