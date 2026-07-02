# Handoff — BookingTours Admin + Booking Site

_Last updated: 2026-05-14_

## Goal of this session

Drive the platform to production-readiness by working through the QA test reports section by section (E → F → H → I → L → M → O), fixing the issues each report surfaced. Two surfaces are being readied in parallel:

- **Admin dashboard** (`caepweb-admin.vercel.app`, GitHub: `GideonLangenhoven/Admin`)
- **Customer-facing booking site** (`*.booking.bookingtours.co.za`, GitHub: `GideonLangenhoven/capekayak-booking`)

Plus a single shared Supabase project (`ukdsrndqhsatjkmxijuj`) for DB, edge functions, and auth.

## Current state

**Both Vercel deploys are clean and pushed.** No uncommitted code (only stray `tsconfig.tsbuildinfo` rebuild artefacts in both repos, ignorable).

- Admin: `bcc4801` on `origin/main`
- Booking: `22e321b` on `origin/main`
- Edge functions: all redeployed via `npx supabase functions deploy …` over the course of the session

The user-action item that's still outstanding (no code fix) is the **Resend API key in Supabase Auth → SMTP → Password**: it currently belongs to a different Resend account than the one where `bookingtours.co.za` is verified, so Supabase Auth's magic-link path returns `500 / 550 domain not verified`. Once the right `re_…` key is pasted in (from the `gidslang89` Resend account), magic-link login + broadcast email + reschedule payment-link email all become deliverable.

## Files in flight

These are the files modified across the QA-fix arcs of this session. None have uncommitted changes; the list is for orientation when you next touch them.

### Admin (`/Users/gideonlangenhoven/dev/capekayak`)
| File | What lives here |
|---|---|
| `app/bookings/page.tsx` | Rebook modal + admin cancel modal + mark-paid + reduce-guests + zero-capacity filter + pending-reschedule chip + add-ons chip |
| `app/bookings/[id]/page.tsx` | Mark-as-paid inline panel + reduce-guests inline panel + promo math (E4) + voucher attribution split (E3) |
| `app/broadcasts/page.tsx` | Honest delivery counts (O-1) + "WA?" channel labelling (O-2) + empty-slot CTA copy |
| `app/slots/page.tsx` | "Show closed / 0-capacity" toggle |
| `app/new-booking/page.tsx` | Manual override now respects add-ons (E2) + validation toast (E11) |
| `supabase/functions/rebook-booking/index.ts` | `genVoucherCode` const→let runtime bug fixed |
| `supabase/functions/create-checkout/index.ts` | RESCHEDULE-type notification block (email + WhatsApp) added |
| `supabase/functions/send-email/index.ts` | `RESCHEDULE_PAYMENT_LINK` template + `sendResend` returns `{ok, …}` faithfully (O-1) |
| `supabase/functions/broadcast/index.ts` | Per-recipient body.ok check; returns `wa_attempted` / `email_attempted` |
| `supabase/functions/manual-mark-paid/index.ts` | Accepts `payment_method` + `payment_note` |
| `supabase/functions/my-bookings-lookup/index.ts` | Accepts/issues `customer_session` token |
| `supabase/functions/_shared/customer-session.ts` (new) | HMAC-signed 30-day customer-session helpers |
| `supabase/functions/_shared/platform-invariants.ts` (new) | Platform-wide LLM safety rules |
| `supabase/functions/_shared/intent.ts` | Anthropic → Gemini classifier swap |
| `supabase/functions/web-chat/index.ts` | Accessibility escalation + meeting-point intent + peak-aware pricing |
| `supabase/config.toml` | `verify_jwt = false` for create-checkout + send-whatsapp-text |

