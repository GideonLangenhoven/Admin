# RLS Lockdown Regression — Customer Site Fix Plan

**Date:** 2026-04-20
**Scope:** `~/dev/booking` (customer-facing booking site) across all tenants
**Severity:** P0 — customer purchases silently broken across the platform
**Supabase project:** `ukdsrndqhsatjkmxijuj` (cape-kayak-bookings)

---

## 0. TL;DR

The 2026-04-17 migration sequence (`drop_permissive_rls_fallbacks` → `tighten_anon_bookings_and_marketing`) removed broad anon fallbacks and narrowed the `bookings` table to nothing workable for anon. Every customer-facing page that reads, writes, or updates a booking from the browser fails. The user's `my-bookings` issue is one visible symptom; `/book`, `/success`, `/waiver`, and the inbound chat widget are all broken too. Related tables (`trip_photos`, `logs`, `chat_messages`, `combo_booking_items`) are also locked out.

**Empirical verification** (anon role via `SET LOCAL ROLE anon`, project `ukdsrndqhsatjkmxijuj`, 2026-04-20):

| Test | Result |
|------|--------|
| Tours / slots public SELECT | ✅ Works (narrow policies in place) |
| `bookings` SELECT by email (my-bookings) | ❌ Silent 0 rows |
| `bookings` SELECT by id (/success) | ❌ Silent 0 rows |
| `bookings` SELECT by id+waiver_token (/waiver) | ❌ Silent 0 rows |
| `bookings` INSERT DRAFT (/book) | ❌ Hard error 42501 — even with the advertised anon INSERT policy, the INSERT is rejected. Needs diagnosis before fixing. |
| `bookings` UPDATE to PENDING | ❌ 0 rows affected (silent) |
| `chat_messages` INSERT inbound | ❌ Hard error 42501 |
| `vouchers` SELECT | ❌ **Returned 5 rows including live codes** (`EZWLUKTK`, `BRGNV5Q7`, `CPQVA56D`, + test codes) — **security leak** |
| `trip_photos`, `logs`, `combo_booking_items` SELECT | ❌ 0 rows (correctly blocked for admin-owned data; breaks combo UI + my-bookings photo/log display) |
| `bookings` COUNT for home trust signal | ❌ Returns 0 as anon |

**Previous draft of this plan inferred a revenue impact from the booking-volume drop since 04-10. That inference was wrong — the volume drop is explained by the user being busy with other projects and not actively testing, not by the RLS regression. We have no empirical evidence of failed customer bookings yet, only that the code paths are broken in the DB. Severity remains P0 because the moment any customer hits these flows, they'll fail — but there's no known backlog of stranded bookings.**

The mirror-image regression: **`vouchers` has anon `SELECT true`** — empirically confirmed, returning real voucher codes. Needs tightening.

Unexpected finding from verification: the `bookings_anon_insert` policy is reported as existing with `WITH CHECK true`, but an anon INSERT still hard-errors with 42501. Before writing the fix I'll dump the exact policy expression and any triggers on the table — something is more restrictive in practice than the policy summary suggested.

The remediation approach is a **hybrid**:

1. **Move customer reads/updates of `bookings` and related tables through edge functions** where the operation involves identity or authorisation (my-bookings, waiver, success/cancelled).
2. **Add narrow anon RLS policies** where the operation is legitimately public (home-page booking count, combo items).
3. **Tighten `vouchers` SELECT** to scoped conditions.
4. **Fix the UX bug** in `LoginScreen.tsx` that hid the "No bookings found" error on the OTP step.
5. **Clean up duplicate page files** that have accumulated from disk corruption.

Full sweep: ~6 edge-function changes, 1 migration, 5 client files, 4 duplicate deletions.

---

## 1. Affected flows (severity + symptom)

