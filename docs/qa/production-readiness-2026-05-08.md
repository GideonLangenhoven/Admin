# BookingTours — Production Readiness QA Report

**Date:** 2026-05-08
**Scope:** Static analysis pass across all six surfaces. Behavioural pass/fail requires manual click-through (URL list at the bottom of each section).
**Method:** Code inspection only — no runtime testing was performed. Every "PASS" means *no obvious bug visible in code*; every "MANUAL" means runtime verification is required.

---

## 0. Executive verdict

**Static analysis verdict: NOT YET READY for unsupervised production.**

The codebase is in good shape — no critical static failures were found in payment webhooks, signature verification, idempotency, RLS scaffolding, or cron JWT settings. But three classes of risk remain that only manual testing can resolve:

1. **Coverage gap on the admin dashboard.** Only 8 of 39 admin routes were inventoried in detail; 31 routes have URLs listed but no element-level pass/fail. The admin dashboard is the largest surface and has not been exhaustively walked yet.
2. **No live click-through has been performed.** Every "MANUAL" element below — roughly 80% of the inventory — is unverified at runtime.
3. **Two real risks surfaced statically** (see §5 *Static FAILs*) — `payfast-itn` fails open on validation, `reminder-scheduler` is hardcoded to a single business.

**Recommended next step:** spend 4–6 hours doing a systematic manual click-through of the booking flow + payment webhooks + admin daily-use pages, using the URL map in §1 below.

---

## 1. Manual testing access map

### Local dev (the easiest way to test)

| Surface | Start command | URL |
|---|---|---|
| Admin dashboard | `npm run dev` from `/Users/gideonlangenhoven/dev/capekayak/` | `http://127.0.0.1:3000` |
| Booking site | `cd booking && npm run dev` | `http://127.0.0.1:3001` |
| Landing page (generated) | `node landing-pages/generator/build.mjs --data <biz>.json --template <name> --out ./preview` then open `preview/index.html` | n/a |

### Production URLs (verify these — I inferred them from config, did not visit)

| Surface | URL pattern |
|---|---|
| Admin dashboard | (check Vercel — likely `admin.bookingtours.co.za` or similar) |
| Booking site | `<tenant-subdomain>.booking.bookingtours.co.za` (per `waiver-form` fallback at `supabase/functions/waiver-form/index.ts:300`) |
| Cape Kayak instance | `capekayak.booking.bookingtours.co.za` |
| Landing pages | Firebase-hosted per template (`firebase.json` is generated alongside `index.html`) |
| Edge functions | `https://<project-ref>.supabase.co/functions/v1/<function-name>` |

### Complete admin route list (39 pages)

```
/                                          # Dashboard home (manifest, today's bookings)
/billing                                   # Subscription + admin seats (privileged)
/bookings                                  # Bookings list
/bookings/[id]                             # Booking detail
/broadcasts                                # Bulk WhatsApp
/case-study/cape-kayak                     # Marketing/case-study page (public?)
/change-password                           # Password change
/compare/manual-vs-disconnected-tools      # Marketing page (public?)
/customers                                 # Customer list
/embed/embed/availability                  # Widget availability iframe
/google-callback                           # OAuth return for Google Drive
/guide                                     # Guide home
/guide/photos/[slotId]                     # Guide trip-photo upload
/guide/slot/[slotId]                       # Guide slot detail / check-in
/inbox                                     # WhatsApp + web chat
/invoices                                  # Pro-forma invoices
/marketing                                 # Marketing hub
/marketing/automations                     # Automation list
/marketing/automations/[id]                # Automation editor
/marketing/contacts                        # Contact list
/marketing/promotions                      # Promo codes
/marketing/templates                       # Email templates
/new-booking                               # Manual booking creation
/operators                                 # Operator/staff mgmt
/ota-drift                                 # OTA reconciliation drift dashboard
/photos                                    # Trip photo tracking
/popia/confirm                             # POPIA data-request confirmation
/pricing                                   # Peak pricing
/refunds                                   # Refund queue
/reports                                   # Analytics
/reviews                                   # Review mgmt
/settings                                  # Business config (privileged)
/settings/chat-faq                         # FAQ + chatbot prompt
/settings/ota                              # OTA integration settings
/slots                                     # Schedule / capacity
/super-admin                               # Tenant mgmt (privileged)
/super-admin/data-requests                 # POPIA admin queue
/vouchers                                  # Gift vouchers
/weather                                   # Weather monitoring
```