### Booking site (`/Users/gideonlangenhoven/dev/capekayak/booking`)
| File | What lives here |
|---|---|
| `app/book/page.tsx` | PII pre-fill gated on `?resume=1` + per-voucher applied/remaining copy |
| `app/lib/booking-draft.ts` | 24h → 2h TTL + `?resume=1` flag emitted on resume URLs |
| `app/success/page.tsx` | "Sign Waiver Now" CTA + green "Waiver completed" badge + clears localStorage draft |
| `app/voucher/page.tsx` | "Valid 3 years" copy aligned with backend expires_at |
| `app/my-bookings/page.tsx` | Customer-session auto-resume on mount + sign-out clears localStorage |
| `app/my-bookings/LoginScreen.tsx` | "Sign in with a 6-digit code instead" label + anti-enumeration copy |
| `app/my-bookings/BookingCard.tsx` | Weather-cancel decision panel (Pick New Date / Voucher / Refund) |

## What's changed

Grouped by QA section. Commit hashes are admin unless noted with **(booking)**.

### Section D / Chat (web-chat)
- `d1c35f6` — Service-dog → ACCESSIBILITY_QUESTION escalation, meeting-point intent prefers `meeting_point_address`, peak-aware "From R200" pricing in tour list.
- `bfd4ac6` — Intent classifier swapped from Anthropic Haiku to Gemini 2.0 Flash.
- `f604968` — Peak-pricing surface no longer surprises the customer.
- `5337874` — Persistent "Talk to a human" button + honest fallback when Gemini doesn't have an answer.
- `8914d04` — `PLATFORM_INVARIANTS` prepended to every tenant's LLM prompt.

### Section E / Admin bookings (E1–E11)
- `ac2d887` — Mark-as-Paid action with Cash/EFT/Card/Other picker + Reduce-Guests with refund-method choice.
- `d80f1b1` — Promo math consistency (E4), voucher attribution split on detail page (E3), override respects add-ons (E2).
- `cfa6f18` — Zero-capacity slots hidden by default; new-booking form toasts missing-field list.
- `3f9d351` — Admin cancel modal now offers "Refund to card" vs "Issue voucher" for paid bookings.

### Section F / Waiver + Section I / Customer self-service
- `ce19516` **(booking)** — `/book` PII pre-fill gated on explicit `?resume=1`; draft TTL 24h → 2h; `/success` adds Sign Waiver Now CTA + waiver-completed badge.
- `7d79d75` **(booking)** — Honest login copy (no enumeration; "code is emailed" not "phone verification"; humanised rate-limit error).
- `22e321b` **(booking)** — Customer-session token persists OTP login for 30 days across navigation; weather-cancel decision panel surfaces on `refund_status=ACTION_REQUIRED`.
- `97e7a0e` — Backend half: `my-bookings-lookup` mints + accepts the HMAC-signed customer-session token via the new `_shared/customer-session.ts` helper.

### Section H / Vouchers
- `a91de3b` **(booking)** — "Valid 3 years" copy now matches the actual `expires_at`; redeem chip says "R200 applied · R400 remaining on TEST5678" instead of misleading "R600 applied".
- `3f9d351` (already listed) — Admin cancel modal voucher-refund option.

### Section M / Rebook (admin)
- `d58a3ee` — Critical contract fix: frontend sends `action: "RESCHEDULE"`; slot dropdown filters to same tour + sufficient capacity; upgrade UI; ref-based in-flight guard; const→let voucher-code bug.
- `af542a2` — RESCHEDULE upgrade notifications wired (`create-checkout` + new `RESCHEDULE_PAYMENT_LINK` email template); admin row shows amber `⏳ Pending reschedule → …` chip; `excess_action` omitted on same-price/upgrade rebooks.

### Section O / Broadcasts
- `bcc4801` — `sendResend` returns normalised `{ok, …}`; `send-email` propagates faithfully; `broadcast` checks `body.ok` per recipient and reports `wa_attempted` / `email_attempted`; UI shows "X of N delivered" + collapsible failure-reasons; "WA?" tooltip; empty-slot weather CTA reworded.

