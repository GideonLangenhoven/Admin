# Marketing implementation, 15 October 2026

Local work only. No hosted queries, contact exports, credentials, deployment, provider sends or live voucher issuance are authorised. The user’s reviewed UI baseline is observed evidence, not a fresh authenticated review. Existing uncommitted changes were inventoried before edits; copies of touched files are in `/private/tmp/bookingtours-marketing-baseline-20261015` for comparison. Protected draft: `5bb1d74b-8634-4fec-9c42-f6f13cc1c33f`.

## Evidence inventory before implementation

| Area | Evidence | Initial classification |
|---|---|---|
| Stack and identity | `package.json`; `components/BusinessContext.tsx:4`; `supabase/functions/_shared/auth.ts:29` | Next 16/React 19, browser Supabase, PostgreSQL RLS, Deno edge workers; tenant = business. Admin membership resolves by user_id. |
| UI | `app/marketing/layout.tsx`; `app/marketing/page.tsx:70`; `app/marketing/contacts/page.tsx:168`; `app/marketing/automations/page.tsx:59`; `app/marketing/automations/[id]/page.tsx:238`; `/marketing/templates`, `/marketing/promotions`, `/vouchers` | Existing overview, imports/mapping, ten recipes, previews, activation checks, logs, archive and vouchers. Preserve. |
| Contact and permission | `20260323200000_marketing_engine.sql:8`; `20260319140300_marketing_consent.sql:1`; `20260710120000_marketing_contact_auto_sync.sql:15`; contacts page import at line 435 | Booking opt-in is nullable; customers have another boolean. Booking trigger syncs identity, not evidence. Imports skip exact existing business/email duplicates. Active status is insufficient permission. Provenance ledger missing. |
| Tenant boundaries | `20260909080000_marketing_tenant_relations.sql:4`; `20260908080000_scoped_marketing_claims.sql:6`; `20260502053731_rls_fix_broken_auth_uid_lookup.sql:44` | Composite tenant FKs, scoped claims and RLS already implemented. Runtime verification still required; service role bypasses RLS. |
| Journeys | builder lines 238/358; automation dispatcher lines 154/193/249; `20261015150000_welcome_back_email_sequences.sql:11` | Draft/activation separate; existing local win-back work checks rebooking/upcoming reservations. Save is nontransactional; activation ignores save failure. Active steps mutable. |
| Recipe mismatch | automation catalogue lines 64/109/116; dispatcher condition at line 457 | Prospect welcome has no booking exit; review description claims unavailable review detection; open condition actually uses any contact open. |
| Queue and provider | `marketing-dispatch/index.ts:49/171/324`; `marketing-automation-dispatch/index.ts:324`; `_shared/marketing-batch.ts:22` | Resend batch + individual calls. Atomic claims, capped campaign retries/backoff. Unknown outcomes retried; durable provider intent missing. |
| Suppression | `marketing-unsubscribe/index.ts:32/129`; both dispatchers check active status | Existing unsubscribe token and send-time status checks. Token currently appears in error/event metadata; explicit tenant filters missing there. Bounce webhook only mentioned in send-email comment at line 60, no handler found. |
| Events and outcomes | `marketing-track/index.ts:17/77/148`; marketing_events schema v2 line 50; reporting overview campaign aggregates | Opens/clicks and usage exist. Anonymous identifiers not fully bound. No verified campaign→booking/payment/refund attribution. Revenue completeness cannot be inferred from empty tenant UI. |
| Jobs and time | `cron-tasks/index.ts:360/533/721`; `20260908080000_scoped_marketing_claims.sql:66`; `20260908081000_authenticate_message_crons.sql:25` | Daily behaviour tagging, immediate UI tag/contact enrollment, campaign minute/automation five-minute cron definitions. Worker claim adds 15 minute lease. UI uses browser-local formatting; date trigger uses worker-local day. Hosted schedules not inspected. |
| Vouchers | automation dispatcher lines 514–645; `app/vouchers/page.tsx`; redemption functions | Existing lifecycle and redemption must be reused. Percentage recipe vouchers currently materialise monetary vouchers: unsupported semantic mismatch. Owner limits and expiry-goal binding unresolved. |
| Capture and retention | booking marketing_opt_in, waiver DOB sync migrations, contacts add/edit/import | Existing DOB capture and phone requirement; no need to expand capture. Optional DOB/minor retention/access decision outstanding. No abandoned-booking marketing authorised. |
| Operational traffic | `auto-messages`, `send-email`, `broadcast`, `wa-webhook`, `cron-tasks`; notification job migrations | Separate booking/notification operations. Broadcast has promotional branches and must also use permission check. Do not make a marketing pause disable operational jobs. |