| # | Flow | Files | Broken operations | User-visible symptom | Sev |
|---|------|-------|-------------------|---------------------|-----|
| A | `/my-bookings` | `app/my-bookings/page.tsx` | SELECT bookings, trip_photos, logs | OTP verifies then nothing (silent `loginError`) | P0 |
| B | `/book` checkout | `app/book/page.tsx` | UPDATE bookings (DRAFT→PENDING→HELD→PAID); SELECT bookings | Customer clicks pay → spinner → stuck, or silent failure | P0 |
| C | `/success` | `app/success/page.tsx` | SELECT bookings by id | "Booking not found" or blank | P0 |
| D | `/cancelled` | `app/cancelled/page.tsx` | Probably SELECT bookings | Same pattern | P0 |
| E | `/waiver` | `app/waiver/page.tsx` | SELECT+UPDATE bookings by id+token | Waiver page can't load booking | P1 |
| F | `/` home | `app/page.tsx` | COUNT bookings (trust signal) | Shows "0 bookings completed" | P2 |
| G | `/voucher-success` | `app/voucher-success/page.tsx` | Likely SELECT vouchers or bookings | Needs verification | P1 |
| H | `/my-bookings` payment poll | `app/my-bookings/page.tsx:348` | SELECT bookings.status | Post-payment status never updates | P1 |
| I | Combo-specific reads | `app/combo/...` | SELECT combo_booking_items, combo_settlements | Combo flows may not display items | P2 |
| J | Over-permissive vouchers | — | `vouchers` has anon `SELECT true` | **Security leak: any anon can dump all voucher codes** | P0 |
| K | UX bug: `LoginScreen` OTP step | `app/my-bookings/LoginScreen.tsx` | `loginError` not rendered on otpStep | Silent failures | P1 |
| L | Duplicate page files | 4 stale files | — | Risk of routing drift, dead weight | P2 |

---

## 2. Fix strategy — decision tree

```
Is the operation legitimately public (no identity gate needed)?
├── YES → narrow anon RLS policy with WHERE condition
│         (e.g., home count: anon SELECT id FROM bookings WHERE status = 'COMPLETED')
│
└── NO → Does the client already have a proof-of-identity (token, OTP, booking ref)?
         ├── YES → new edge function that validates the proof and returns data as service role
         │         (e.g., my-bookings, waiver, success)
         │
         └── NO → don't expose; require admin login
```