### Admin API routes (33)

```
/api/widget-availability       /api/combo-cancel        /api/combo-offers
/api/combo-settlements         /api/guide/check-in      /api/guide/photo-upload
/api/guide/send-thank-you      /api/ota                 /api/partner-tours
/api/partnerships              /api/partnerships/approve
/api/billing/history           /api/billing/pause       /api/billing/resume
/api/billing/seats             /api/billing/subscription
/api/admin/data-requests       /api/admin/data-requests/[id]/export
/api/admin/data-requests/[id]/fulfill
/api/admin/data-requests/[id]/reject
/api/popia/cancel              /api/popia/confirm       /api/popia/request
/api/admin/chat-faq            /api/admin/chat-faq/[id]
/api/admin/whatsapp/bot-mode   /api/admin/setup-link
/api/admin/remove              /api/admin/add           /api/admin/update
/api/admin/login               /api/credentials
/api/debug/sentry-test
```

### Complete booking-site route list (16 routes)

```
/                              # Tour listing (home)
/auth/callback                 # OTP/auth return
/book                          # Core booking flow
/cancelled                     # Payment cancelled
/combo/[id]                    # Combo booking (Paysafe split-pay)
/cookies                       # Cookie policy
/embed                         # Iframe-friendly booking
/my-bookings                   # Customer booking mgmt (OTP login)
/privacy                       # Privacy policy
/review/[token]                # Customer review submission
/success                       # Booking confirmation
/terms                         # Terms of service
/voucher                       # Gift voucher purchase
/voucher-confirmed             # Voucher confirmation display
/voucher-success               # Voucher payment-success redirect
/waiver                        # Waiver / indemnity form (fixed 2026-05-08, commit f722913)
```

### Booking-site API routes (3)

```
/api/img                        # Image proxy/optimization
/api/review-submit              # POST review
/api/review-token/[token]       # GET review context
```

### Edge functions (45)

See §4 for the full table. Public webhooks: `yoco-webhook`, `paysafe-webhook`, `payfast-itn`, `wa-webhook`, `web-chat`, `viator-webhook`, `getyourguide-webhook`, `external-booking`, `process-refund`, `marketing-track`, `marketing-unsubscribe`, `waiver-form`. All others are internal/cron-invoked.

---

## 2. Coverage statistics

| Surface | Routes | Elements catalogued | Detail level |
|---|---:|---:|---|
| Admin dashboard | 39 | ~83 (8 routes deep) + 31 routes URL-only | **PARTIAL** — needs more walkthrough |
| Customer booking site | 16 | ~173 | Complete |
| Automated systems | 45 fn + 7 cron + 18 msg | ~76 | Complete |
| Landing pages | 4 templates (5 more not analyzed) | ~110 + 6 generator | Complete |
| Operator onboarding | merged into admin `/super-admin` + `/settings` | ~230 | Complete |
| **Totals** | **77 routes** | **~672 elements + 31 unwalked admin routes** | |

| Verdict band | Count |
|---|---:|
| STATIC PASS | ~310 |
| MANUAL (needs runtime verify) | ~358 |
| STATIC FAIL | 4 (see §5) |

---

## 3. Surface inventories (excerpts)

The full per-element tables are too long to reproduce here. The four parallel inventory passes produced these complete tables — they live in source. To regenerate any section run a fresh inventory pass on that surface. Headlines below.

### 3.1 Admin dashboard — sample (8 of 39 routes covered in detail)

**Routes inventoried:** `/`, `/bookings/[id]`, `/customers`, `/refunds`, `/invoices`, `/inbox`, `/new-booking`, parts of `/super-admin` and `/settings`.

