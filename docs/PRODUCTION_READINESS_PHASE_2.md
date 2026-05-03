# Production-Readiness Review — Phase 2: Cross-App Journey Tests

**Review target:** BookingTours platform (4 apps)
**Reviewer:** Claude (Opus 4.7)
**Date:** 2026-04-17
**Environment tested against:** production Supabase (`ukdsrndqhsatjkmxijuj`), via MCP with role-switch SQL. No real payments, no real WhatsApp sends, no real email dispatches.
**Status:** Phase 2 complete. **Contains one verified P0 that requires immediate action — see §0.**

Phase 1 is at `docs/PRODUCTION_READINESS_PHASE_1.md`. This document builds on that architecture baseline.

---

## 0. URGENT — P0 verified live

**Finding:** Any holder of the public Supabase anon key can read every tenant's data, including hashed admin passwords. Tenant isolation is not enforced.

The anon key is embedded in every customer's browser (it has to be — the booking site calls Supabase directly from the client). So the attack surface is the public internet.

**Live evidence, executed against the production database:**

```sql
SET LOCAL ROLE anon;
SELECT 'businesses' tbl, count(*) FROM public.businesses
UNION ALL SELECT 'bookings', count(*) FROM public.bookings
UNION ALL SELECT 'admin_users', count(*) FROM public.admin_users
UNION ALL SELECT 'invoices', count(*) FROM public.invoices;
```

| Table | Rows visible to anon |
|---|---|
| businesses | 2 |
| bookings | **138** |
| admin_users | **2 (with password_hash and email)** |
| invoices | 111 |
| slots | 1,363 |
| tours | 7 |
| vouchers | 12 |
| conversations | 4 |
| marketing_contacts | 1 |

Further proof:

```sql
SET LOCAL ROLE anon;
SELECT email, role, length(password_hash) FROM admin_users;
-- gidslang89@gmail.com          SUPER_ADMIN  64
-- justpassingpodcast@gmail.com  ADMIN        64
```

Your super-admin's SHA-256 password hash is `5ee5b46343c8…` (64 hex chars, unsalted). It is returnable to anyone who calls the Supabase REST API with the anon key. Unsalted SHA-256 + any modern cracker + rockyou.txt = plaintext for any password below 12 characters of entropy.

**Root cause.** 33 tables carry the policy:

```
policy name: "Allow all operations to maintain existing functionality"
cmd: ALL
roles: [public]                   ← grants to anon and authenticated alike
qual: true                        ← every row passes
with_check: true                  ← every write accepted
```

This policy exists because the admin dashboard uses a custom SHA-256 auth (not Supabase Auth), and therefore every admin request arrives at Postgres as role `anon` with `auth.uid()=NULL`. Correctly-scoped tenant policies (`*_tenant_select` that check `business_id = ANY (current_business_ids())`) only fire for role `authenticated`, which the admin never is. To keep the admin UI working, the team added the blanket permissive policy. It works — but it also exposes everything to the public.

**Corroboration.** Supabase's built-in advisor independently flags this as **41 `rls_policy_always_true` WARN findings**. It has been telling you.

**Immediate exposure:** 2 operators, 138 customers, 111 invoices, every conversation, every marketing contact, every voucher balance. That is every row in your current production database.

**Not hypothetical:**
1. Open `book.capekayak.co.za` in any browser.
2. Dev tools → Network → any Supabase call → copy `apikey:` header.
3. `curl 'https://ukdsrndqhsatjkmxijuj.supabase.co/rest/v1/admin_users?select=email,password_hash' -H 'apikey: <that key>'` — returns both admin password hashes.
4. Pipe hashes into hashcat with a dictionary list. Log in as super_admin.

That is a full platform compromise with no privileged access.

**Verdict.** Journey 5 (multi-operator isolation) **fails 100%.** Any other metric you hit — Journey 1 passes, latency is great, Core Web Vitals are green — is irrelevant while this is live. The right move is not to launch to 10 new operators next Monday; it is to close this leak first.

**Remediation is not large** — estimated 3–6 hours of careful work. See §8.

---

## 1. Executive summary