Why this mix and not pure RLS:
- Adding anon SELECT policies keyed on session headers is fragile (PostgREST `GUC` settings aren't a clean auth substitute).
- Pure edge-function routing for every query is heavier than needed for genuinely public reads (tours, slot availability — already working via narrow policies).
- Token-gated reads (waiver, success) belong in edge functions because the token check must be constant-time and auditable.

---

## 3. Detailed fix per flow

### A. `/my-bookings` — post-OTP reads

**Current (broken):** after OTP verify, client runs `supabase.from("bookings").select(...).eq("email", ...)`. RLS returns `[]`.

**Fix:** extend `supabase/functions/send-otp/index.ts` with a new action `"lookup"`.

- **Input:** `{ action: "lookup", token, code, phone_tail }` (same HMAC token produced by `send`; prevents re-use because token carries email+phone+code+expiry+HMAC).
- **Flow:**
  1. Verify token + code via existing `verifyToken` helper.
  2. If valid, run the full bookings query as service role (joined with slots + tours).
  3. Query related data: `trip_photos` for completed slot_ids, `logs` for the booking_ids.
  4. Return `{ success: true, bookings, trip_photos, logs }`.
- **Client:** `app/my-bookings/page.tsx` replaces `verifyOtp + lookupBookings` with a single call. Remove `supabase.from("bookings")`, `supabase.from("trip_photos")`, `supabase.from("logs")` from this file.
- **Secondary calls from my-bookings that also need routing:**
  - `checkVoucherBalance` (line 324): currently works because `vouchers` has anon SELECT — but **we'll be tightening vouchers** (fix J), so move this to a new edge-function action `"voucher-balance"` on send-otp (must verify OTP token first).
  - `startPaymentPolling` (line 348): polls `bookings.status` — move to a new edge-function action `"booking-status"` that takes the OTP token + booking_id and returns status only. Minimal data exposure.
  - `requestAdminReview` (line 366): INSERT into `chat_messages` — `chat_messages` has no anon policies at all, so this is broken. Move to edge-function action `"request-admin-review"` on send-otp.
  - `rebook-booking` invocation (line 164): already an edge function, no change.

**Result:** `/my-bookings` makes only `supabase.functions.invoke("send-otp", ...)` calls for all identity-gated operations.

### B. `/book` — customer checkout flow

**Current (broken):** empirical verification confirms client INSERTs, SELECTs, **and** UPDATEs all fail. Specifically:
- `INSERT bookings` at lines 179 and 243 — hard error 42501 despite the policy summary claiming anon INSERT is `true`. Needs root-cause investigation before fixing (see TL;DR note).
- `UPDATE bookings` at lines 177, 240, 268, 337, 345 — 0 rows affected silently.
- `SELECT bookings waiver_token` at line 319 — returns empty (silent).

**Fix:** wrap the booking-lifecycle mutations in a single new edge function `booking-lifecycle` with actions:
- `"create-draft"` — create DRAFT booking, return id + key fields
- `"upgrade-to-pending"` — DRAFT → PENDING with customer details
- `"mark-paid-voucher"` — free/voucher path, DRAFT → PAID
- `"prepare-hold"` — PENDING → HELD + capacity check (may call existing `create_hold_with_capacity_check` RPC internally; keeps the atomic semantics)
- `"cancel-over-capacity"` — used when capacity check fails
- `"get-booking"` — read booking by id for waiver_token fetch

Alternative (simpler but less consolidated): Add narrow anon policies:
- `bookings_anon_own_draft_update` — `USING (status IN ('DRAFT', 'PENDING') AND created_at > now() - interval '30 minutes') WITH CHECK (same)` — lets the browser finish its own short-lived DRAFT before RLS locks it.
- `bookings_anon_own_draft_select` — mirror of above for SELECT.

**Recommendation:** go with the **edge-function consolidation**. The narrow-policy option has a race window where a malicious anon could race to UPDATE another customer's DRAFT in the first 30 minutes after it's created (not high risk but non-zero). Edge function is tighter and mirrors the pattern the codebase already uses (`create-checkout`, `confirm-booking`).

**Note:** A lot of the atomic ops (`create_hold_with_capacity_check`, `deduct_voucher_balance`, `apply_promo_code`, `validate_promo_code`) are already SECURITY DEFINER — those still work from the client. Leave them. Only the raw `.from("bookings").update(...)` and `.from("bookings").select(...)` calls need to move.

### C. `/success` — post-payment confirmation

**Current (broken):** `supabase.from("bookings").select(...).eq("id", bookingId)`.

**Fix:** use the new `booking-lifecycle` action `"get-booking"` with the booking id as a "token" (or a dedicated `"get-booking-by-ref"` that takes the booking reference + email for safety). The booking id is a UUID — knowing it is already a form of capability. Low risk.

Cleanest: create a new small edge function `get-booking-public` that takes `{ booking_id, email? }` and returns only the publicly safe fields (status, qty, tour name, slot time, etc.) after verifying the combination exists. Matches how `/waiver` already works conceptually.

### D. `/cancelled`

Same pattern as `/success`. Reuse `get-booking-public`.

### E. `/waiver`

**Current (broken):** `supabase.from("bookings").select(...).eq("id", bookingId).eq("waiver_token", token)`.

**Fix:** **`supabase/functions/waiver-form/index.ts` already exists per CLAUDE.md.** Move the client query to invoke that function, not the table directly. Add a `"get-booking"` action if needed. The `UPDATE bookings SET waiver_status = 'SIGNED'` at line 107 must also move to that edge function.

### F. `/` home — booking count trust signal

**Fix option 1:** delete the line. Low-value UI decoration, not worth a new RLS policy.
**Fix option 2:** add a narrow anon SELECT policy:
```sql
CREATE POLICY bookings_anon_public_count ON public.bookings
  FOR SELECT TO anon
  USING (status = 'COMPLETED');
```
Narrow, exposes no PII (just row count / row ids), and only for completed bookings.

**Recommendation:** go with option 1 unless you value that trust signal. Conversion-tuning concern not a regression-fix concern.

### G. `/voucher-success`

Need to inspect. Likely reads `vouchers` (currently too-permissive but works) or `bookings`. Will fix during execution — probably reuses `get-booking-public`.

### H. Payment-status polling from `/my-bookings`

Already covered in A — new `"booking-status"` action on send-otp.

### I. Combo flows

**Broken if the combo confirmation screen reads `combo_booking_items` after an anon INSERT.** Add a narrow anon SELECT policy keyed on combo_booking id (which the anon caller just created — they know the id):
```sql
CREATE POLICY combo_booking_items_anon_own_select ON public.combo_booking_items
  FOR SELECT TO anon
  USING (
    combo_booking_id IN (
      SELECT id FROM combo_bookings
      WHERE id = combo_booking_items.combo_booking_id
      AND created_at > now() - interval '1 hour'
    )
  );
```
Not airtight (any anon can read any recent combo_booking_items by guessing IDs), but IDs are UUIDs so not practically guessable. Alternative: route combo reads through an edge function too.

### J. Over-permissive `vouchers` — SECURITY FIX

**Current:** `vouchers` has `SELECT: USING (true)` for anon. Any anon can `SELECT * FROM vouchers` and exfiltrate every voucher code. **This is a data leak.**

**Fix:** drop the blanket policy. Replace with code-equality policy:
```sql
DROP POLICY IF EXISTS vouchers_anon_select ON public.vouchers;
CREATE POLICY vouchers_anon_by_code ON public.vouchers
  FOR SELECT TO anon
  USING (
    code = COALESCE(
      current_setting('request.header.x-voucher-code', true),
      ''
    )
  );
```
Then require the client to send the `x-voucher-code` header when querying. Alternatively, move voucher lookups to an edge function (safer — no guessable-hex-header workaround needed). **Prefer the edge-function route** via the existing `send-otp` flow or a new `voucher-lookup` function.

### K. UX bug in `LoginScreen.tsx`

The OTP step only renders `otpError`. Add a `loginError` render in step 2 so "No bookings found" from `lookupBookings` is visible. Two-line change at `LoginScreen.tsx:127`.

Also: consider moving the `setLoginError("No bookings found...")` call inside `lookupBookings` to `setOtpError(...)` instead — it's happening on the OTP screen, so the OTP error field is the right channel.

### L. Duplicate page files

Delete these (they're the Mar-27/Mar-30 disk-corruption artifacts noted in `.claude/CLAUDE.md` Lab Notes):
- `app/book/page 2.tsx`
- `app/my-bookings/page 2.tsx`
- `app/my-bookings/page 3.tsx`
- `app/success/page 2.tsx`
- Plus any sibling `*.tsx 2` / `.ts 2` / `.tsx 3` files in the component directories that have been identified.

Separately from this PR, also scan the admin dashboard — it has `app/bookings/[id]/page 2.tsx` flagged in the SEO audit.

---

## 4. RLS changes required — migration

One migration file: `supabase/migrations/20260420<HHMMSS>_restore_customer_read_paths.sql`.

```sql
-- ================================================================
-- 2026-04-20 · restore customer-facing read paths after lockdown
-- ================================================================

-- 1. Tighten vouchers (close the anon SELECT true leak).
DROP POLICY IF EXISTS vouchers_anon_all ON public.vouchers;
DROP POLICY IF EXISTS vouchers_anon_select ON public.vouchers;
-- (keep vouchers_tenant_select for authenticated admins if it exists)
-- anon gift-voucher creation still works via the existing INSERT policy.
-- All voucher lookups from the customer site now go via the send-otp edge function.

-- 2. Combo-items: allow anon to SELECT rows linked to a freshly-created combo_booking.
CREATE POLICY combo_booking_items_anon_recent_select ON public.combo_booking_items
  FOR SELECT TO anon
  USING (
    combo_booking_id IN (
      SELECT id FROM combo_bookings
      WHERE id = combo_booking_items.combo_booking_id
      AND created_at > now() - interval '1 hour'
    )
  );

-- 3. (Optional — skip if home-page count feature is removed instead)
-- CREATE POLICY bookings_anon_public_count ON public.bookings
--   FOR SELECT TO anon
--   USING (status = 'COMPLETED');

-- 4. Defensive: the grant layer gives anon full CRUD; tighten.
REVOKE UPDATE, DELETE ON public.bookings FROM anon;
REVOKE UPDATE, DELETE ON public.vouchers FROM anon;
REVOKE UPDATE, DELETE ON public.trip_photos FROM anon;
REVOKE UPDATE, DELETE ON public.logs FROM anon;
REVOKE UPDATE, DELETE ON public.chat_messages FROM anon;
-- All other customer-facing updates flow through edge functions (service role).
```

Note: the REVOKE lines are a *belt-and-braces* tightening. Today, RLS already denies these ops because no policy matches; revoking at grant level makes that explicit and less brittle to future RLS policy edits.

---

## 5. Edge-function changes — summary

| Edge function | Change | Reason |
|---|---|---|
| `send-otp` (extend) | Add actions `lookup`, `voucher-balance`, `booking-status`, `request-admin-review` | Centralises my-bookings post-OTP data access |
| `waiver-form` (extend) | Add `get-booking` + `sign-waiver` actions if not already present | Replaces direct client SELECTs/UPDATEs on waiver page |
| `get-booking-public` (NEW) | Takes booking_id + email, returns safe fields | Used by `/success`, `/cancelled`, `/voucher-success` |
| `booking-lifecycle` (NEW) | Actions: create-draft, upgrade-to-pending, mark-paid-voucher, prepare-hold, cancel-over-capacity, get-booking | Replaces all direct client mutations on `/book` |
| `config.toml` | Ensure all new functions have `verify_jwt = true` (the anon JWT satisfies this) | Consistency with existing send-otp |

---

## 6. Client code changes — summary

| File | Change type | Lines |
|---|---|---|
| `app/my-bookings/page.tsx` | Replace direct DB queries with edge-function calls | ~100 lines touched |
| `app/my-bookings/LoginScreen.tsx` | Show `loginError` on OTP step | ~2 lines |
| `app/book/page.tsx` | Replace direct booking mutations with edge-function calls | ~120 lines touched |
| `app/success/page.tsx` | Replace direct booking SELECT with `get-booking-public` | ~15 lines |
| `app/cancelled/page.tsx` | Same | ~15 lines |
| `app/waiver/page.tsx` | Replace with `waiver-form` edge fn | ~30 lines |
| `app/voucher-success/page.tsx` | Verify + adjust | TBD |
| `app/page.tsx` | Remove booking-count line OR switch to edge fn | ~5 lines |
| (deletions) | `app/book/page 2.tsx`, `app/my-bookings/page 2.tsx`, `app/my-bookings/page 3.tsx`, `app/success/page 2.tsx`, dupe components | N/A |

---

## 7. Deployment order (safe sequence)

1. **Merge + deploy edge-function changes first** (no user-visible effect yet; new endpoints available but unused).
2. **Merge client code changes** → deploy booking site. Each flow switches to the new edge endpoints.
3. **Run the RLS migration last** (tightens `vouchers`, adds `combo_booking_items` policy, grant revokes). By the time this lands, the client no longer relies on the loose vouchers policy, so tightening is zero-risk.
4. **Smoke test each flow on a staging tenant before propagating** (see §8).

This ordering means production stays in its current partially-broken state until step 2 lands, at which point all customer flows come back to life. Step 3 closes the voucher leak.

**Rollback:** each step is independently revertible. If step 2 introduces a regression, revert the booking-site deploy; edge functions from step 1 remain dormant. If step 3 breaks something, revert the migration.

---

## 8. Testing plan

Smoke test on a staging tenant (recommend spinning up a test tenant with 1 tour + 1 slot). Run all customer flows end-to-end:

- [ ] Open `/`, verify no console errors, note whether booking count displays
- [ ] `/book` → pick tour/slot → enter customer info → complete via Yoco test card → expect booking reaches PAID
- [ ] `/book` with a voucher → expect voucher deducts + booking PAID
- [ ] `/success?ref=...` → booking details render
- [ ] `/cancelled?ref=...` → cancellation info renders
- [ ] `/waiver?booking_id=...&token=...` → waiver form loads + submission marks SIGNED
- [ ] `/my-bookings` → email + phone → OTP → bookings list renders → photos/logs render → voucher balance works → reschedule flow works → admin review request works
- [ ] `/voucher-success?code=...` → voucher details render
- [ ] `/combo/[id]` → picks two tours → completes

Also: run `mcp__claude_ai_Supabase__get_advisors` before and after to check for new security/perf advisors introduced by the migration.

---

## 9. Open questions before execution

1. **Date confirmation:** today is **2026-04-20** (confirmed via DB clock + latest system reminder). ✅
2. **Root-cause investigation on anon INSERT hard-error:** before writing fixes, dump the exact `polwithcheck` expression for `bookings_anon_insert`, list any triggers on `bookings`, and check the grant layer. Verification contradicted the earlier policy summary. **This must be resolved in the first hour of execution.**
3. **Home booking-count trust signal** — delete the line, or add the narrow RLS policy? (My recommendation: delete.)
4. **Who else is on the platform** beyond Aonyx (MarineTours) and Cape Kayak — any other tenants I should explicitly smoke-test?
5. **Staging environment availability** — do you have a non-prod Supabase branch I can deploy edge functions to first, or should I deploy straight to prod with feature flags?
6. **Bookings site deployment** — is it auto-deployed via Vercel on `main` push, or is there a manual promotion step?
7. **Any in-flight admin work** on this codebase I might conflict with? (The git status on the admin repo has many modified edge functions.)
8. **No assumed revenue impact:** previous draft inferred customer-booking failure from traffic volume. Corrected — volume drop is explained by the user being focused elsewhere, not by the regression. No known backlog of real failed bookings; severity remains P0 because the paths will fail the moment anyone hits them.

---

## 10. Estimated effort

- Edge function work: 4–6 hours (extend send-otp, new booking-lifecycle, new get-booking-public, extend waiver-form)
- Client refactor: 3–4 hours
- Migration + testing: 1–2 hours
- Staging smoke test: 1 hour
- **Total: ~1 day focused work**

All of this is revertible. Worst realistic case is "revert one deploy", not "multi-hour incident".

---

## 11. Not in scope of this PR (follow-ups)

- The SEO route-group split (separate work, tracked in `docs/SEO_PLAYBOOK.md`).
- Adding automated tests that hit the anon key + service role key separately to prevent future RLS regressions. This is the root-cause fix. Recommend adding a `tests/rls-regression.spec.ts` that runs the customer flows against the anon key in CI, so next time a migration breaks these paths we catch it before prod. **Strongly recommend doing this right after the fix lands.**
- Documenting the "customer flow RLS contract" in `CLAUDE.md` so future lockdown migrations don't silently break the same invariants.

---

*Plan v1 · 2026-04-20 · awaiting approval to execute.*