## Incremental plan

1. Add an append-only tenant/channel/purpose evidence and suppression ledger. No historical consent backfill. Keep suppressions across identity updates, deletes and imports. Add a shared eligibility reason and durable delivery reservation, safe unknown-outcome handling and authenticated provider callback.
2. Add atomic draft save, revision snapshots, guarded activation and immutable active revisions. Opening the builder becomes local state; preserve unsaved edits per tenant/session. Keep archive reversible and protect the review draft.
3. Correct review and offer wording; derive contracts from actual triggers/steps. Add goal-led overview and a strictly synthetic, network-free guided simulation, including zero/unknown states and projected email volume/cost.
4. Verify with disposable local PostgreSQL, mocked provider calls and browser fixtures. Record each acceptance test separately. No production-readiness claim.

## Decisions

Confirmed by owner in this session: any non-cancelled reservation, including unpaid reservations, excludes first-booking offers. Cancellation does not erase a refunded or otherwise non-cancelled booking automatically. No approved marketing collection notice/version is available. Therefore unknown permission remains blocked; this change does not approve a legal policy or create permission from a boolean/import/open.

Remaining: owner and qualified adviser approve collection notice, evidence capture and any legitimate alternative basis; sender readiness and harmless test recipients; voucher limits/percentage semantics; DOB/minor retention; review event integration; enquiry ownership; attribution model/window/currency/refund rules. P2 capacity-aware campaigns and WhatsApp are deferred until P0/P1 acceptance, as requested.

## Migration and rollback proposal

Apply new migration only to disposable local PostgreSQL now. For separately approved staging/production rollout: back up schema, inspect normalized-email collisions and legacy tenant relationships, pause promotional workers, apply schema, deploy all gated dispatch paths together, verify synthetic staging evidence, then explicitly approve activation. New eligibility blocks unknown evidence by design and may reduce the audience to zero. Never fabricate consent to restore volume.

Rollback UI independently. For engine rollback keep promotional workers paused and preserve permission/suppression/delivery/revision evidence; restoring ungated workers would reintroduce unsafe dispatch. Do not drop audit tables or clear uncertain delivery rows. Restore a previous revision only as a new explicit draft, never rewrite an active enrollment in place. No production migration or rollback has been executed.

## Provider documentation checked