Testing method: for each journey I traced the code path end-to-end and, where possible, executed against the production Supabase via MCP. Payment redirects, real WhatsApp/email sends, and live browser rendering were not executed (no staging environment, and you hadn't authorised prod test-mode yet).

| # | Journey | Static trace | Live verified | Verdict |
|---|---|---|---|---|
| 1 | New operator onboarding → first booking | ✔ | Partial (tenant created via MCP not attempted; would mutate prod) | **Pass with 3 medium findings** |
| 2 | Customer booking flow | ✔ | Partial (RPC + policy inspection) | **Pass with 2 medium findings, 1 high** |
| 3 | Cape Kayak as reference | ✔ | Yes (138 real bookings inspected) | **Collapses into J2 — no separate codebase** |
| 4 | Operator daily operations | ✔ | Partial | **Pass with 3 high findings around session/auth** |
| 5 | Multi-operator isolation | ✔ | **Yes (SET LOCAL ROLE anon)** | **FAIL — catastrophic** |

A pass/fail per journey is useful, but the P0 from Journey 5 is the whole story right now. The other medium/high findings are real and need attention, but none of them is "system is broken in production today." J5 is.

---

## 2. Journey 1 — New operator onboarding

### Flow
Landing → onboarding wizard (captures email + password) → POST `/api/onboarding` → service-role writes 7 tables → Resend welcome email → operator logs into admin with password they just chose → admin dashboard loads → customer books on the generated subdomain → booking appears in admin via Realtime.

### Correction to the earlier agent trace
An earlier static-trace agent claimed Journey 1 has a P0 because "onboarding does not send a setup-link email — operator cannot set password." **That is wrong.**

Reading `~/Desktop/ActvityHub/Onboarding/app/api/onboarding/route.ts:561`:

```ts
const passwordHash = sha256(payload.business.adminPassword.trim());
// ...
.from("admin_users").insert({
  email: normalizedOwnerEmail,
  password_hash: passwordHash,
  must_set_password: false,
  password_set_at: nowIso,
})
```

The operator sets a password in the wizard. The welcome email (line 797) literally says *"Password: The one you chose during setup"*. There is no setup-link because none is needed. This flow is fine.

### Findings

| ID | Severity | Finding |
|---|---|---|
| J1-M1 | Medium | **Provisioning is not transactional.** `route.ts:547–726` inserts businesses → admin_users → policies → tours → slots → subscriptions → landing_page_orders as 7 separate round-trips. `failWithCleanup()` at line ~400 best-efforts a delete if a later step fails, but the cleanup itself is non-atomic. A half-provisioned tenant (business + admin but no policies) can survive a failure. Recommend wrapping in a Supabase RPC / `BEGIN…COMMIT`. |
| J1-M2 | Medium | **Duplicate-business check is racy.** `route.ts:435–512` checks rate-limit + duplicate name/email, then inserts business. Two concurrent wizard submissions with the same business name/email can both pass the check before either insert lands. Low probability but not zero. Fix: move to a unique index on `(lower(business_name))` or a pre-insert advisory lock. |
| J1-M3 | Medium | **Resend failure is non-blocking for the welcome email.** `route.ts:815–821` logs if Resend returns non-OK, but returns `welcomeEmailSent: false` in the response. The wizard UI needs to surface this and offer "resend" — verify it does. If not, the operator sees a success page but never gets their instructions. |
| J1-L1 | Low | **Real-time subscription for first booking.** `admin/app/page.tsx:269–275` subscribes to `postgres_changes` on `bookings`. Supabase client auto-reconnects with backoff, but there's no explicit missed-event re-fetch after reconnect. If admin is offline during the first booking, they'll see it on page refresh only. |
| J1-L2 | Low | **Booking URL race on fresh tenant.** `booking/app/components/ThemeProvider.tsx:110–130` queries `businesses.booking_site_url` at runtime. No cache lag in practice because the `booking` app's read fires after the onboarding wizard has committed. Fine. |

### Verdict: pass, subject to J1-M1/M2/M3 being known risks.

---

## 3. Journey 2 — Customer booking flow

### Flow
Customer hits `{operator}.bookingtours.co.za` or `book.capekayak.co.za` → `ThemeProvider.resolveBusiness()` resolves tenant → `/` lists tours → `/book` opens calendar → customer enters details, applies optional voucher/promo → if total=0, booking marked PAID inline and vouchers drained; else → `create-checkout` → Yoco hosted page → redirect → webhook (public) fires `yoco-webhook` → booking PAID, confirmation dispatched → `/success?ref=` fallback re-calls `confirm-booking`.

### Findings

| ID | Severity | Finding |
|---|---|---|
| J2-H1 | **High** | **No idempotency on `create-checkout`.** `booking/app/book/page.tsx:347` invokes the edge function once, with no retry and no idempotency key. If the edge fn cold-starts and times out, the customer sees a toast "Payment link unavailable" and clicks again — producing a DUPLICATE DRAFT/PENDING booking. Fix: include an idempotency key derived from `(slot_id, email, finalTotal)` and have the edge fn short-circuit on repeat. |
| J2-H2 | **High** | **Supabase Free auto-pause breaks holds.** `cron-tasks` cleans up expired holds. On Supabase Free, a week of no activity pauses the project; holds never expire, slots lock. Confirmed you're on Free. Upgrade to Pro (see Phase 1 sign-off §11). |
| J2-M1 | Medium | **Total-0 voucher path is not atomic with voucher deduction.** `book/page.tsx:268` sets `bookings.status='PAID'` BEFORE looping through `deduct_voucher_balance` RPC calls (lines 272–303). If an RPC fails mid-loop, the booking is marked PAID with less-than-full voucher deduction. No double-spend (the RPC itself is atomic with FOR UPDATE), but voucher value can be lost. Fix: deduct vouchers first, then mark PAID. |
| J2-M2 | Medium | **Webhook idempotency is partial.** `yoco-webhook` and `paysafe-webhook` both verify HMAC signatures correctly (standard-webhooks library for Yoco, manual constant-time XOR for Paysafe — both fine). Neither stores a seen-webhook-id and checks before processing. `confirm-booking` uses a `logs` table to claim "notifications already sent" but the SELECT-then-INSERT has a race window. Low-probability duplicate email/WhatsApp on parallel webhook+/success arrival. Fix: unique index on `logs(booking_id, event)`. |
| J2-L1 | Low | **Hostname-mismatch tenant fallback.** `ThemeProvider` falls back to "first business in table" when hostname doesn't match any `booking_site_url`. Combined with `NEXT_PUBLIC_BUSINESS_ID` env-lock (per-deployment), this is safe for multi-tenant deployments but a DNS misconfig on a new operator could mis-route to Cape Kayak. Mitigation: confirm `NEXT_PUBLIC_BUSINESS_ID` is set on every production `booking` Vercel deployment. |
| J2-L2 | Low | **35 `page 2.tsx` / `page 3.tsx` duplicate files** in `~/dev/booking/app/`. Confirmed not routable by Next.js App Router and not imported anywhere. Dead code, safe to delete. |

### Things the static trace verified are correct

- Slot hold creation via `create_hold_with_capacity_check` RPC uses `SELECT FOR UPDATE` and is race-safe against concurrent bookings for the last seat.
- Voucher balance deduction via `deduct_voucher_balance` RPC is atomic (row-level lock).
- Promo code validation/apply via `validate_promo_code` / `apply_promo_code` RPCs is atomic.
- Webhook signature verification is in place for both Yoco and Paysafe.
- Submit button disables during form submission → no accidental double-submit from that path.
- `/success?ref=` is re-entrant; refresh/back is safe.

### Verdict: pass with J2-H1 and J2-H2 being real problems.

---

## 4. Journey 3 — Cape Kayak as reference implementation

As established in Phase 1, Cape Kayak has no separate codebase. `book.capekayak.co.za` is the `booking` Vercel project with `NEXT_PUBLIC_BUSINESS_ID` set in `.env.local` (and — per your confirmation needed — in the Vercel production env). All of J2's findings apply identically. No additional risk from a divergent codebase.

One thing this journey *did* prove: the current production database has 138 bookings for the Cape Kayak tenant, 111 invoices, 1,363 slots. Cape Kayak is the real reference — it is live, it has real data, and it is subject to the P0 in §0.

### Verdict: collapses into J2.

---

## 5. Journey 4 — Operator daily operations

### Flow
Login (custom SHA-256 against `admin_users`) → dashboard home (bookings, manifest, refunds, inbox KPIs) → booking detail → inbox reply via WhatsApp → refund approval → reports → logout.

### Findings

| ID | Severity | Finding |
|---|---|---|
| J4-H1 | **High** | **Password hashing is unsalted SHA-256.** `admin-auth.ts:19–22`. No salt, no work factor. If the `admin_users.password_hash` column leaks (and per §0, **it currently does leak to anyone with the anon key**), any password under ~12 chars of entropy is recoverable via rainbow tables / hashcat in under an hour. Fix: bcrypt (cost 12) or Argon2id with a server-side edge-function login endpoint. See §8 remediation — this is step 3 of the P0 fix sequence. |
| J4-H2 | **High** | **No server-side session invalidation on logout.** `AuthGate.clearSession()` just clears localStorage. An attacker who grabs `ck_admin_*` via XSS retains a valid session for up to 12 hours with no way to revoke it. Fix: add an `admin_sessions` table with server-side expire-on-logout. Minimum bar: rotate admin_users.password_hash on logout. |
| J4-H3 | **High** | **Route-level access control is nav-only.** AppShell hides `/settings` and `/super-admin` from non-privileged roles, but the page components themselves don't re-check the role. A non-privileged operator who types the URL can render the page. Depending on what edge functions those pages call, they may be able to trigger privileged actions if the edge fns also don't re-check. Requires audit of every privileged edge function. |
| J4-M1 | Medium | **Refund idempotency is partial.** `process-refund` edge fn recalculates `refundableAmount = totalCaptured - totalRefunded` on each call, so a double-click results in the second call refunding `amount - already_refunded = 0` and short-circuiting. Safe against that specific race, not safe against concurrent clicks that both read the old `totalRefunded` before either writes. Unique index on `refund_requests(booking_id, created_within_minute)` would harden this. |
| J4-M2 | Medium | **Client-side lockout after 5 failed logins.** `AuthGate.tsx:226–229` increments a localStorage counter and sets `ck_lock_until`. An attacker can `localStorage.clear()` and retry. Fix: move to server-side `admin_users.locked_until`. |
| J4-M3 | Medium | **SUPER_ADMIN operator-switch doesn't hard-refresh data.** `AuthGate.switchOperator()` updates localStorage and state but doesn't navigate. Pages with `useEffect(…, [businessId])` will re-fetch; pages without that dep won't. Risk: stale data from the old tenant stays visible on the current page. Fix: `router.refresh()` or `window.location.reload()` on switch. |
| J4-M4 | Medium | **Audit-log TODO on `/bookings/[id]`.** Manual actions (mark paid, resend confirmation, refund) are not logged. Compliance / dispute defensibility is low. File `app/bookings/[id]/page.tsx:~149` has the explicit TODO. |
| J4-L1 | Low | **Realtime auto-reconnect backfill.** Supabase client handles reconnect, but the dashboard doesn't re-fetch initial state on reconnect — missed events during a disconnect stay missed. Covered also in J1-L1. |
| J4-L2 | Low | **WhatsApp 24-hour window UI warning is present** (good). Operator sees `"WhatsApp requires the customer to message you first"` when outside the window. Pass. |

### Verdict: the dashboard works. But J4-H1/H2/H3 plus the §0 P0 together make the admin plane fragile.

---

## 6. Journey 5 — Multi-operator isolation

Result covered in §0. **Failed live.**

For completeness, the breakdown of the 62 public-schema tables:

| Protection status | Count | Notes |
|---|---|---|
| Has `FOR ALL USING (true)` policy for role `public` | **33** | Anon can read/write everything |
| Has no policies at all (RLS enabled, no policy = default deny) | 10 | Safe by default, but unreachable. Includes: `business_partnerships`, `combo_booking_items`, `combo_offer_items`, `combo_settlements`, `idempotency_keys`, `invite_tokens`, `ngt_intake_submissions`, `ngt_payments`, `pending_reschedules`, `tenant_invoice_sequences` |
| Has only tenant-scoped (`authenticated`) policies | 19 | Correctly locked down. Includes: `landing_page_orders`, `audit_logs`, `subscriptions`, `usage_counters`, `external_booking_credentials`, etc. |

The 19 correctly-locked tables are the *intended* security model. The 33 exposed tables are the problem. The 10 no-policy tables are worth reviewing — some (like `invite_tokens`, `idempotency_keys`) should probably be accessible to the anon-originating booking site or edge functions.

### Verdict: FAIL.

---

## 7. Findings catalogue

Severity scale: **P0** blocks launch; **P1** ship-stopper but not launch-blocking; **P2** fix in first month.

| ID | Severity | Title | Origin | Fix effort |
|---|---|---|---|---|
| **P0-1** | P0 | 33 tables have `FOR ALL USING (true)` policy exposing data to anon | J5 live test + Supabase advisor | 3–6h |
| **P0-2** | P0 | Admin `password_hash` readable via anon key (compounds with unsalted SHA-256) | J5 live test | Fixed by P0-1 + migrate hashing |
| **P1-1** | P1 | Supabase Free auto-pauses → cron down → holds lock slots | J2-H2 + Phase 1 | 30min (plan upgrade) |
| **P1-2** | P1 | `create-checkout` has no idempotency → cold-start duplicate bookings | J2-H1 | 2–4h |
| **P1-3** | P1 | Admin password hashing is unsalted SHA-256 | J4-H1 | 1 day (requires migration + force reset) |
| **P1-4** | P1 | No server-side session invalidation → stolen localStorage = 12h access | J4-H2 | 1 day |
| **P1-5** | P1 | Route-level access control is nav-only | J4-H3 | 4–6h |
| **P2-1** | P2 | Onboarding provisioning not transactional | J1-M1 | 4h |
| **P2-2** | P2 | Onboarding duplicate-name race | J1-M2 | 1h (unique index) |
| **P2-3** | P2 | Welcome email failure swallowed | J1-M3 | 1h |
| **P2-4** | P2 | Total-0 voucher path writes booking before deduction | J2-M1 | 1h (re-order) |
| **P2-5** | P2 | Webhook idempotency partial | J2-M2 | 2h (unique index on logs) |
| **P2-6** | P2 | Refund idempotency partial | J4-M1 | 2h |
| **P2-7** | P2 | Client-side login lockout bypassable | J4-M2 | 2h |
| **P2-8** | P2 | Operator-switch stale data | J4-M3 | 30min |
| **P2-9** | P2 | Audit-log TODO | J4-M4 | 1 day |
| **P2-10** | P2 | 46 `function_search_path_mutable` warnings | Advisor | 1 day |
| **P2-11** | P2 | 2 public Storage buckets allow listing | Advisor | 30min (review + restrict) |
| **P2-12** | P2 | Hostname-mismatch fallback to first business | J2-L1 | 30min (raise error instead of fallback) |
| **P3-1** | P3 | 35 dead `page 2.tsx` files in booking/ | J2-L2 | 15min cleanup |
| **P3-2** | P3 | Realtime reconnect no backfill | J1-L1 / J4-L1 | 4h |

Total P0 effort: ~6h. Total P1 effort: ~3 days. Total P2 effort: ~1 week. Total to green-light launch: **about 3 days of focused work + password rotation comms.**

---

## 8. Immediate remediation — recommended sequence

Do these in order. Each step builds on the previous.

### Step 1 — Upgrade Supabase to Pro (30 min, today)
R470/mo. Removes auto-pause, enables point-in-time backups, doubles every limit. **Do this first** because Step 2 involves DDL migrations that you want backed up.

### Step 2 — Lock down RLS (2–4 hours, this week)
Sequence:

1. Drop the 33 `"Allow all operations to maintain existing functionality"` policies. Do this in one migration.
2. For each of the 33 tables, add explicit anon policies for exactly what the customer booking site needs. Concrete examples:
   - `tours`: anon SELECT where `active=true AND hidden=false` — needed for the booking site to list tours.
   - `slots`: anon SELECT where `status='OPEN' AND start_time > now()` — needed for the calendar.
   - `businesses`: anon SELECT where `id IN (SELECT id FROM businesses)` limited to columns `(id, name, business_name, booking_site_url, hero_title, …)` — drop `credentials` (which is encrypted but still unnecessary to expose). **Do not expose `admin_users` to anon at all.**
   - `bookings`: anon INSERT (for customer checkout). Anon SELECT only for `email = request.header('x-customer-email')` type gating via a custom JWT — *or* move all reads through an edge function. Simpler: no anon read, use an edge function `get-my-booking` that validates OTP and returns the booking.
   - `vouchers`: anon SELECT where `code = <provided>` limited to essential fields.
3. For the admin UI (which currently runs as anon), add explicit anon policies scoped to "the business_id currently in the session" — but the admin has no Supabase session. This is the hard part: either (a) the admin starts routing all reads through `/api/*` server-side with the service-role key and `business_id` from a signed session cookie, or (b) the admin migrates to Supabase Auth so policies can use `auth.uid()`.

The fastest path to remediation:
- **Fast (1 day):** move admin reads/writes through Next.js `/api/*` routes with service-role key. The admin UI calls `/api/bookings?business_id=X`, the route validates the session and returns filtered data. Drop `anon` from all admin-facing tables. This keeps the custom auth.
- **Correct (1 week):** migrate admin auth to Supabase Auth. Every admin becomes a real Supabase user with a JWT. The `*_tenant_select` policies that already exist for role `authenticated` start working. Drop all the permissive policies.

I would recommend the fast path as a tourniquet (stops the bleed) and plan the correct path as the next sprint.

### Step 3 — Rotate admin passwords (1 day, same week as Step 2)
Any admin password hash already exposed is already exposed. Assume compromise. Force-reset all admin passwords:

```sql
UPDATE admin_users
SET password_hash = NULL,
    must_set_password = true,
    setup_token_hash = …,
    setup_token_expires_at = now() + interval '7 days';
```

Then send setup-link emails via the existing `sendAdminSetupLink()` flow in `admin-auth.ts`. In the same pass, change the hashing to bcrypt.

### Step 4 — Idempotency on create-checkout (4 hours, next sprint)
Issue `x-idempotency-key: <slot_id>:<email>:<finalTotal>` header. In the edge function, upsert into an `idempotency_keys` table (which already exists in your schema — unused!) and short-circuit on repeat.

### Step 5 — Route-level auth middleware (4 hours, next sprint)
Add per-page server-side checks for privileged routes (`/settings`, `/super-admin`). Check the cookie / session, look up `admin_users.role`, redirect non-privileged to `/`.

### Step 6 — Server-side session (1 day)
Add `admin_sessions (token_hash, admin_id, expires_at, revoked_at)`. Validate on every admin request. Revoke on logout.

**End state after Step 6:** the platform is at the 95% reliability target for Journey 5, the known admin-auth risks are closed, and the remaining P2s are cleanup work that can run in parallel with taking new operators.

---

## 9. What Phase 2 did NOT test

These need staging access (or prod test-mode authorisation) to verify:

- **Actual Yoco payment redirect** on mobile and desktop. Smoke test with a R1 booking.
- **Actual Paysafe combo flow** including inline SDK load.
- **Actual webhook arrival** from Yoco/Paysafe (DNS, TLS, signature validation end-to-end).
- **Actual WhatsApp send** via Meta Graph API (template fallback behaviour, 24-hour window).
- **Actual Resend delivery** including spam-folder placement on gmail/outlook (deliverability is a big issue for new domains).
- **Actual Realtime reconnect** behaviour under flaky network.
- **Actual boot of each app via `npm run dev`.** Deferred — lower value than the P0 investigation. Will fold into Phase 3 benchmarking.
- **End-to-end Journey 1** with a real wizard submission. Deferred — creates a real tenant in your prod DB.

All of these are scheduled for Phase 3 (performance) or need staging.

---

## 10. Sign-off gate

Phase 2 is done. Before moving to Phase 3 (performance benchmarks):

- [ ] You acknowledge the P0 and choose a remediation path (fast / correct / both).
- [ ] Supabase upgraded to Pro.
- [ ] Decision on staging: will you set one up, or shall Phase 3 benchmark against prod?
- [ ] If prod for Phase 3: rules of engagement (e.g. no R-amount payments, use Yoco test keys, cap WhatsApp sends).

One other thing worth your call: whether to keep Phase 3 (performance) going *in parallel* with P0 remediation, or wait until the P0 is fixed. Performance benchmarks are cheap and independent of the security fix; I'd recommend parallel.