| Page | Sample elements | Status |
|---|---|---|
| `/` | 26 elements (manifest tabs, weather widgets, location editor, roll-call check-ins) | All STATIC PASS |
| `/bookings/[id]` | 13 elements (resend payment, edit customer, apply promo/voucher, confirmation modal) | All STATIC PASS |
| `/customers` | 1 element (search) | STATIC PASS |
| `/refunds` | 7 elements (refund all, auto refund, manual refund, processed toggle) | All STATIC PASS |
| `/invoices` | 7 elements (sort, date filter, download, print, resend, mobile actions) | All STATIC PASS |
| `/inbox` | 9 elements (tabs, virtuoso list, return-to-bot, reply textarea, send) | All STATIC PASS |
| `/new-booking` | 20 elements (tour select, calendar, slot grid, customer fields, promo, override, add-ons, submit) | All STATIC PASS |

**Routes not inventoried in detail (31):** see §1 above. URLs are usable for manual walkthrough; no element-level pass/fail yet.

### 3.2 Customer booking site — full inventory (173 elements)

Highest-stakes flows:
- **`/book` (BK-010 to BK-039, 30 elements)** — calendar, slot, qty, add-ons, customer info, promo, voucher, marketing opt-in, payment. All MANUAL or STATIC PASS. **All require live click-through with test cards.**
- **`/combo/[id]` (BK-040 to BK-063, 24 elements)** — dual calendar + Paysafe overlay. All MANUAL.
- **`/voucher` (BK-064 to BK-077, 14 elements)** — gift voucher purchase. All MANUAL or STATIC PASS.
- **`/waiver` (BK-078 to BK-097, 20 elements)** — DOB selects fixed today (commit `f722913`). All MANUAL.
- **`/my-bookings` (BK-098 to BK-137, 40 elements)** — OTP login, reschedule, cancel, edit guests, contact, special request, voucher checker. All MANUAL.
- **`/review/[token]` (BK-138 to BK-149, 12 elements)** — star rating + textarea. All MANUAL.
- **`/success` (BK-150 to BK-162, 13 elements)** — calendar exports, share, upsell. All MANUAL/STATIC PASS.
- Static pages (`/terms`, `/privacy`, `/cookies`, `/cancelled`, `/voucher-confirmed`, `/voucher-success`) — STATIC PASS, content-only.

**Static analysis verdict for booking site: PASS** with one caveat — see TR-001 in tenant-resolution risks.

### 3.3 Automated systems — full inventory (76 entries)

#### Edge functions (45) — every one has `verify_jwt = false` per `config.toml`.

**STATIC PASS (no static issues found):**
`yoco-webhook`, `paysafe-webhook`, `viator-webhook`, `getyourguide-webhook`, `external-booking`, `marketing-dispatch`, `auto-messages`, `cron-tasks`, `fetch-google-reviews`, `viator-availability-sync`, `getyourguide-availability-sync`, `ota-reconcile`, `hold-expiry`.

**MANUAL (needs runtime check):**
`payfast-itn`, `wa-webhook`, `marketing-automation-dispatch`, `send-email`, `send-whatsapp-text`, `send-invoice`, `send-otp`, `send-trip-photos`, `reminder-scheduler`, `broadcast`, `admin-reply`, `web-chat`, `create-checkout`, `create-paysafe-checkout`, `cancel-booking`, `confirm-booking`, `rebook-booking`, `process-refund`, `batch-refund`, `generate-invite-token`, `super-admin-onboard`, `manual-mark-paid`, `waiver-form`, `google-drive`, `marketing-track`, `marketing-unsubscribe`, `weather-cancel`, `bank-details`, `debug-logs`, `outbox-send`, `wa-send`, `cron-jobs`.

#### Cron jobs (7) — all have `verify_jwt = false` correctly set.