Resend [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) supports both send endpoints, with a 24-hour retention window. A durable local delivery record must outlive that window. [Webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests) requires verifying the raw signed body before mutation. [Verified domains](https://resend.com/docs/dashboard/domains/introduction) documents SPF/DKIM and recommends DMARC. Source inspection cannot prove current account/DNS verification. Later approval must cover provider webhook configuration, secret installation and a harmless test; none is performed here.

Validation results, exact commands, local demo and requirement status are recorded below as work completes.

## Implemented local scope

Display/UI changes:

- Overview starts with review, prospect welcome, welcome-back and voucher goals. Counts are real read-only eligibility queries, including zero. Voucher planning remains unavailable until expiry scheduling and contact binding are verified. Running journeys are listed before creating another one.
- A separate, optional synthetic walkthrough covers goal → audience → content → timing/safeguards → review. It has no save, activate, send or issuance capability. Volume is an upper bound; cost remains unavailable without a verified billing context.
- Recipe browsing opens a preview. Opening a blank builder routes to `/marketing/automations/new` without a write. Explicit Save calls the atomic draft RPC. Browser-session edits survive navigation; changes elsewhere raise a conflict instead of silently overwriting the server. Emergency pause remains available.
- Builder/gallery contracts derive their trigger and steps from the executable data. Shared version 1 copy explains eligibility, goal/exit, elapsed delay, IANA timezone, quiet hours, frequency, re-entry and stop rules. This is a local contract version, not a certification of every historical recipe.
- Review recipe invites all eligible completed-tour contacts, with one bounded reminder. No open-based review condition remains in the recipe. Existing saved review flows with that condition cannot newly activate. Open/click condition copy honestly describes the existing contact-wide query. Unsupported performance claims and the fabricated starter testimonial were removed while retaining designed emails and real tour cards.
- Manual contact creation requires email; names/phone are optional. Imports remain stored for review. Status toggles cannot resubscribe a suppressed record. The contact history page shows source, permission evidence, engagement and exact-address booking matches, clearly marking shared-address ambiguity and unavailable sources.
- Campaign audience preflight reports permission exclusions. Campaign queue creation uses the same permission-filtered, security-invoker view. Unknown/error counts do not enable Send. The dispatcher checks again later.

Engine/schema changes:

- `20261015160000_marketing_permission_safety.sql`: tenant/channel/purpose evidence, observed suppression snapshots, future booking/customer withdrawals, retained normalized-address suppression hashes, ambiguous-identity exclusion, audience queries, durable delivery reservations, final handoff checks, provider-event deduplication and transactional unsubscribe. No grants are backfilled.
- Both campaign and automation workers reserve a durable delivery identity before sending, then recheck current eligibility/booking/pause/recipient state immediately before provider handoff. Provider idempotency headers are added. Network errors, 5xx and malformed success responses do not automatically resend. A worker crash leaves an auditable held intent.
- Conservative local defaults: one marketing email per contact per 24 elapsed hours across the two marketing workers, and 08:00–20:00 in the business IANA timezone. These are proposed guardrails for owner acceptance. Invalid timezone blocks dispatch. Date triggers use the operator’s calendar date, including year and DST boundaries; elapsed delays retain their original semantics.
- Prospect welcome excludes any reservation except explicit `CANCELLED`, including unpaid and refunded records. Email/phone matches only exclude conservatively; they do not merge identities. Welcome-back also checks its last-paid-booking anchor and upcoming reservations. Opt-out/bounce/complaint/unknown evidence blocks promotion.
- Voucher/promo metadata, where actually bound, is rechecked for tenant, recipient, status, balance, validity and use limit. The countdown-based voucher-expiry recipe is held because a tag plus elapsed delays does not establish the actual expiry day. No capacity campaign is added.
- `20261015161000_marketing_draft_revisions.sql`: atomic save with optimistic revision checks, immutable snapshots including email content, activation and role prerequisites, active graph/template protection, status-change audit and empty per-revision offer-limit approvals. Existing enrollments keep their graph; editing requires a separate draft rather than an implicit migration.
- Offer issuance requires an approved limit record for that exact revision. Unsupported percentage-as-money vouchers are denied. No limit approvals, grants, offers or activation were applied to hosted data. Failed voucher insertion no longer advances to advertising a nonexistent code.
- Unsubscribe POST locks the token and tenant-bound contact, then commits suppression, token use, event and counter in one transaction. Replay does not increment twice. Tokens are excluded from logs/event metadata. Tracking identifiers are bound to one tenant/contact/queue or enrollment before counters change.
- A new raw-body signed Resend webhook resolves suppression through an existing provider send ID, never a supplied tenant or recipient string. Configuration/secret installation is not performed. Unmatched IDs are held for reconciliation.
- Free-form WhatsApp broadcasts and the legacy automatic WhatsApp re-engagement/email-fallback path are held until channel evidence and safe dispatch support exist. Dedicated operational booking jobs remain separate and their existing tests continue to pass.

## Local trace and evidence

The trace is verified in layers, not represented as a hosted end-to-end test:

1. The existing booking/contact sync trigger stores a contact identity. A nullable booking flag or import is not turned into a permission grant. The new local PostgreSQL fixture inserts an unknown contact and proves it is absent from the campaign view.
2. An explicitly synthetic evidence event makes a same-tenant contact eligible. Suppression, an address change or ambiguous normalized duplicate overrides that eligibility. A synthetic reservation changes the prospect/welcome-back dispatch reason.
3. A synthetic enrollment reaches the actual automation handler in `marketing-dispatch-safety.test.ts`. Ineligible states exit before its injected provider adapter is invoked.
4. The actual handler reserves an intent, performs the final check, and invokes an in-memory provider stub. Its synthetic timeout produces `reconcile`; a repeated dispatch cannot call the provider again.
5. A synthetic provider ID/event is processed by the real SQL callback function. Replaying it preserves suppression and does not duplicate the receipt. Atomic unsubscribe replay records one event/counter.

The local database uses a minimal schema fixture and the actual new migrations plus the existing welcome-back migration. It proves those SQL contracts, not compatibility with every production migration, trigger, volume or hosted configuration. The existing tenant composite FK/RLS implementation was inspected; complete hosted inspect/enroll/export isolation remains a staging acceptance item.

## Requirement status

`Implemented/tested` means the stated local scope was exercised. `Observed-only` means source/UI evidence without complete acceptance proof. `Blocked` identifies a decision or source/configuration required before enabling it. A partial row is deliberately not a pass of the complete requirement.

| Workstream | Status and remaining scope |
|---|---|
| 1. Evidence inventory/plan | Implemented/tested locally; full hosted lifecycle and complete schema rollout remain blocked by staging approval. |
| 2. Permission/suppression | Implemented/tested email evidence and suppression foundation. Approved notice, legal policy, grant intake and retention decisions are blocked. WhatsApp execution is held. |
| 3. Journey safety/contracts | Implemented/tested principal email exits, final gates and durable uncertain-outcome holds. Per-recipe event/re-entry completeness and atomic offer issuance recovery remain incomplete. |
| 4. Preview/activation | Implemented/tested blank-builder browsing, synthetic preview, atomic save, revision/role checks and archive protection. Actual recipient/cost simulation for arbitrary edited graphs is not implemented. |
| 5. Operator-first experience | Implemented/tested goal-led starting point, honest audience/unknown states and practice workflow. Manual assistive-technology review and hosted acceptance remain observed-only. |
| 6. Contact/human follow-up | Implemented contact context from existing sources; source-only review for capture flows. Enquiry tasks and reliable attendance/voucher/enquiry joins are not implemented; ownership/source/retention policy remains blocked. |
| 7. Measurement/operations | Implemented delivery identity, timing explanations and suppression receipts. Booking/payment/refund attribution is missing and blocked by the model/window decision. Reconciliation tooling, sender-account verification and full crash/retry operations remain incomplete. |
| 8. Optional extensions | Blocked/deferred until P0/P1 acceptance, as requested. No capacity/pricing/WhatsApp/paid-service expansion. |

| Synthetic acceptance | Status |
|---|---|
| 1 Unknown import stored/excluded | Implemented/tested: SQL eligibility/view and campaign preflight. Full import browser upload remains observed-only. |
| 2 Suppression survives reimport/dedupe | Implemented/tested normalized opt-out delete/reimport, bounced suppression and complaint replay. Broader merge tooling is not added. |
| 3 Opt-out after enrollment/queue | Implemented/tested handler gate and SQL final handoff after reservation. |
| 4 Booking exits welcome/win-back | Implemented/tested unpaid reservations, rebooking and conservative refund handling. |
| 5 Repeat guest first offer | Implemented/tested reservation exclusion; actual issuance remains held for approved limits/semantics. |
| 6 Honest review conditions/copy | Implemented/tested shared copy, bounded recipe and browser contract preview. External review-completion source unavailable. |
| 7 Duplicate/out-of-order events | Partial: durable send/replay and provider receipt dedupe tested. Revenue/event attribution ordering is blocked and not claimed. |
| 8 Ambiguous provider retry | Implemented/tested no blind resend; manual/provider reconciliation tooling is still missing. |
| 9 Tenant inspect/enroll/export/send | Partial: existing authenticated handler negatives and new evidence RLS tested. Full browser export and all hosted paths remain observed-only. |
| 10 Non-mutating preview/open | Implemented/tested four local browser paths; no fixture writes or provider requests. |
| 11 Save versus activation | Implemented/tested atomic save/rollback, owner/read-only/revision/content prerequisites. No real journey activated. |
| 12 Marketing pause/operational isolation | Partial: gates/status audit and existing operational handler regressions tested. Complete concurrent hosted pause acceptance is outstanding. |
| 13 Frequency/quiet hours/re-entry | Partial: shared reservations, quiet hours and existing unique/anchor enrollment rules tested. General cross-journey re-entry policy is not complete. |
| 14 Timezone/DST | Partial: IANA date/year/DST calendar logic, quiet-hour and invalid-zone tests pass. Campaign datetime-local scheduling still needs operator-timezone conversion and end-to-end DST scheduling tests. |
| 15 Voucher/departure exclusions | Partial: synthetic expired/zero-balance voucher checks pass, unsupported issuance/expiry scheduling is held. Full/cancelled-departure campaigns are deferred. |
| 16 Attribution/payment/refund revenue | Blocked: no attribution model/window approved; no duplicate-revenue or incremental-impact claims. |
| 17 Truthful empty/error states | Implemented/tested zero/empty/unknown audience, provider uncertainty and unavailable voucher/review data. Broader delivery analytics remains incomplete. |
| 18 Keyboard/mobile/screen reader | Partial: keyboard selection, native semantics, accessible-name snapshot and 390px layout pass. No manual screen-reader or comprehensive WCAG audit. |
| 19 Back/cancel/edit preservation | Implemented/tested blank draft Back navigation; cached existing revisions now check server state and hold conflicts. Full multi-tab conflict browser coverage remains outstanding. |
| 20 No live recipients/data/offers | Implemented/tested by construction for this work: socket-only synthetic database with rollback, mocked edge providers and localhost-only browser routes. No hosted environment or credentials used. |

## Known limitations and release blockers

- This is a scoped local implementation, not completed P0/P1 acceptance or production readiness. Do not enable promotional traffic merely because these checks pass.
- Permission intake is intentionally unavailable without an approved notice/evidence workflow. Independent operators do not inherit one another’s permission. Repermission after suppression requires a separate approved process; imports/toggles cannot clear it.
- Broadcast email now checks permission, but still lacks the marketing workers’ durable intent/frequency mechanism. Generic human-reply messages have an operational purpose that needs a separate verified contract; this change does not claim a general legal classifier for arbitrary text.
- Send outcome persistence and legacy aggregate counters are not one transaction with Resend. A crash can leave a held intent or undercounted usage; reconciliation is needed, never a blind retry. A final gate cannot recall a message already handed to a provider.
- Offer-limit records are empty and no approval UI is supplied. Existing offer-generation steps are not yet transactionally idempotent across issuance/advancement crashes, so accepting limits and enabling issuance must wait for that remaining engine work. Percentage vouchers stay unsupported. No voucher was issued by this session.
- Existing historical journeys are not silently rewritten or backfilled with revision approval. Paused legacy journeys may require a separately reviewed draft before reactivation. Audit-bearing revisions use Archive; hard deletion is constrained. The protected review draft is guarded in UI and SQL.
- The contact timeline is a bounded read model, not an identity merge or full event ledger. It uses exact-address booking matches and explicitly lists unavailable sources. It is source-inspected/typechecked; its populated browser states are not yet tested.
- Tracking relationship binding prevents cross-tenant identifier mixing, but anonymous tracking links are not cryptographically signed and unique engagement counter races are not fully resolved. Opens are labelled approximate and never used as proof of reviews, permission or attributable revenue.
- No actual provider-account/DNS status, webhook delivery, cron schedule or sender reputation was checked. Later preflight: verify the approved sender/domain’s SPF/DKIM/DMARC status, authenticated callback configuration, suppression path, quota and credentials in a genuinely isolated environment; approve a specific harmless recipient/test separately. A payment sandbox is insufficient.
- Campaign calendar scheduling, ingestion/tag refresh observability, stale queue recovery/dead-letter operations, retention/minor policy and full assistive-technology acceptance remain outstanding. No numerical marketing improvement target is asserted without a baseline.

## Reproducible environment and commands

Workspace: `/Users/gideonlangenhoven/dev/capekayak`, branch `feature/simple-view-2026-09-20`, macOS, Node `v22.23.3`, Next `16.3.8`, PostgreSQL 17, operator zone `Africa/Johannesburg`. No dependency install or package changes were needed for this work. Existing package changes belong to the starting workspace.

```sh
# Unit verification (the existing suite skips integration-dependent cases)
npx vitest run

# Focused marketing/tenant/provider regression verification
npx vitest run tests/unit/marketing*.test.ts tests/unit/automation-copy.test.ts tests/unit/message-job-boundaries.test.ts tests/unit/db-column-refs.test.ts tests/unit/campaign-audience.test.ts

# Type checking
npx tsc --noEmit --incremental false
npx eslint app/lib/marketing-journey.ts components/marketing/GuidedMarketing.tsx 'app/marketing/contacts/[id]/page.tsx'

deno check --config supabase/functions/deno.json --node-modules-dir=none supabase/functions/marketing-dispatch/index.ts supabase/functions/marketing-automation-dispatch/index.ts supabase/functions/marketing-unsubscribe/index.ts supabase/functions/marketing-track/index.ts supabase/functions/resend-webhook/index.ts supabase/functions/broadcast/index.ts supabase/functions/auto-messages/index.ts

# Disposable database used in this session, not a hosted connection
/opt/homebrew/opt/postgresql@17/bin/initdb -D /private/tmp/capekayak-db-test-FzDVyy/data -A trust --no-locale
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/capekayak-db-test-FzDVyy/data -l /private/tmp/capekayak-db-test-FzDVyy/postgres.log -o '-k /private/tmp/capekayak-db-test-FzDVyy -p 55436 -h 127.0.0.1' start
node tests/marketing-safety-local.mjs /private/tmp/capekayak-db-test-FzDVyy 55436

# Isolated UI copy, with a minimal synthetic BusinessProvider shell
# Copies no .env files; server refuses application writes/provider calls.
node tests/helpers/marketing-preview.mjs
npx playwright test --config playwright.marketing-safety.config.ts
```

The shell sandbox denied the initial local socket/browser/listener attempts; those exact local-only commands were rerun with approved execution. No sandbox failure was worked around with production access.

Demo: [local synthetic marketing](http://127.0.0.1:3156/marketing). It is an isolated source copy under `/private/tmp/bookingtours-marketing-preview-*`, with fixture REST on port 3157. It has a simplified shell/system font and no production authentication or customer data. Restart the helper to copy the newest source after future edits. Only one instance can use those ports.

Synthetic screenshots: [audience on desktop](screenshots/audience-desktop.png), [review on mobile](screenshots/review-mobile.png), [unsaved builder](screenshots/unsaved-builder.png), [unavailable audience](screenshots/audience-unavailable.png), [recipe preview](screenshots/review-recipe.png). [Accessible-name snapshot](screenshots/guided-accessibility.txt) supports automated semantics review only.

## Separately approved rollout proposal, not executed

Prerequisites include review of the existing local `20261015140000_customer_return_history.sql` and `20261015150000_welcome_back_email_sequences.sql`; this change builds on them. The two new candidate migrations are `20261015160000_marketing_permission_safety.sql` and `20261015161000_marketing_draft_revisions.sql` in that order. Complete the blockers above before proposing any production release.

For an explicitly approved isolated staging release, the concrete deployment set is the marketing UI plus `marketing-dispatch`, `marketing-automation-dispatch`, `marketing-unsubscribe`, `marketing-track`, `resend-webhook`, `broadcast` and `auto-messages`. Use synthetic tenants and provider adapters, hold promotional job invocation, inspect migration compatibility against the full staging schema and review exclusions. Installing `RESEND_WEBHOOK_SECRET`, configuring the provider callback, DNS changes, real sends, grants, offers or activation each require the separate authorisation described in the master prompt. No such action is included in the local demo.

Rollback must preserve the new permission, delivery, revision and status evidence. Keep promotional invocation held if reverting workers/UI; do not restore an ungated dispatcher or drop suppression history. Operational booking workers and billing stay separate. UI rollback can use the scoped diff against `/private/tmp/bookingtours-marketing-baseline-20261015`; do not reset the dirty working tree.

## Current implementation file/line evidence

| Scope | Source |
|---|---|
| Permission journal | `supabase/migrations/20261015160000_marketing_permission_safety.sql:7` |
| Eligibility and ambiguity | `supabase/migrations/20261015160000_marketing_permission_safety.sql:91` |
| Campaign view | `supabase/migrations/20261015160000_marketing_permission_safety.sql:126` |
| Reservation and final handoff | `supabase/migrations/20261015160000_marketing_permission_safety.sql:217` |
| Atomic unsubscribe | `supabase/migrations/20261015160000_marketing_permission_safety.sql:305` |
| Revision snapshots/save | `supabase/migrations/20261015161000_marketing_draft_revisions.sql:70` |
| Owner offer limits | `supabase/migrations/20261015161000_marketing_draft_revisions.sql:15` |
| Activation/active revision protection | `supabase/migrations/20261015161000_marketing_draft_revisions.sql:130` |
| Webhook authentication | `supabase/functions/resend-webhook/index.ts:6` |
| Delivery adapter | `supabase/functions/_shared/marketing-delivery.ts:3` |
| Calendar semantics | `supabase/functions/_shared/marketing-calendar.ts:1` |
| Goal overview | `app/marketing/page.tsx:215` |
| Guided synthetic workflow | `components/marketing/GuidedMarketing.tsx:6` |
| Shared contract | `app/lib/marketing-journey.ts:22` |
| Builder explicit save | `app/marketing/automations/[id]/page.tsx:262` |
| Campaign permission preflight | `app/marketing/templates/page.tsx:84` |
| Contact context | `app/marketing/contacts/[id]/page.tsx:10` |
| Held legacy promotion | `supabase/functions/auto-messages/index.ts:401` |
| Database acceptance | `tests/marketing-safety-local.mjs:5` |
| Mocked real handler acceptance | `tests/unit/marketing-dispatch-safety.test.ts:6` |
| Browser acceptance | `tests/e2e/marketing-safety-mocked.spec.ts:4` |

## Verification results

- Full unit suite: **138 files passed, 2 skipped; 2,298 tests passed, 58 skipped**. Final run: 15 October 2026, 11:08:37 SAST, 30.33 seconds. Skips are reported, not counted as passes. Log: `/private/tmp/bookingtours-marketing-unit-results.log`.
- Final focused follow-up for campaign permission/preflight, pagination and safety: 12 tests passed. Earlier complete marketing/message-boundary focused run: 167 tests passed. All 89 existing message-boundary tests retained their positive and negative scenarios.
- Disposable PostgreSQL: actual candidate migrations applied and all script assertions passed, then the transaction rolled back. This includes real-role evidence RLS, unknown-contact campaign view exclusion, opt-out before handoff, reservation/refund exits, uncertain-delivery hold, provider receipt replay, unsubscribe replay, draft rollback, active-template protection and bounded offer-policy checks. No real voucher/promo was issued.
- Browser: four localhost-only tests passed against the final source copy: guided keyboard/mobile/zero/unknown flow; Back navigation preserving an unsaved draft without writes; unavailable audience; recipe browsing without persistence. Synthetic screenshots are captured with animations completed.
- `tsc --noEmit --incremental false`: passed. Deno checks for all seven changed/new function entrypoints: passed. Focused ESLint for the new UI/shared contract files: passed. `git diff --check`: passed.
- Meaningful initial failures were fixed: incorrect previous-email wording assertion now matches the actual contact-wide query; fabricated-quote placement became verified-tour-card assertions; pagination fixtures now represent permission-filtered contacts; handler fixtures explicitly supply permission/offer approvals and the new durable delivery dependency. Existing negative cases remain. Browser alert selection was narrowed to avoid matching Next’s separate route announcer. Initial sandbox launch/socket failures were environmental and separately rerun with approved local access.
- No production build, hosted migration compatibility test, provider send, real deliverability test, production load test or manual screen-reader test was performed. These results do not establish production readiness.

The disposable PostgreSQL server was stopped after validation. The isolated synthetic UI remains available on port 3156; no local database is needed for that demonstration.