### Platform / infra
- `fa7b48d` — `verify_jwt = false` on `create-checkout` and `send-whatsapp-text` (rotated SERVICE_ROLE_KEY is now `sb_secret_*`, not a JWT, so cross-function calls were being 401'd at the gateway).
- `dda7cab` / `64e01d9` — CORS Allow-Headers widened to `x-tenant-business-id`, `x-voucher-code`, `x-booking-success-token`, etc., across all browser-facing functions.

## Failed attempts / dead ends

- **Magic-link 500 from Supabase Auth (still failing as of last test)**. Auth log error is unambiguous: `gomail: could not send email 1: 550 The bookingtours.co.za domain is not verified`. The domain *is* verified in the `gidslang89` Resend account (user confirmed via screenshot), so the only remaining cause is the **Resend API key currently pasted into Supabase Auth → Email → SMTP → Password is from a different Resend account** (or is scoped to a different domain). Not fixable from code; documented in next steps.
- **In-tab paste of magic-link `#access_token=…` hash on `/my-bookings`**. We tried having the page auto-consume hash tokens server-detected by Supabase JS; this works on a fresh page load but not on a manual paste of the hash after the page has rendered. Not a bug — paste-after-load is an unrealistic flow once Site URL is configured correctly.
- **CK- voucher code prefix (Section H1)**. Considered prefixing all voucher codes per spec, decided against. Codes are 8-char alphanumeric system-wide; prefixing would require a data migration across all existing vouchers + validator changes for marginal UX gain. Recommended updating the spec to match the system instead.
- **Sunset Paddle missing from Rebook dropdown**. Initial assumption was a backend-filter bug. DB query confirmed no Sunset Paddle slots are scheduled for the tested dates — the data simply isn't there. Operator action, not a code fix.
- **Customer-side Reschedule "missing" on `/my-bookings`**. The button IS in `BookingCard.tsx:244` for FULL-tier bookings (>24h). The QA-tested booking was sub-24h so tier policy correctly hid it (LIMITED 12–24h offers "Request Change"; LOCKED <12h offers "Contact Team"). Not a code change needed; needs a >24h booking for end-to-end test.
- **`pnpm-lock.yaml` reintroduction temptation**. Avoided. Project is npm-only per `packageManager` pin in `package.json`. Reintroducing pnpm breaks Vercel deploys.

## Next steps (in priority order)

### Blocking — user action only
1. **Paste the right Resend API key into Supabase Auth → Email → SMTP → Password.** Create a new key in the `gidslang89` Resend account with **Permission = Full access**, **Domain = All domains** (or `bookingtours.co.za`), copy the `re_…`, paste into Supabase, save. This single change unblocks: (a) magic-link login (Section I), (b) broadcast email delivery (Section O), (c) reschedule-upgrade payment-link email (Section M). Verify via auth log — should see `200 /otp` and no more `550 domain not verified`.

### High priority — needs code work
2. **Test a real Yoco sandbox card through the M3 reschedule upgrade path.** All M2 plumbing is in place (`pending_reschedule_id`, hold, payment URL, email). The webhook → slot swap is wired but unverified end-to-end. Suggested: small sandbox booking, do an upgrade rebook, run the payment in Yoco's test mode, watch `yoco-webhook` logs convert `pending_reschedules.status PENDING → COMPLETED` and old slot release.
3. **Re-test Section O broadcast** once item 1 is done. The UI now reports real delivered counts so the failure-reasons panel will tell you exactly why if anything still falls over.
4. **Customer-side Reschedule + Cancel on `/my-bookings`** verified end-to-end. Tier policy already exposes them >24h before the trip. Create a >24h booking, log in via OTP (now session-persistent for 30d), confirm the buttons appear and the flow completes.

### Medium — worth doing before launch
5. **Embed-widget UI in admin Settings.** Loader script exists at `booking/public/widget.js` served from `https://booking.bookingtours.co.za/widget.js` with the snippet:
   ```html
   <div id="bookingtours-widget" data-tenant="aonyx"></div>
   <script src="https://booking.bookingtours.co.za/widget.js" async></script>
   ```
   No UI surfaces this to operators yet. Add a copy-to-clipboard panel in `/settings` so tenants can grab their embed code without intervention. ~10 lines.
6. **Auth Hooks → Send-Email Hook (multi-tenant Auth email branding)**. Today's Supabase Auth template is hard-coded "Cape Kayak". As soon as a second tenant onboards, every Auth email will misbrand. Plan: enable Supabase Auth's "Send Email Hook" pointing at `send-email` with a new `MAGIC_LINK` type that consumes `loadEmailBranding(business_id)` already present in `send-email`. This gives each tenant their own login email automatically, same way booking confirmations work today. ~2-3 hour task.
7. **Email-existence enumeration** is still mitigated only at the copy layer ("if a booking exists, we've sent a link"). Supabase Auth's underlying `signInWithOtp` still returns the same 200 regardless of whether the email exists — fine for the default `shouldCreateUser: true` case, but worth confirming no other surface leaks it.
8. **Brand-string drift between "Cape Kayak" (OTP email header) and "Aonyx" (other emails).** Decide on parent/child naming convention. Probably surfaces cleanly with the multi-tenant Auth Hooks fix above.

### Low — polish/cleanups
9. **Pre-filled Gideon Langenhoven PII on `/book` (privacy)**. Mitigated for the localStorage path. The Supabase Auth session prefill remains: a previous logged-in customer's `customers` row data still fills name/email/phone on a shared browser. Either clear that on `/book` mount when no `?resume=1`, or add a "Not you?" header to let the visitor wipe.
10. **`SUMMEE20` promo typo cleanup** — manual deletion in Marketing → Promotions. 0 uses, safe to delete.
11. **"Pending Reschedules" view in admin** — a small dedicated page (`/bookings/pending-reschedules`) listing all rows where `pending_reschedules.status = 'PENDING'`. Adds a re-send-payment-link affordance if the hold lapses. Current row chip is a good first signal but doesn't scale once there's volume.
12. **Marketing/Promotions: validate code format on save** to prevent SUMMEE20-style typos at source.

## Active edge functions in production
All deployed against project `ukdsrndqhsatjkmxijuj`:

`web-chat`, `wa-webhook`, `create-checkout`, `send-whatsapp-text`, `send-email`, `send-otp`, `my-bookings-lookup`, `rebook-booking`, `cancel-booking`, `manual-mark-paid`, `broadcast`, `auto-messages`, `cron-tasks`, `reminder-scheduler`, `weather-cancel`, `process-refund`, `paysafe-webhook`, `yoco-webhook`, `payfast-itn`, marketing-* family, OTA-* family.

JWT-gateway settings live in `supabase/config.toml`. Anything called cross-function (i.e. server-to-server via service-role key) needs `verify_jwt = false` because the rotated `SERVICE_ROLE_KEY` is now `sb_secret_*` (not a JWT) and the gateway rejects it before the function ever runs.

## Key memories worth re-reading at session start

These live in `~/.claude/projects/-Users-gideonlangenhoven-dev-capekayak/memory/` and load automatically:

- `project_supabase_sk_not_jwt.md` — Why cross-function calls 401 and need `verify_jwt = false`.
- `feedback_refactor_pace.md` — Strict slow pace, no batched callers, every change gated by build/lint/unit/smoke/security-drift.
- `project_yoco_canonical_invoice.md` — Yoco is the canonical invoice issuance path; Paysafe deviations are bugs.

## Quick commands

```bash
# Admin
cd /Users/gideonlangenhoven/dev/capekayak
npm run build            # webpack production build
npm run test:unit        # vitest
npx supabase functions deploy <name> --project-ref ukdsrndqhsatjkmxijuj

# Booking site
cd /Users/gideonlangenhoven/dev/capekayak/booking
npm run build
npm run dev              # :3001 (pinned, see commit 345f5ba)

# Both pushes auto-deploy on Vercel
git push origin main
```