| Schedule | Job | Status |
|---|---|---|
| `* * * * *` | marketing-dispatch | STATIC PASS |
| `*/5 * * * *` | cron-tasks | STATIC PASS |
| `17 3 * * *` | fetch-google-reviews | STATIC PASS |
| `7 * * * *` | viator-availability-sync | STATIC PASS |
| `12 * * * *` | getyourguide-availability-sync | STATIC PASS |
| `37 2 * * *` | ota-reconcile | STATIC PASS |
| `23 9 * * *` | auto-messages (review_reminders) | STATIC PASS |

#### Auto-message triggers (18)

All booking / reschedule / addition / voucher confirmations have idempotency guards (`auto_messages` upsert, `confirmation_sent_at` lock, `idempotency_keys` on payment events). Multi-channel: Email + WhatsApp. STATIC PASS for the well-trodden paths (BOOKING_CONFIRM, BOOKING_UPDATED, GIFT_VOUCHER, INDEMNITY, REMINDER). MANUAL for: overbooking auto-cancel, slot-closed auto-cancel, PayFast (legacy hardcoded), marketing campaigns, automation sequences, broadcasts.

#### Webhook signature verification (6)

| Provider | Function | Method | Status |
|---|---|---|---|
| Yoco | yoco-webhook | HMAC-SHA256 via Webhook class | STATIC PASS |
| Paysafe | paysafe-webhook | HMAC-SHA256 constant-time | STATIC PASS |
| **PayFast** | **payfast-itn** | PayFast API round-trip + MD5 | **STATIC FAIL — fails open** |
| Viator | viator-webhook | HMAC-SHA256 constant-time | STATIC PASS |
| GetYourGuide | getyourguide-webhook | HMAC-SHA256 constant-time | STATIC PASS |
| Meta WA | wa-webhook | HMAC-SHA256 timing-safe | STATIC PASS |

### 3.4 Landing pages — full inventory (110 + 6)

4 templates exhaustively walked (adventure, safari, luxury, modern). 5 more exist but were not analyzed (coastal, dark, minimal, retro, tropical). All elements are static template placeholders. CTA buttons all link to `{{booking_url}}` — generation-time substitution, no runtime risk.

**Generator (`landing-pages/generator/build.mjs`):** STATIC PASS. CLI flags `--data`, `--template`, `--out` resolve correctly. Handlebars-like rendering works for `{{var}}`, `{{#each}}`, `{{#if}}`. firebase.json copied alongside index.html.

### 3.5 Operator onboarding — full inventory (230 elements)

