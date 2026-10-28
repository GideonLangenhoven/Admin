# Go-live bug fixes: report, 27 Oct 2026

Scope: P0 H1 to H7 and H2b, P1 M1 to M13, the P2 batch, the Section 5 security
review and the Section 6 regression checklist, as briefed on 27 Oct.

**Production is untouched.** Only read-only queries ran against it. Every fix is
committed on two local, unpushed branches and waits for approval to apply and
deploy (see "Awaiting approval" at the end). "Fixed" below means committed with
a test that fails before and passes after; nothing reaches operators until that
deploy.

| Repo | Branch | Worktree | Commits |
| --- | --- | --- | --- |
| Admin + edge functions + migrations | `golive/fixes-2026-10-27` | `../capekayak-golive` | 49 fixes, `f309605..8ce565b`, plus this report |
| Booking site | `golive/fixes-2026-10-27` | `../booking-golive` | 6, `4dbe52a..4da7c8a` |

Every commit message names the bug ID, the root cause, the fix and the test,
with the before and after result.

## 1. Summary table

Roles: only H3 and M13 depended on role (both broke for a SUPER_ADMIN switched
into a tenant, and worked for the tenant's own admin). Both are tested as a
tenant admin and as a super-admin. Every other bug ran the same code for both
roles.

"Fails before, passes after" means the test was run against the old code and
failed with the reported symptom, then passed with the fix.

### P0

| ID | Root cause (file / function / policy) | Fix | Test added | Verified how | Status |
| --- | --- | --- | --- | --- | --- |
| H1 | `app/bookings/page.tsx` saveEditBooking wrote `bookings.qty` and `total_amount` from the browser. The ACTIVE hold and `slots.held` kept the old qty, so `create-checkout` (via `create_hold_with_capacity_check`) answered 409, and Payment Link showed only supabase-js's generic non-2xx text. | Guest-count changes go through `rebook-booking` ADD_GUESTS / REMOVE_GUESTS: re-hold with a capacity check and recompute the total in one transaction. A refusal is shown in red and nothing else is saved. `app/lib/function-error.ts` shows the server's reason, never raw database text. `create-checkout` returns an error code and a human reason. | `tests/unit/function-error.test.ts`, `tests/e2e/edit-booking-qty.spec.ts` | e2e at 662×555 fails before (the exact QA symptom), passes after. | Fixed (bc8d4de). Not deployed. |
| H2 | `app/bookings/page.tsx` "Refund & cancel" PATCHed `bookings` directly for any booking without a Yoco checkout, and always said "Refund processed". `process-refund` sent no email for pending or bank-transfer refunds, and wrote no timeline entry. | Always `process-refund`. `reserve_refund_request` and `cancel_booking_transaction` cancel, release seats and record the refund in one transaction, then a Yoco refund runs or a bank-transfer task is created. "Refund processed" only when the provider confirms, otherwise "Refund pending". One guest email per change, claimed in `idempotency_keys`, plus timeline entries. Column privileges: the browser can no longer UPDATE `bookings.status` or `refund_*`. Refunds "Decline" moved to `decline_refund_request` and voucher "Apply code" to `apply_booking_voucher` (both RPCs). | `tests/unit/refund-cancel-notice-runtime.test.ts`, `tests/e2e/refund-cancel.spec.ts`, `tests/booking-status-grants-local.mjs` | Unit and e2e fail before, pass after. Grants checked on local Postgres and on a replica of the live schema. A real Yoco sandbox refund is part of the live run. | Fixed (5939b56, e15a613). Migration 150000 awaits approval. |
| H2b | `slots.booked` and `slots.held` were counters each writer kept by hand. About a dozen paths skipped them: admin edit and refund, combo cancel, payment auto-expire, the WhatsApp and rebook cancel handlers (which double-decremented), the external booking API and voucher apply. Decrements clamped at zero, so over-counts stuck. | Deferred constraint triggers recount each touched slot at commit. `booked` is the qty of PAID, CONFIRMED and COMPLETED bookings. `held` is the qty of ACTIVE holds plus ACTIVE OTA reservations (8ce565b; OTA keeps its own reservation table). `adjust_slot_capacity` recounts. The browser loses UPDATE on the counters. `scripts/reconcile-slot-counters.mjs` reports drift (dry run by default) or repairs it with `--apply`. `cron-tasks` checks future slots every run and fails its Sentry check-in on drift. | `tests/slot-counters-local.mjs` (covers concurrent commits and OTA reservations) | Local Postgres. Replica run through hold, mark-paid and cancel with zero drift. Read-only production dry run finds 13 slots, all of them over-counted: [h2b-slot-counter-dry-run.txt](h2b-slot-counter-dry-run.txt) (re-run today, same 13). | Fixed (886fc84, 8ce565b). Migration 140000 and `--apply` await approval. |
| H3 | The `peak_periods_tenant` and `peak_period_prices_tenant` policies took the tenant from `admin_users.business_id`, which is Platform Administration for a super-admin. They were FOR ALL with no WITH CHECK, and the page showed the RLS error in green. `chat_faq_entries`, `data_subject_requests` and `pii_anonymization_log` used the same pattern. | All five use `current_business_ids()` with an explicit WITH CHECK, for authenticated only. `save_peak_period` and `delete_peak_period` change the period, its tour prices and the slot prices in one transaction. A BEFORE INSERT trigger prices slots created later inside a period. Errors are red and friendly. Periods can be edited. | `tests/peak-pricing-local.mjs` | Reproduces the RLS refusal, then create, edit and delete as super-admin and tenant admin, local-date slot pricing, and tenant B and anon refused. | Fixed (3d32b84, c56ab5b). Migration 130000 awaits approval. |
| H4 | `app/invoices/page.tsx` trusted the invoice's own payment method, which stays "Pending" after a cancel. Cancelled bookings were therefore shown as due and counted in Outstanding. | Status, paid and due come from the booking through a new `invoiceState`, built on the tested report-accounting helpers: PAID, PARTIALLY PAID, UNPAID, CANCELLED, REFUNDED or PARTIALLY REFUNDED. Outstanding leaves cancelled bookings out. The booking lookup is scoped by business_id. Resend refuses a cancelled unpaid booking. The title is "Invoices". There is no void or credit-note record, so VOIDED is not a state. | `invoiceState` table in `tests/unit/report-accounting.test.ts`, `tests/e2e/invoices-status.spec.ts` | Unit covers every status combination. e2e fails before (Outstanding R1 840 for the fixture), passes after. | Fixed (2bcdc94). Not deployed. |
| H5 | The `broadcast` function refused every request (a closeout hold on free-form promotion), and the page always asked for WhatsApp. | A broadcast is now a per-channel trip update to guests on the operator's own departures. Email goes per guest through `notification_jobs`, so it is retried, appears in the delivery log, and lands under Failed Notifications if it never sends. WhatsApp goes only to opted-in guests on a connected number; everyone else is skipped with a reason. A `broadcast_id` dedupes retries. The result reads like "1 email queued. Skipped 1 WhatsApp: WhatsApp not connected." The editor label is retitled. | `tests/unit/broadcast-departure-runtime.test.ts`, `tests/unit/broadcasts-page-send.test.ts`, `tests/e2e/broadcasts-departure.spec.ts` | The real handler in unit tests; e2e on the operator preview. | Fixed (5fff51d, ca33156, b124f83). Not deployed. |
| H6 | Add New Slots, Cancel Day and Reopen Day were overflow-visible. Other modals capped at 90vh or clipped. A price override the number input could not parse saved the slot at the tour price. | All modals cap at 100dvh minus a margin and scroll inside. Add New Slots pins its actions and says why Create Slots is disabled. An unparseable override is rejected. | `tests/e2e/modal-viewport.spec.ts` | Fills and submits Add New Slots at 375×667 and 662×555, then checks the written price. Other modals share the cap, but no test drives each one. | Fixed (5914fcb). Not deployed. |
| H7 | The Refunds queue, `get_operator_dashboard` refund_summary and the sidebar badge all left out `refund_status = ACTION_REQUIRED`. That hid 15 live bookings, including R1 500 in QA. | A "Waiting for a decision" section with Refund now, Issue voucher and Resend options. The dashboard and badge include it. One automatic options reminder goes out after 3 days, claimed once, with a timeline entry. | `tests/unit/refund-choice-reminder-runtime.test.ts`, `tests/e2e/refunds-awaiting.spec.ts` | Unit and e2e fail before, pass after. Replica dashboard: 1 / R300 before, 2 / R1 800 after. | Fixed (e5e1ebb, b6dbcce). Migration 160000 awaits approval. |

### P1

| ID | Root cause | Fix | Test added | Verified how | Status |
| --- | --- | --- | --- | --- | --- |
| M1 | `rebook-booking` priced the new departure at list price × qty, and the dialog's browser-side preview did the same, ignoring an override's or promo's agreed total. | Carries the agreed difference onto the new list price as one total, so no rounding cents appear. `reprice: true` is for admins only. The server returns a preview with its breakdown and a "charge list price" option. | `tests/unit/rebook-agreed-price.test.ts` (6), `tests/e2e/rebook-price-preview.spec.ts` | All fail before, pass after. | Fixed (fb061dc). |
| M2 | Mark Paid had no amount, method or reference, and always sent BOOKING_CONFIRM. `send-email` deduplicated confirmations only for service callers, so an admin confirm followed by Mark Paid sent two (df013e88, 6 minutes apart). | Every BOOKING_CONFIRM goes through one `booking-confirmation/<id>` job. `manual-mark-paid` takes an amount (deposits allowed), method, reference and the amount the operator saw. An already-confirmed booking gets a receipt instead. `account_manual_booking` records part-payments. Shared MarkPaidDialog. | `tests/unit/manual-mark-paid-amount.test.ts`, M2 block in `tests/unit/message-job-boundaries.test.ts`, `tests/e2e/mark-paid-dialog.spec.ts` (4) | Fail before, pass after. Replica flow and drift check. | Fixed (c782355, d8f8e85). Migration 170000 awaits approval. |
| M3 | The booking page hard-coded two buttons that showed only for PENDING bookings. The list built its own actions inline. | `app/lib/booking-action-registry.ts` drives both. Mark Paid and Payment Link run in place; other actions open the list focused on the booking. | `tests/unit/booking-action-registry.test.ts`, `tests/e2e/booking-page-actions.spec.ts` | Fail before, pass after. | Fixed (58f5406). |
| M4 | The Edit booking modal offered every status and wrote it to `bookings.status`. | Status is shown read-only with a pointer to Guest actions, and is never in the payload. H2's column privileges also refuse it server-side. | Case in `tests/e2e/edit-booking-qty.spec.ts` | Fails before (one status combobox). | Fixed (58026f5). |
| M5 | Settings saved `ai_system_prompt` as `value \|\| null` into a `text NOT NULL DEFAULT ''` column, and toasted the raw Postgres text. | Saves the trimmed prompt, "" when cleared. A friendly error, with the detail logged to the console. | `tests/e2e/ai-prompt-clear.spec.ts` | Fails before, passes after. | Fixed (f65a11a). |
| M6 | The public site had no contact block at all, so the web-chat handoff pointed guests to contact details that didn't exist. The hero subtitle is hidden by design when there is no title. | Footer "Contact us" block with mailto, tel and wa.me links on every page (booking repo 045fd68). The handoff names the saved phone, WhatsApp and email. Settings explains the subtitle rule. No `/contact` page, since the footer is on every page. | `tests/unit/booking-footer-contact.test.ts`, `tests/unit/web-chat-handoff-contact.test.ts`, `tests/e2e/hero-subtitle-hint.spec.ts` | Unit and e2e. | Fixed (c7cd263, booking 045fd68). |
| M7 | The booking page labelled a future deadline with `timeAgo()`. The negative difference read "just now". | A shared PaymentExpiryBadge counts down, with days ("Expires in 2d 3h"). The timezone handling was already correct. | `tests/e2e/payment-hold-label.spec.ts` | Fails before, passes after. | Fixed (058cdc7). |
| M8 | `send-email` titled every booking invoice "Tax Invoice". When a confirmed booking was paid by link, `yoco-webhook` sent a second BOOKING_CONFIRM, which was swallowed, instead of an invoice. | "Pro Forma Invoice" while money is due, "Tax Invoice" once paid in full. The webhook sends the INVOICE to already-confirmed bookings. | `tests/unit/pro-forma-invoice.test.ts` | Unit. | Fixed (bfab07f). |
| M9 | Gross left out cancelled bookings, while Received kept money taken on them (R20 360 for Kayak). Attendance counted upcoming guests as not arrived. | Gross is every booking in the period, which matches the Total Due column. A note and tooltips define each figure. Upcoming guests get their own tile, and the attendance rate covers only guests who were due. | `tests/e2e/reports-reconcile.spec.ts`, `tests/unit/report-accounting.test.ts` | e2e. | Fixed (72820a1). |
| M10 | Slot totals skip HELD bookings by design. | A separate "2 held · R1 800,00 pending" line on phones and desktops. | `tests/e2e/held-departure-header.spec.ts` | e2e. | Fixed (83b8217). |
| M11 | Partly intended: `send-email` did send the weather variant, but with the general subject and heading and a single "Manage My Booking" button. Kayak's weather banner is a recolour of its general one. | The email has its own subject and heading ("Trip Cancelled due to Weather") and one button per option (new date, voucher, refund). My Bookings has no per-option deep links, so each button opens My Bookings. | `tests/unit/weather-cancel-email.test.ts` | Unit. | Fixed (6da7a8f). |
| M12 | The refund tiers, summary and weather rule never reached the bot prompts. The help docs described Edit Booking fields that don't exist. The help panel closed on navigation below 1024px. | `_shared/bot-prompt.ts` formats the policy for web chat and both WhatsApp prompts, and the WhatsApp "Cancellation Policy" button answers from it. The docs point to Mark Paid and to the Cancellation Policy setting. The panel stays open. | `tests/unit/bot-cancellation-policy.test.ts`, `tests/unit/admin-help-payments-policy.test.ts`, `tests/e2e/help-panel-stays-open.spec.ts` | Unit and e2e. The assistant sees the new docs only after `scripts/sync-admin-help.mjs`, which writes to production. | Fixed (042f8f0). KB sync awaits approval. |
| M13 | Settings set its role from localStorage and fetched in the same effect, so the closure still saw role as null and left out `x-admin-business-id`. bank-details requires that header from a SUPER_ADMIN, so 26 of 26 calls on 27 Oct returned 403. The Invoices page never sent it. Tenant admins were unaffected. | Both pages always send the header; the function reads it only for super-admins. A failed load is red and locks the fields, so a save can't blank the stored details. A failed save shows the function's message. | `tests/e2e/bank-details-settings.spec.ts` (5) | Super-admin cases fail before, pass after. The tenant-admin control passes both times. | Fixed (de5c431). |

### P2

| ID | Root cause | Fix | Test added | Verified how | Status |
| --- | --- | --- | --- | --- | --- |
| Billing "This month" | `periodBounds` anchored every period on `subscriptions.period_start`, the signup date. | Open-ended subscriptions bill by calendar month. | `tests/unit/billing-seats.test.ts` | Pinned clock. | Fixed (98e606c). |
| Copy: plurals, "vipstarts" | Counts were glued to plural nouns, and a space was missing after `<strong>`. | The existing `pluralize` helper now covers about 13 screens, and the space is restored. "Send to 1 Customers" disappeared with H5. | None new | tsc and unit. | Fixed (3352fd3). |
| Money format | Each page formatted amounts its own way: toFixed, browser locale or raw numbers. | `formatZar` (`app/lib/money.ts`) renders "R1 200,00" on admin screens. | `tests/unit/money-format.test.ts` (59 hand-formatted lines before, 0 after) | Unit. | Fixed (d2cad6f). The booking site, emails and WhatsApp are still to do (see Polish). |
| New Booking | The capacity check ran before any choices were made. An invalid email was reported as missing. The highlight message outlived the fix. Walk-ins defaulted to Request payment. | Messages wait for an activity, guests and departures. "Enter a valid email". The message shows only while a field is highlighted. Walk-ins start at Payment received. Defaulting the date to the day being viewed is intended. | None | tsc. `operator-usability-mocked` gives the same results with and without the change; its 5 failures predate it. | Fixed (798a78b). No regression test. |
| Slots | The status label read only `slots.status`. DatePicker had no minimum date. | "Departed: no longer taking bookings", with Close and Reopen hidden. Past days are disabled. The end picker opens on the start date's month. Past departures are skipped. | `tests/e2e/slots-departed-and-dates.spec.ts` | Fails before, passes after. | Fixed (a4ecfec). |
| Peak pricing polish | The per-tour input used the tour's standard peak price as its value. "Save tour prices" ignored errors. | The input starts blank, with the standard price as placeholder. A toast confirms the save, or names the tours that failed. Updates are scoped by business. | `tests/e2e/peak-pricing-polish.spec.ts` | Fails before, passes after. | Fixed (c80aa4b). |
| Booking site (5 items) | Chat launcher over the sticky checkout bar. Pay disabled with no reason given. The resume banner offered any draft. Tour cards ignored deal prices. Gift-voucher cancel used booking copy. | Booking repo d3f1a16, 70acacd, 22fbb23, ebad5bd and 4da7c8a, plus the admin `Catalogue.tsx` mirror (5641463). | `tests/e2e/booking-site-polish.spec.ts` (6) | All five fail on the old booking code and pass on the new. | Fixed. Not deployed. |
| Tours | "Book Page" linked to `booking_site_url`. Deactivate and Hide took one click. | Deep link to `/book?tour=<id>`. Both actions ask for confirmation. Plain error toasts. Updates scoped by business. | `tests/e2e/tour-actions-confirm.spec.ts` | Fails before, passes after. | Fixed (add3458). Child pricing and per-tour add-ons are feature requests. |
| Activity Timeline | Guest messages were never logged. | `send-email` logs `email_sent` and `recordWaMessage` logs `whatsapp_sent`, each with type, recipient and provider ID. | `supabase/functions/_shared/wa-timeline.test.ts` (Deno), `tests/e2e/timeline-messages.spec.ts` | Fail before, pass after. | Fixed (a70c157). |
| Holds with no message | Edit and rebook notices ignored that the guest had never been told about the booking. | A shared `guestNeverContacted` guard in the list edit, the booking-page edit and `rebook-booking`. | `tests/e2e/held-no-message.spec.ts` | Fails before, passes after. | Fixed (6902b82, 6f40ab5). |
| Directions | RichTextEditor saved "<br>" for a cleared field. | Empty markup saves as "". `scripts/repair-empty-rich-text.mjs` reports (dry run by default) or repairs. | `tests/e2e/rich-text-cleared.spec.ts`, `tests/empty-rich-text-local.mjs` | Production dry run: Kayak and Aonyx directions are "<br>": [directions-empty-rich-text-dry-run.txt](directions-empty-rich-text-dry-run.txt). | Fixed (c8fc263). `--apply` awaits approval. |
| Inbox | The handoff reason in `current_intent` was never cleared when the bot took over again. | The reason shows only while a reply is needed, in words. The admin-reply status update is scoped by business. | `tests/e2e/inbox-handoff-badge.spec.ts` | e2e. The 5 s load did not reproduce: the list request answers in about 170 ms, and the wait is the app-wide auth and business lookup. | Fixed (c0081e9). |
| Accessibility | 80 Settings controls had no accessible name. | htmlFor/id pairs, aria-labels, and labelled rich-text editors. | `tests/e2e/settings-labels.spec.ts` (80 before, 0 after) | e2e. | Fixed (5748529). |
| Cron | `gyg-availability-hourly` still ran while OTA is blocked, returning 503 every hour. Its sibling jobs were paused outside migrations. | A migration pauses all three OTA jobs. | `tests/ota-cron-pause-local.mjs` | Local Postgres with a pg_cron stub. | Fixed (f3bc98e). Migration 190000 awaits approval. |

### Section 5: security and hardening

| ID | Finding | Fix or decision | Test added | Verified how | Status |
| --- | --- | --- | --- | --- | --- |
| S5 definer EXECUTE | Supabase's default grants left 32 SECURITY DEFINER functions executable by anon and 54 by authenticated. | Each function was traced to its callers. 16 that only edge functions use, or nothing uses, are now service_role only, including `create_hold_with_capacity_check`, `increment_marketing_email_usage` and `deduct_voucher_balance`. 6 that only the admin app or customer login use lose anon, and `apply_promo_code`, `increment_automation_counter` and `next_invoice_number` now act only within `current_business_ids()`. 8 trigger functions are revoked. Anon keeps `current_business_ids`, `sign_waiver` (token-gated) and `validate_promo_code` (now rate-limited). Of the 23 that signed-in users can still run, all derive the tenant from the session except `sign_waiver` and `validate_promo_code`. | `tests/definer-execute-local.mjs` | Reproduces anon EXECUTE and a cross-tenant `next_invoice_number`, then checks every grant and guard. | Fixed (65471ac). Migration 180000 awaits approval. |
| S5 search_path | 6 functions had a mutable search_path. | Pinned to `public, extensions, pg_temp`. | In `definer-execute-local` | Local Postgres and replica. | Fixed (in 180000). |
| S5 policy-less tables | 26 tables have RLS enabled and no policies. | 25 are confirmed service-role only: no browser query touches them, and the API routes use the service key. The exception is `combo_settlements`, which Reports reads from the browser, so its export is always empty (see Found but not fixed). | None | Code search and live grants. | Reviewed. |
| S5 auth | Leaked-password protection is off; MFA options are thin. | Not changed: both are Auth dashboard settings, and production is paused. TOTP at aal2 is already enforced server-side for credential and platform-settings saves (`app/lib/mfa-sensitive.ts`). | None | Advisor and code. | Owner action (see Awaiting approval). |
| S5 pg_net | The extension is registered in `public`. | Kept. Its objects live in schema `net`; moving it means drop and recreate, which breaks the 11 cron jobs that call `net.http_*`. | None | Live catalog. | Kept as is. |
| S5 checkout holds | After 180000, anon can't call the hold RPC, but `create-checkout` and `create-paysafe-checkout` still let one visitor start unlimited seat-holding checkouts. | Per-IP bucket (`check_rate_limit`): 10 new checkouts a minute, answered with 429 and a guest-readable reason before pricing or any hold. Operators and the bots are not counted. | `tests/unit/checkout-rate-limit.test.ts` | 2 of 3 fail before, all pass after. | Fixed (769e40a). Residual risk under Found but not fixed, item 3. |
| S5 promo oracle | `validate_promo_code` is open to anon on purpose and was unthrottled, allowing code guessing and probing which emails had used a code. | The same per-IP bucket: 30 checks a minute for browser callers. service_role is not counted. | `tests/promo-rate-limit-local.mjs` | 31 unlimited guesses before; the 31st is refused after. | Fixed (e057e88). Migration 200000 awaits approval. |
| Re-verify: weather cancel | No test pinned the earlier tenant fix. | No change needed. | `tests/unit/weather-cancel-tenant-scope.test.ts` | Another tenant's admin gets 403 before any read. Every query, insert and RPC is scoped to the caller's business. | Verified (d86ddfe). |
| Re-verify: subscription | n/a | No change needed. | Existing `subscription-fail-closed` and `subscription-gate` tests | Pass. | Verified. |
| Re-verify: cron | `cleanupExpiredManualBookings`, `completePastBookings` and `processPOPIARequests` never read `error`, and `cleanupStaleDraftBookings` logged it and returned. Errors printed as "[object Object]". | The four steps throw, and one `errorText()` helper formats errors. | `tests/unit/cron-failure-reporting.test.ts` | The outage case fails before (9 of 13 steps reported, as "[object Object]") and passes after. | Fixed (49ce358). |
| Re-verify: branding | n/a | No change needed. | Existing `no-tenant-brand-leak` test | Passes. | Verified. |

### Section 6, item 9

| ID | Root cause | Fix | Test added | Verified how | Status |
| --- | --- | --- | --- | --- | --- |
| Paid after cancel | Nothing was broken, but no test covered it. | No change: `confirm_booking_payment` answers `bad_status`, and `yoco-webhook` records an unfulfilled payment and refunds it in full without marking the booking PAID. | Case in `tests/unit/payment-idempotency-hardening.test.ts` | A mutation that drops `bad_status` from the refund list makes it fail. | Verified (2b840f4). |

## 2. Migrations and data repairs (applied 28 Oct, except Directions)

| Order | File | For | Local test |
| --- | --- | --- | --- |
| 1 | `20261027130000_peak_pricing_tenant_access.sql` | H3 | `tests/peak-pricing-local.mjs` |
| 2 | `20261027140000_slot_counters_derived.sql` | H2b | `tests/slot-counters-local.mjs` |
| 3 | `20261027150000_booking_status_server_only.sql` | H2 | `tests/booking-status-grants-local.mjs` |
| 4 | `20261027160000_refunds_awaiting_choice_visible.sql` | H7 | replica |
| 5 | `20261027170000_manual_payment_amount.sql` | M2 | replica |
| 6 | `20261027180000_definer_execute_hardening.sql` | S5 | `tests/definer-execute-local.mjs` |
| 7 | `20261027190000_pause_ota_crons.sql` | P2 Cron | `tests/ota-cron-pause-local.mjs` |
| 8 | `20261027200000_validate_promo_code_rate_limit.sql` | S5 | `tests/promo-rate-limit-local.mjs` |

All eight apply in order on a schema-only replica of production, and
`check-security-drift` passes there (1429 grants, 108 tables, 244 policies).
The replica needed two local stand-ins: pgvector isn't installed, so 180000 ran
with `text` in place of `extensions.vector` (production's signatures were
confirmed with `to_regprocedure`), and pg_cron is a stub table.

`supabase/security-baseline.json` on this branch describes the state after
these migrations, so the drift check fails against production until they are
applied, and must pass right after. Applied to production on 28 Oct at 05:04
UTC; the drift check passes there (1429 grants, 108 tables, 244 policies).

Data repairs, both with a dry run that changes nothing:

- H2b slot counters: [h2b-slot-counter-dry-run.txt](h2b-slot-counter-dry-run.txt).
  13 slots, every change lowers a counter, none ends above capacity.
  Applied 28 Oct: the same 13 slots re-synced, no drift after.
- Directions "<br>": [directions-empty-rich-text-dry-run.txt](directions-empty-rich-text-dry-run.txt).
  Kayak and Aonyx, set to NULL. Not applied yet (section 5).

## 3. Section 6 regression checklist

The live run (a test tenant in Yoco test mode, as tenant ADMIN and SUPER_ADMIN)
needs the deploy, so it waits for approval. Until then, each item is covered
locally as follows.

| # | Check | Local coverage |
| --- | --- | --- |
| 1 | Tour with image, deal, auto slots, on the booking site | `last-minute-deals`, `modal-viewport`, `slots-departed-and-dates`, `tour-actions-confirm`, `booking-site-polish` |
| 2 | Admin booking with each payment action | `payment-link-optin`, `mark-paid-dialog`, `manual-mark-paid-amount` (New Booking messages: no test) |
| 3 | Public booking to PAID, emails, invoice | `booking-success-access`, `booking-custom-questions`, `checkout-rate-limit`, `payment-idempotency-hardening` |
| 4 | Abandoned at Yoco, hold expiry | `hold-expiry-capacity`, `slot-counters-local`, `booking-site-polish` (voucher /cancelled) |
| 5 | Qty up and down, then Payment Link | `edit-booking-qty` |
| 6 | Mark Paid partial and full, no duplicate confirmation | `mark-paid-dialog`, `manual-mark-paid-amount`, `message-job-boundaries` |
| 7 | Rebook cheaper and dearer, with and without override | `rebook-agreed-price`, `rebook-price-preview` |
| 8 | Cancel, refund and cancel, weather cancel | `refund-cancel` (e2e), `refund-cancel-notice-runtime`, `cancellation-notification-only`, `weather-cancel-email`, `weather-cancel-tenant-scope`, `refunds-awaiting` |
| 9 | Pay a link after cancellation | `payment-idempotency-hardening` (new case) |
| 10 | Peak period create, edit and delete; site price | `peak-pricing-local`, `peak-pricing-polish` |
| 11 | Email-only broadcast with WhatsApp disconnected | `broadcasts-departure`, `broadcast-departure-runtime` |
| 12 | Invoice totals per booking state | `invoices-status`, `report-accounting` |
| 13 | Modals at 375×667 | `modal-viewport` drives Add New Slots; the other modals share the cap |
| 14 | Chatbot: prices, policy, weather, handoff, back to bot | `bot-cancellation-policy`, `web-chat-handoff-contact`, `bot-mode-resume` |
| 15 | Capacity invariant, zero drift | `slot-counters-local`, replica chain; production reaches zero only after 140000 and `--apply` |

### Gates at 8ce565b

- `npx tsc --noEmit`: exit 0.
- `deno check`: passes for all 37 edge functions that changed or import a changed `_shared` module.
- `npx vitest run tests/unit`: 2735 passed, 8 failed. All 8 also fail without
  this branch's changes: `cancellation-notification-only` (expects no "Contact
  operator", added in booking 6486919 on 21 Oct), `db-column-refs`
  (`payment_recovery_bookings` fixture), `demo-action-guide`
  (`slot.close-weekdays` unexplained), `goal-items-26-30` item 30 (stale source
  string), `mobile-first-implementation` (MobileMenuDrawer), and `rls-initplan`
  ×3 (`guide_accounts`, `booking_arrival_approvals`, `operator_booking_requests`).
- e2e: all 24 admin specs pass on the operator preview, and `booking-site-polish`
  (6) passes on the booking preview. The two commits after that run change no UI.
- 7 local Postgres tests pass. All 8 migrations apply on the replica, and the
  drift check passes there.

### Gates at 7cfbbf9 (deployed)

- `npx tsc --noEmit`, `npm run check:edge`, and the admin and booking
  production builds: pass.
- `npx vitest run tests/unit`: 2735 passed, the same 8 failed.
- `npm run lint`: 6 errors, 253 warnings. All 6 errors are in test helpers that
  no commit on this branch touched, and `tests/` never deploys: `prefer-const`
  in `tests/helpers/admin-contact-preview.cjs`, `tests/helpers/marketing-preview.mjs`,
  `tests/helpers/operator-preview.mjs` (×2) and `tests/marketing-safety-local.mjs`,
  and `no-assign-module-variable` in `tests/unit/browser-session.test.ts`.
- The owner signed off on deferring these 14 (8 unit, 6 lint) on 28 Oct.

## 4. Found but not fixed

### Before go-live

1. **Super-admin tenant access isn't audited.** `current_business_ids()`, now
   also behind H3's policies, gives a SUPER_ADMIN every tenant, and nothing
   records which tenant they acted in. Next: write an audit row on each tenant
   switch and on writes made under `x-admin-business-id`, or scope a
   super-admin to one "acting tenant" that only an audited RPC sets.
2. **Per-IP limits trust the first `X-Forwarded-For` hop.** This applies to
   `getClientIp` and the new `validate_promo_code` check. If Supabase's gateway
   passes a client-set header through, a script can rotate it and dodge the OTP,
   onboarding, web-chat, checkout and promo limits. Next: after deploy, send a
   forged header to a test function and log what arrives. If it is forgeable,
   read the gateway-appended hop (or `cf-connecting-ip`) in both places.
3. **One checkout can still hold a whole departure.** That's up to 50 seats, for
   the 15-minute hold plus grace, 10 times a minute per IP. Next: a bot
   challenge on storefront checkout (Vercel BotID or Turnstile), plus a
   per-tenant maximum party size for web bookings.
4. **The promo branch of the booking page's "Apply code" writes
   `bookings.total_amount` from the browser.** H2 moved the voucher branch to an
   RPC. Next: an `apply_booking_promo` RPC of the same shape.
5. **`toggleAllowUnpaid` writes `bookings.allow_unpaid` from the browser and
   shows raw errors.** Next: a friendly error, and move it into an RPC.
6. **The `ck_external_*` functions are executable by anon and authenticated.**
   They are SECURITY INVOKER, so RLS bounds them, and only `external-booking`
   (service_role) calls them. Next: revoke EXECUTE from anon and authenticated.
7. **Operators can't void an outstanding payment link.** Once a link is out,
   H1's server check refuses guest-count changes until the link expires. Next:
   a "Void payment link" guest action that clears `payment_url` and expires the
   Yoco checkout.
8. **`weather-cancel` returns the raw `err.message` in its 500.** Next: a
   generic message, with the detail in the logs.
9. **Auth settings.** Next: enable leaked-password protection. Require aal2 for
   SUPER_ADMIN sessions (ideally MAIN_ADMIN too) and offer a second factor type.

### Soon after go-live

- **Confirmations are delayed.** Since M2, admin confirmations wait for the next
  queue drain, up to about 5 minutes, and web-chat "Resend confirmation" is
  deduplicated by the same key. Next: drain that booking's job straight after
  enqueueing it, and give explicit resends their own key.
- **Combo hold rows are inserted after `reserve_combo_capacity`, in a separate
  call.** If that insert fails, the seats stay counted until the next recount,
  and the drift monitor flags it. Next: insert the hold rows inside the RPC.
- **The combo settlements register is always empty.** Reports reads
  `combo_settlements` from the browser, and RLS denies it. Production has 0
  combo bookings today. Next: serve the register from `/api/combo-settlements`
  for either party's business.
- **Claire's Hiking booking a0cb69e2 is HELD with an expired hold.** Next:
  after 140000 and the reconcile, check whether cron expires it; if not, the
  operator cancels it.
- **Refunds and the stale refund note.** `reserve_refund_request` leaves the
  note "Customer to choose…" on refunds the operator starts. A fully
  voucher-funded booking can't be refunded from the bookings dialog, although
  `process-refund` supports a voucher reissue. BOOKING_UPDATED refund notices
  show a "New Date & Time" label. Next: fix each in place.
- **Invoice state outside the Invoices page.** Mark Paid's invoice shows R0 paid
  for a fully voucher-paid booking. Other `send-email` INVOICE callers can show
  money due on a cancelled booking. The Reports invoice register exports the
  raw status. Next: use `invoiceState` everywhere.
- **No online balance payment for part-paid bookings.**
  `prepare_booking_checkout` refuses a balance link for a part-paid booking
  (M2's design), and the refusal wording could reach a guest. Next: issue
  balance links for `expected_amount_cents`, with guest-safe wording.
- **Wording and notice gaps.** A WhatsApp-only guest whose confirmed booking is
  paid by link still reads "Booking confirmed". PAID and CONFIRMED admin
  bookings created with messages unticked still get "Booking Updated" on edit
  (the P2 guard covers unpaid holds only). Next: store the "don't message"
  choice on the booking and honour it everywhere.
- **The auto-messages run summary loses counts.** `results.x += await f()` loses
  counts when tenants run concurrently; this affects reporting only, not sends.
  Next: `const n = await f(); results.x += n;`.
- **Raw error text is still shown in four places.** The slots page
  (`describeFnError`), the Invoices resend catch, the super-admin business save
  and add-on delete. Next: route each through `functionError` or a plain message.
- **Small gaps from this round.** The Invoices page doesn't show a bank-details
  load failure (Settings does, since M13). The day Totals row has no held
  figure (M10). The compact booking row has no expiry badge (M7). My Bookings
  has no per-option deep links (M11). Bookings-tab revenue and Financials still
  use different definitions (M9).
- **Hygiene.** The booking-detail logs query lacks `.eq("business_id")`; RLS
  covers it, but the convention requires it. The booking site still sends
  client-side money fields, which a trigger strips. Next: add the filter and
  stop sending the fields.
- **Decisions needed on H5.** Should trip-update broadcasts honour marketing
  unsubscribes, or only explicit email unsubscribes as today? WhatsApp
  departure broadcasts send immediately, with no confirm step.
- **Performance.** `slot_counter_drift` scans every future slot each 5-minute
  run; that is fine now, but it grows with tenants. Inbox polling uses
  `select *`. The AuthGate lookup waterfall is the real cause of slow first
  loads. Next: one performance pass.
- **Help chat.** HelpChat unmounts in some page shells. Next: mount it once in
  the root layout.
- **Billing.** Seat proration may still anchor to `period_start`. Next: add a
  proration case to `billing-seats.test.ts`.

### Polish and test debt

- **Copy.** "seat(s)", the "Escalate human" label, inconsistent card wording,
  the generic broadcast email header and the truncated invoice Ref field. The
  booking site's `R{x}` amounts and the email and WhatsApp money formats are
  not on the shared format yet.
- **Tests.** The 8 pre-existing unit failures listed under Gates.
  `booking-guest.spec.ts` has 6 pre-existing failures, and
  `operator-usability-mocked` has 5. The payment-idempotency "no_capacity →
  503" case passes only because its fixture's `record_unfulfilled_payment`
  fails, so its name overstates it. Only Add New Slots is driven at 375×667.
- **Dead code and tooling.** `reschedule-price.ts` is unused. The main repo's
  `node_modules` lacks the SWC binary (`npm ci` fixes it).
- **By design or feature requests.** Child pricing and per-tour add-on
  assignment are feature requests. The phone chat launcher is hidden during
  booking checkout by design, and the footer carries the contact details.
- **Optional hardening.** Revoke the anon and authenticated table grants on
  `combo_bookings`, `combo_booking_items` and `promotion_uses`. They are
  harmless under deny-all RLS today.

## 5. Deployed 28 Oct 2026 (tag deploy-2026-10-28-1)

Shipped in one sitting on 28 Oct (UTC):

1. **Migrations 130000 to 200000** through the controlled package, 05:04. The
   drift check passes against production.
2. **Edge functions (37)**, 05:05 to 05:15. Supabase's bundler timed out
   fetching jsr.io for some of them; retries succeeded. The live source of all
   37 matches this branch byte for byte.
3. **Admin app** promoted 05:13 (`dpl_ADmQ2wBe7LehKyBUfTywT3bLM2pj`), **booking
   app** 05:14 (`dpl_4mZh5NUAWu2C5arr9cxPK9Bmidoo`). Refund & cancel, the Edit
   booking Status field, Refunds → Decline and voucher "Apply code" were
   refused for the nine minutes between steps 1 and 3.
4. **H2b reconcile**: 13 slots, then no drift.
5. **Help KB sync**: 179 chunks, 16 re-embedded.

Before deploying, 7cfbbf9 aligned this branch with what production actually
ran: the live Cancel days dialog and the Lato font files. One 21 Oct change
that was never deployed shipped with this release: the weather "contact the
operator" sentence in `send-email`, which `cancellation-notification-only`
tests.

Still open:

- **Directions repair** (Kayak, Aonyx). The Supabase MCP refuses UPDATE
  statements from this client. Run `DATABASE_URL=... node
  scripts/repair-empty-rich-text.mjs --apply`, or that script's REPAIR_SQL in
  the SQL editor.
- **Auth.** Turn on leaked-password protection, and verify the SUPER_ADMIN
  TOTP factor.
- **Live Section 6 run.** In Yoco test mode, as a tenant ADMIN and as a
  SUPER_ADMIN, including the sandbox card refund (H2).

The branches are not pushed; the `deploy-2026-10-28-1` tags are.

## 6. Deployed 28 Oct 2026 (tag deploy-2026-10-28-2)

Weather-cancel options, requested after section 5 shipped. Operators pick the
options guests get (Refund, Voucher, Reschedule) once per trip, using toggle
buttons in four places: Slots "Weather cancel", the Cancel days dialog,
Bookings "Weather-cancel departure" and Broadcasts weather mode. "Cancel &
notify only" is unchanged. Cancelling one booking, or a selection of bookings,
still offers all three.

- **Database.** `20261028100000_weather_cancel_options` adds
  `bookings.cancellation_options`: all three options by default, limited by a
  CHECK constraint. `cancel_booking_transaction` stores the pick in the same
  UPDATE as the cancellation. All 287 bookings hold all three options,
  including the 15 awaiting a decision. The drift check is unchanged.
- **Guest side.** The email, the WhatsApp notice, the options reminder and My
  Bookings list only the offered options. `rebook-booking` and the WhatsApp bot
  refuse any other choice server-side. Staff can still settle any of the three
  from Refunds.
- **Edge functions (6):** weather-cancel, send-email, rebook-booking,
  auto-messages, my-bookings-lookup and wa-webhook. Their live source matches
  d147c7e byte for byte. The jsr.io bundler timeouts recurred; my-bookings-lookup
  needed 12 attempts.
- **Apps.** Admin `dpl_7yRmZttwu4EDM9bNPQ5e7WbejowG` (d147c7e) and booking
  `dpl_F3BCtroKUMrPewVtkf5iqgQ2Xmd8` (284a390), promoted after the migration
  and functions.
- **Gates.** Same baseline as section 3: the 8 known unit failures and the 6
  known lint errors. This release adds 11 unit tests and a 24th local
  PostgreSQL group. The local `next build` ran out of disk space, so with the
  owner's agreement Vercel's production builds (not yet serving traffic)
  served as the build gate before the migration.

Found but not fixed (pre-existing):

- **wa-webhook tenant filters.** MY_BOOKINGS_LIST loads a booking by id with no
  `business_id` filter, and the `WEATHER_REFUND_` handler updates by id only.
- **Legacy WhatsApp credit paths.** CONFIRM_WX_REFUND only re-sets
  ACTION_REQUIRED but tells the guest a refund was submitted.
  CONFIRM_VOUCHER_CONVERT issues a voucher for `total_amount` with direct
  writes, bypassing `rebook-booking`.
- **Combo legs.** On a combo whose policy is credit-voucher-only, a trip
  offered only Refund leaves that guest no self-service option. They have to
  contact the operator.
- **Bulk "selected bookings" weather cancel** goes through `cancel-booking` and
  has no option picker; the owner scoped this release to per trip.

## 7. WhatsApp and web chat review, 28 Oct 2026 (tag deploy-2026-10-28-4)

The owner asked for both bots to be production-ready. The work is 42 commits on
the admin repo's `golive/bot-review-2026-10-28` (6392443..5f270b6) and one on
the booking repo's branch of the same name (c4a2859). Every P1 and P2 fix has a
regression test that fails without it; one P3 copy change (6f6d155) has none. There are no migrations, and the
security baseline is unchanged.

**P1 (12)**

- **Retired self-service.** WhatsApp finished retiring chat self-service for
  existing bookings: old states, replayed `BK_`/`ACT_`/`WEATHER_REFUND_`
  buttons and bare 1/2/3 replies to a weather cancel now go to My Bookings.
  This resolves the first two "found but not fixed" items in section 6.
- **WhatsApp checkout and booking:**
  - a redeemed voucher survives the tour pick;
  - Add Voucher at the summary is honoured at checkout;
  - a typed yes or no works at both summaries;
  - booking questions follow the checkout's rules;
  - availability answers use the tenant's clock and real prices.
- **WhatsApp messaging:**
  - payment keywords no longer hand ordinary questions to a human;
  - interactive messages stay within Meta's limits;
  - messages parked on a closed 24-hour window are delivered when the guest
    replies;
  - one number is limited to 20 messages a minute, so it can't script up a
    tenant's AI costs.
- **Web chat:**
  - answers typed into a form step are not treated as escalations;
  - rate limits use `cf-connecting-ip`, so a forged `x-forwarded-for` can't
    dodge them. This is in `_shared/otp-attempts.ts`, which six functions
    import.

**P2 (22)**

- **Tenant and money:**
  - a picked tour must belong to the caller's tenant;
  - a list reply can't start a booking for a hidden or retired tour;
  - a failed price lookup never quotes or charges the R600 default;
  - a voucher-only booking that fails to confirm is removed;
  - voucher codes come from `crypto.getRandomValues`;
  - a typed phone number no longer unlocks a returning guest's discount in web
    chat.
- **Honest replies:**
  - STOP and DELETE never claim a change that failed; failed deletions land in
    Data Requests;
  - unsubscribing from web chat works like the email link;
  - provider errors (non-JSON Meta and Yoco responses, a failed forecast) take
    the safe path;
  - "resend my confirmation email" resends it, rather than a payment link, and
    only says "Done" when send-email succeeded.
- **Understanding guests:**
  - voice notes, locations and template button taps are logged and answered;
  - guests who booked on the website are recognised by phone in any format;
  - everyday words ("great", "going") no longer trigger unrelated FAQ answers;
  - "hey, tomorrow?" mid-booking doesn't restart the booking.
- **Copy and policy:**
  - the bot knows the tenant's refund policy;
  - no hard-coded weather refund promise or Cape Town copy;
  - AI replies pass the prompt-leak screen in both bots, with em dashes
    removed;
  - no em dashes or "1 people" in fixed replies;
  - rand amounts show both cent digits;
  - the Terms appear on the summary, before Confirm;
  - web chat asks for vouchers only and points promo codes to the website.
- **Chat widget (booking app).** Operator replies show up while the chat is in
  bot mode (it polls every 20 s, or 4 s with a human, and pauses while the tab
  is hidden). The 16 px message box stops iOS zooming.

**P3 (7)**

- Writes by row id also filter on `business_id`.
- A voucher-paid confirmation names the tour and time.
- No "null" tour description.
- Names in any script are accepted.
- The second-trip suggestion always arrives after the confirmation.
- A closed trip isn't blamed on the weather.
- Booking status reads "Paid", not "PAID".

**Gates**

- **Unit tests:** 2861 pass. The 8 failures are the known baseline.
- **Lint:** the 6 known errors, all in test helpers this review didn't touch.
- **Type checks:**
  - `tsc` exits 0;
  - `check:edge` exits 0;
  - `deno check` passes on all nine functions in scope;
  - the booking app's `tsc` and `eslint` on ChatWidget are clean.

**Deployed** (owner-approved, 28 Oct 2026 ~19:40 SAST)

- **Edge functions:** the nine below, each on its first attempt. Their live
  source matches 92012e9 byte for byte (99 files).
- **Admin app:** `dpl_CCX1f5qE4Z89EqdTzo6GHRYEZaih`. Roll back to
  `dpl_9dNaigZJJPqeTEuKrJCSCv553p7F`.
- **Booking app:** `dpl_FL3rkdsZkRGuvmk4a7ZXzMMdz1p5`. Roll back to
  `dpl_F3BCtroKUMrPewVtkf5iqgQ2Xmd8`.
- **Smoke tests:** tenant sites and admin return 200; the fulfil route and an
  unsigned wa-webhook POST return 401.
- **Logs:** no 5xx since the deploy. Production requests carry
  `cf-connecting-ip`, which the forged-IP fix relies on.
- **Function rollback:** redeploy the nine from `deploy-2026-10-28-3`.

**Scope**

- **Edge functions (9):**
  - wa-webhook and web-chat;
  - process-refund and rebook-booking, which import `_shared/vouchers.ts`;
  - create-checkout, create-paysafe-checkout, my-bookings-lookup,
    onboarding-wizard and send-otp, which import `_shared/otp-attempts.ts`.
- **Admin app:** the Data Requests fulfil route.
- **Booking app:** ChatWidget.
- **Baseline.** The branch merges `deploy-2026-10-28-3` (email wording,
  deployed by a parallel session; ae8c7c3), so the admin deploy keeps it. The
  production drift check matches the baseline: 1429 grants, 108 tables and
  244 policies.

Open, needing an owner decision or a migration:

- **FREE_TRIP vouchers.** `reserve_voucher_amount` doesn't cap how many people
  a free-trip voucher covers.
- **Weather answers** use sea-kayak wind and swell thresholds for every tenant.
  They fall back to Cape Town coordinates, because no tenant has weather spots
  set.
- **Tour lists.** A WhatsApp list shows at most 10 tours (Meta's limit). A
  tenant with more can't offer the rest in WhatsApp.
- **Credit claims.** Weather-cancel credit can't be claimed in chat; guests are
  sent to My Bookings.
- **CAPTCHA.** web-faq has a per-IP budget but no CAPTCHA.
- **Math.random codes.** rebook-booking and marketing-automation-dispatch still
  generate codes with `Math.random`.
- **Prompt injection.** WhatsApp doesn't screen inbound messages for prompt
  injection; outbound replies are screened.
- **LLM latency.** Thinking replies (wa-faq, wa-ask) wait up to 45 s before
  the Gemini fallback. In shadow mode, the v2 run can hold Meta's webhook open
  for up to about 135 s after the reply is sent. Replies and state are saved
  first, and Meta's retries are deduplicated by `processed_wa_messages`.
  Production `llm_usage` has no `wa-v2-shadow` rows.

## 8. Bot round: owner decisions of 28 Oct 2026 (NOT deployed)

Branch `golive/bot-sota-2026-10-28` (admin repo, 251fe05..626b96d) and the booking repo's branch of the same name (369446b, d2742d7). One commit and a test for each item. The unit suite is at the 8 known failures, tsc and check:edge pass, and lint shows the 6 known errors.

| # | Change | Commit |
|---|--------|--------|
| 1 | WhatsApp weather questions get the operator's policy, never a forecast | 251fe05 |
| 2 | A FREE_TRIP voucher is credit up to its value, for any group size (both bots) | ed9e568 |
| 3 | WA inbound injection gate; CSPRNG codes; "More tours" paging past 9; v2 shadow runs after Meta's 200 | af6f730, 6149016, 935ba8c, e04707a |
| 4 | Meta's real typing indicator plus read receipts; the fake pause is gone | 7dd917f |
| 5 | Weather-cancel replies name only the offered options; notify-only hands the chat to the team | 8ced2a4 |
| 6 | Promo codes in both chats, re-checked server-side, `promo_code` passed to checkout | 9d6c8d1 |
| 7 | Any language, auto-detected, on both bots; the Inbox shows the English; team replies are translated | 53994f8 |
| 8 | Turnstile on new web chat sessions, enforced only when `TURNSTILE_SECRET_KEY` is set | 812246b, a755dc5, booking 369446b |
| 9 | Returning-guest discount for verified guests on every channel, priced in checkout | 626b96d, booking d2742d7 |

**Migrations, not applied live:**
- `20261028200000_chat_guest_language.sql` adds `conversations.language` and `chat_messages.body_en`. It was applied twice on a local Postgres (idempotent; the CHECK constraint rejects anything that isn't a 2-letter code).
- `20261028210000_verified_loyalty_discount.sql` adds an email to `resolve_booking_discount` and creates the service-role-only `apply_verified_booking_discount`. It is verified by `node tests/verified-loyalty-local.mjs <socket dir> <port>`.
- Apply both before the functions deploy. The current web-chat code already sends `p_email`.

**Deploy scope:**
- Edge functions: wa-webhook, web-chat, admin-reply, create-checkout, rebook-booking, marketing-automation-dispatch.
- The admin app (Inbox English line).
- The booking app (Turnstile widget plus CSP, and checkout "Email me a code").

**Owner steps for Turnstile:**
1. Create a Cloudflare Turnstile widget for the booking domains.
2. Set the edge secret `TURNSTILE_SECRET_KEY`.
3. Set the booking Vercel env `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

**Known gaps:**
- Translation: the bots' keyword logic still runs on the guest's original words, not the English translation. The end-of-chat message and WhatsApp templates are not translated.
- Booking site: the page total doesn't show the loyalty discount. It says the discount "is taken off at payment", and the Yoco amount is the true amount.
- Booking site: unverified guests still get no automatic group discount there. This is unchanged from before.
- Web chat verification: there is no in-chat code entry. Guests are linked to My Bookings, and the widget picks up the session on their next message.