**Verified path:** Onboarding is **NOT** at `~/Desktop/ActvityHub/Onboarding/` (path doesn't exist — the project CLAUDE.md is stale). Onboarding is integrated into the admin app at `/super-admin` (operator creation by super-admin) + `/settings` (per-business configuration wizard).

**Coverage:**
- Operator account creation (`/super-admin`) — 23 fields covering business name, subdomain, timezone, currency, logo, WhatsApp credentials, Yoco credentials.
- Settings wizard (`/settings`) — 12 sections × 200+ elements covering admin users, tours/activities, shared resources, branding, email customization, invoice/banking details, integration credentials (WA, Yoco, Google Drive), add-ons, refund policy, FAQ + chatbot prompt, automation tags, usage/billing.

**Gaps in onboarding flow (these are product gaps, not bugs):**
1. No explicit "Publish" / "Go Live" button — settings just accumulate, with no checklist gating.
2. No payment provider selector — Yoco is hardcoded as the provider (Paysafe/PayFast credentials exist but aren't selectable).
3. No email verification UI for invited admins.
4. No DNS / CNAME help during subdomain setup.
5. No landing-page template picker inside onboarding (operator has to run the CLI generator manually).

---

## 4. Tenant-isolation & security observations

| ID | Surface | Risk | Severity | Static finding |
|---|---|---|---|---|
| TR-001 | `/book`, `/combo`, `/voucher` | If subdomain → `theme.id` resolution fails, page shows empty state instead of error | MED | MANUAL |
| TR-002 | `/my-bookings` | OTP returns bookings from any business with that email/phone unless RLS scopes by `business_id` | MED | RLS verification needed |
| TR-003 | `/success` | Booking ID in URL — confirm UUID not sequential | LOW | MANUAL |
| TR-004 | `/review/[token]` | Confirm token is `crypto.randomUUID()` not predictable | MED | MANUAL |
| TR-005 | All | XSS via tour names / business descriptions if rendered with `dangerouslySetInnerHTML` | MED | MANUAL — grep for `__html` |
| TR-006 | Booking holds | Confirm hold expiry enforced server-side (cron `hold-expiry` covers this) | MED | STATIC PASS — cron exists |
| TR-007 | `cancel-booking` RPC | Confirm RPC validates `booking.business_id = auth.user.business_id` | HIGH | MANUAL |
| TR-008 | Promo codes | Confirm random strings not sequential IDs; rate-limit `/api/admin/*` | LOW | MANUAL |
| TR-010 | Frontend | Confirm only public Yoco/Paysafe keys in client; no `*_SECRET` envs leaked | HIGH | Grep recommended |

**Recommended grep before launch:** `grep -r "dangerouslySetInnerHTML" app/ components/ booking/app/` (TR-005), `grep -rE "(YOCO|PAYSAFE|PAYFAST)_SECRET" app/ booking/app/ components/` (TR-010).

---

## 5. Static FAILs (the things to fix before launch)

### 5.1 `payfast-itn` — fails open on signature validation

**ID:** AU-003
**File:** `supabase/functions/payfast-itn/index.ts`
**Issue:** PayFast ITN validation uses a server-side round-trip to PayFast's validation API. If that API call fails (timeout, network error, PayFast outage), the function currently logs and proceeds with payment processing rather than rejecting.
**Severity:** **CRITICAL** if PayFast is in active use; **MAJOR** if PayFast is dormant. Decide based on whether any tenant currently uses PayFast.
**Status:** STATIC FAIL — fix should fail closed (return 4xx if validation API unreachable).

### 5.2 `reminder-scheduler` — hardcoded single business

**ID:** AU-021
**File:** `supabase/functions/reminder-scheduler/index.ts`
**Issue:** Function uses `BUSINESS_ID` env var instead of iterating all tenants. Legacy single-business code; for the multi-tenant platform, only one tenant gets reminders.
**Severity:** **MAJOR** — silently skips reminders for all but one tenant.
**Status:** STATIC FAIL — either deprecate (replaced by `auto-messages` cron action `review_reminders`) or migrate to multi-tenant pattern.

### 5.3 PayFast confirmation message hardcoded

**ID:** AU-213
**File:** `supabase/functions/payfast-itn/index.ts`
**Issue:** Confirmation WhatsApp message is hardcoded for the legacy single-business PayFast integration; doesn't pull tenant branding.
**Severity:** **MAJOR** if PayFast is in active multi-tenant use.
**Status:** STATIC FAIL — depends on §5.1 outcome.

### 5.4 Stale CLAUDE.md reference (cosmetic but causes drift)

**Issue:** `.claude/CLAUDE.md` previously claimed booking site lives at `~/dev/booking` and onboarding at `~/Desktop/ActvityHub/Onboarding/`. Both paths are wrong — booking site is in this repo at `booking/`, onboarding is integrated into the admin app at `/super-admin` + `/settings`.
**Severity:** **MINOR** — only affects future Claude sessions.
**Status:** Already fixed in this session's CLAUDE.md rewrite, but `~/dev/booking` claim is still stale and should be corrected.

---

## 6. Coverage gaps (acknowledged risks)

1. **Admin dashboard partially walked.** 31 of 39 routes have URLs but no element-level pass/fail. **Highest priority gap** — these are operator-facing daily-use pages.
2. **Booking site routes inventoried statically only.** Every `/book`, `/combo`, `/voucher`, `/my-bookings`, `/waiver`, `/review` element is marked MANUAL pending click-through.
3. **5 landing-page templates not analyzed** (coastal, dark, minimal, retro, tropical). Same template engine as the 4 analyzed → likely same patterns, but not verified.
4. **Tenant isolation (TR-002, TR-007) not verified.** Requires logging in as Operator A and trying to fetch Operator B's data. RLS policies need direct DB inspection.
5. **No real payment testing.** Yoco / Paysafe / PayFast all marked MANUAL — needs sandbox card runs.
6. **No real WhatsApp message round-trip.** `wa-webhook` signature verification static-passes; behavioural test pending.
7. **Mobile responsive behaviour untested.** Code looks Tailwind-responsive (`sm:`, `md:` breakpoints) but no real-device test.
8. **Email rendering untested.** Resend is wired up but no test of actual delivery + rendering for each template type.
9. **Permission enforcement.** RBAC checks (MAIN_ADMIN, SUPER_ADMIN, OPERATOR) appear in code but tenant-isolation tests are not present.

---

## 7. Day-one smoke-test checklist

Run these on the actual production environment, not in dev:

- [ ] One real operator signs up via `/super-admin` invite → receives email → sets password → lands on dashboard
- [ ] Operator creates a tour with a slot → tour visible on the booking subdomain within 5 minutes
- [ ] One real customer completes a Yoco booking → `bookings.status = PAID` → confirmation email + WhatsApp received
- [ ] Yoco webhook received and idempotency_keys row created (check Supabase logs)
- [ ] One real customer signs the waiver → DOB selects retain values (regression for today's fix)
- [ ] One real customer cancels a booking from `/my-bookings` → refund triggered, slot released
- [ ] First marketing-dispatch cron tick processes a queue item (check `marketing_queue` rows transition `scheduled` → `sent`)
- [ ] First reminder email/WhatsApp fires (check `auto_messages` table for the `(booking_id, type)` row)
- [ ] OTA sync runs at minute 7 / 12 of the hour without error (check `ota_reconciliation_runs`)
- [ ] No 500s in last hour of edge function logs
- [ ] `npm run check-security-drift` passes against production

---

## 8. Pass/fail summary by surface

| Surface | STATIC PASS | MANUAL | STATIC FAIL | Notes |
|---|---:|---:|---:|---|
| Admin dashboard (sampled 8/39) | ~83 | 0 | 0 | 31 routes unwalked |
| Booking site | ~70 | ~103 | 0 | Most need click-through |
| Edge functions | 13 | 31 | 1 | payfast-itn fails open |
| Cron jobs | 7 | 0 | 0 | All correctly configured |
| Auto-messages | 8 | 9 | 1 | PayFast hardcoded msg |
| Webhook signatures | 5 | 0 | 1 | payfast-itn |
| Landing templates | 110 | 0 | 0 | 5 templates unwalked |
| Onboarding | ~150 | ~80 | 0 | Product gaps not bugs |

**Static fail count: 4.** Two are PayFast-related (one issue, one symptom) — they collapse to one fix if PayFast is decommissioned. One is a legacy `reminder-scheduler` cron. One is documentation drift, already partially fixed.

---

## 9. Production-readiness verdict

**Status: NOT READY for unsupervised launch.** Reason: behavioural verification has not been performed. The static analysis shows a healthy codebase with no large surprises, but "no obvious bugs in code" is not the same as "tested."

**Ready for limited / monitored launch?** Likely yes, with these conditions:
- Decommission PayFast or fix §5.1 first.
- Choose: deprecate `reminder-scheduler` (keep the `auto-messages` cron path), or migrate to multi-tenant.
- Run a 2-hour manual click-through of the customer booking flow on a real device with sandbox cards.
- Run a 1-hour manual click-through of the operator daily-use admin pages (`/`, `/bookings`, `/bookings/[id]`, `/inbox`, `/refunds`, `/new-booking`, `/slots`).
- Verify tenant isolation manually: log in as two operators, confirm no cross-leakage on `/bookings`, `/customers`, `/customers`, `/inbox`, `/marketing/contacts`.

If those four manual passes complete clean, the system is ready for a controlled rollout (≤10 operators, monitoring on).

---

*This report covers static analysis only. The list of 31 unwalked admin routes, 358 MANUAL elements, and 9 acknowledged coverage gaps need behavioural verification before the final pass/fail can be reported.*
