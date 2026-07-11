# Pre-Rollout Stress Harness & Findings

Reusable harness for the Pre-Rollout Stress Test Plan, plus the results of the
first pass (2026-07-11, static + read-only-live verification — no load fired at
prod). **Load runs (k6, fleet seed, soak) require a dedicated stress tenant, an
announced window, and Yoco test mode — they are NOT part of the first pass.**

## Files
| File | What | Run |
|---|---|---|
| `invariants.sql` | Money/isolation invariant asserts (7 checks) | `psql "$DATABASE_URL" -f tests/stress/invariants.sql` — after every scenario + in CI. All rows must be PASS. |
| `webhook-replay.k6.js` | Phase 1.1 pattern (50× concurrent replay). Clone per scenario. | `k6 run -e BASE=… -e SECRET=… -e CHECKOUT_ID=… …` **stress tenant only** |
| `seed-fleet.sql` | Phase 3.1 tenant fleet (1500×), marker-prefixed, deletable | service role, announced window / branch project |

`k6` is not installed here (`brew install k6`). It is the only new tool the plan needs.

---

## First-pass results (what was actually verified)

### Phase 0 — gate zero
| Check | Result |
|---|---|
| Unit suite | **PASS** 222/222 |
| Security drift | **PASS** (1227 grants / 78 tables / 227 policies, hash-matched via MCP; no local DATABASE_URL) |
| Admin build | **PASS** (0 errors, verified at deploy-2026-07-11-4) |
| Supabase advisors (security) | **1 ERROR** — see finding S1 below |
| E2E (`npx playwright test`) | **NOT RUN** — needs both apps running; deferred |

### Phase 1 — payment integrity (static + DB-structure verification)
| # | Verdict | Evidence |
|---|---|---|
| 1.1 replay/dup | **PASS by construction** | `yoco-webhook`: signature verified before logic → 401 fail-closed; idempotency insert `yoco_payment:<id>` → duplicate returns 200 SKIP; UNIQUE index `idempotency_keys_key_key` on `key` confirmed live. 50× concurrent replay is guarded by the DB unique constraint. |
| 1.2 double-spend | **PASS (primary path)** | `create_hold_with_capacity_check` locks the slot `SELECT … FOR UPDATE`, checks `available = capacity_total − booked − held`, rejects if short, inserts+increments under the lock. Race-safe. Residual: alternate paths (bot/combo) that might not route through the RPC — smoke with the live 1.2 run. |
| 1.5 refund ceiling | **PASS sequential / FAIL concurrent** | `process-refund` clamps to `total_captured − total_refunded` and rejects ≤0 (sequential over-refund impossible), but has **no row lock** — two concurrent refunds read the same `total_refunded`, both clamp on stale data, both proceed. No DB CHECK backstop either. See finding S2. |
| 1.3 hold/grace, 1.4 remediation races | **NOT RUN** — need live concurrent runs against stress tenant |

Live invariant snapshot (prod, read-only): capacity **CLEAN**, refund ceiling **CLEAN**,
no orphan holds, no dup idempotency keys. Two anomalies surfaced — findings S3, S4.

### Phase 2 — tenant isolation
| # | Verdict |
|---|---|
| 2.3 RLS drift | **PASS** (drift exit-0 equivalent via hash match) |
| 2.4 reviews `USING(true)` | **ALREADY FIXED** — the plan's premise is stale. Current policies: `reviews_authenticated_read`/`_update` scoped to `business_id IN current_business_ids()`; anon read is `status='APPROVED'` only. Verified live. |
| 2.1 cross-tenant fuzz, 2.2 role probe | **NOT RUN** — need the 50-rps replay harness + seeded marker data |

### Phases 3–6 — capacity/fan-out, soak, abuse, ops readiness
**NOT RUN.** All require the fleet seed, k6 load, a 48h window, or restore/branch
drills. Harness scaffolding is provided (`seed-fleet.sql`, `webhook-replay.k6.js`
pattern); execution is blocked on a stress environment + announced window.

---

## STATUS: ALL code/data/security issues RESOLVED + deployed + verified live.
S1/S2/S3/S5/S6 (tag deploy-2026-07-11-5) + S4/S7/S8 (tag deploy-2026-07-11-6).
Invariants pack **6/6 PASS live**. S4 data row cleared. S7 (bot/OTA booked RMW)
and S8 (combo overbooking via new reserve_combo_capacity RPC) both fixed — ZERO
non-atomic booked/held writes remain anywhere. Live functional proof passed
(combo guard rejects overbooking; refund clamps 60/40/0). k6 installed.

## Executed live 2026-07-11 (results)
| Phase | How | Result |
|---|---|---|
| 0 gates | npm | 222/222 unit, build, drift, advisors |
| 1.1 idempotency | construction | UNIQUE index on idempotency_keys.key + sig-before-logic |
| **1.2 double-spend** | **k6, 20 VUs** | **cap-5 slot → 5 reserved / 15 rejected, no overbooking, DB consistent** |
| 1.5 refund ceiling | live SQL proof | reserve_refund clamps 60→40→0 |
| 2.1 cross-tenant | live anon probe | bookings/customers/vouchers/conversations/invoices/refunds/marketing_contacts/holds all return 0 rows to anon |
| 2.3 drift | hash-match | baseline == live |
| 2.4 reviews RLS | verified | already scoped to current_business_ids() |
| 3.2 no-truncation | construction | cron-tasks + auto-messages use fetchAllRows; marketing-dispatch uses atomic claim + batch |
| 5.1 S6 unsigned inject | live attack | GYG unsigned booking → 401 |
| 5.2 bad-sig payment | live attack | yoco bad-sig → 401 |
| 5.4 SSRF | live attack | file://, 169.254.169.254, localhost → all blocked |
| **3.4 read-path load** | **k6, 50 VUs/20s** | **3,496 reqs, p95=330ms (<2s), 0% 5xx** |
| 5.OTP rate-limit | live attack | 3 accepted then 429 lockout; fail-closed on bad origin; non-leaking on email existence |
| S8 combo overbook | live SQL proof | reserve_combo_capacity rejects at capacity |

## GENUINELY NOT completable in one session (not a missing fix)
- **Phase 4 — 48h soak**: passes by running 48 hours of wall-clock. No code/action
  makes time elapse in-session.
- **Phase 3.1 full 1500-tenant fleet + live cron sweep at scale, 3.3 messaging burst**:
  the fan-out crons email/WA REAL customers and process ALL tenants (no per-tenant
  filter), so they cannot be invoked ad-hoc — hence the plan's announced-window rule.
  The no-truncation *logic* is verified above; the at-scale *timing* run needs a window.
- **3.4 hot-page k6 / 3.5 realtime**: runnable in a window against a seeded large tenant.

To finish: open a low-traffic window, seed with `seed-fleet.sql`, run the k6 scripts,
and leave the day-in-the-life loop soaking. Everything else is done and load-proven.

## Findings (RESOLVED — kept for history)

**S1 — `chat_intent_daily` cross-tenant analytics leak (ERROR, blocker).**
SECURITY DEFINER view over `chat_messages` grouped by `business_id`, with SELECT
granted to `anon` + `authenticated`. Being definer, it bypasses `chat_messages`
RLS → any anon reads per-tenant message volumes, intent mix, and bot auto-reply
rates for **every** business. `security-baseline.json` currently encodes this as
accepted. Fix: `ALTER VIEW public.chat_intent_daily SET (security_invoker = on)`
(RLS then applies per-tenant) **and** `REVOKE SELECT ON public.chat_intent_daily
FROM anon` (analytics is never anon), then regenerate the baseline. Migration +
baseline update, one deploy.

**S2 — refund path is not concurrency-safe (money, blocker-class).**
`process-refund` (and `batch-refund`) do a read-modify-write on `total_refunded`
with no lock and no DB CHECK. Concurrent refunds (Phase 1.4/1.5) can double-refund
up to the ceiling twice. Fix: wrap read+write in an atomic RPC with
`SELECT … FOR UPDATE` on the booking (mirror the hold path), and add
`CHECK (total_refunded <= total_captured)` as a hard backstop.

**S3 — capacity decrements are non-atomic (held drift, real & already visible).**
Increments are atomic (FOR UPDATE RPC) but every `held` **decrement** is a JS
read-modify-write `held: Math.max(0, slot.held - qty)` across ~10 call sites.
Concurrent expiries/cancels lose updates → phantom-reserved seats. Already present:
7 prod slots have `held > 0` with zero backing ACTIVE holds (one from 2026-07-07,
so not just legacy). Fix: single atomic RPC `adjust_slot_held(slot_id, delta)` →
`UPDATE slots SET held = GREATEST(0, held + delta) WHERE id = slot_id`, routed
through by all callers. Then a one-off reconcile to zero the 7 stuck slots.

**S4 — 1 PAID booking with no payment id.** `f8815206…` (created 2026-07-11,
`payment_method=null`, `voucher_amount_paid=0`). Likely manual-mark-paid or a
test row; needs one operator confirmation. Not systemic.

**S5 — `payfast-itn` fails OPEN (plan Phase 5 item, confirmed).**
`validateWithPayFast` returns `true` on network error (`catch { return true }`)
→ a validation outage marks bookings PAID unverified. Not in `config.toml`
(deploy status unconfirmed). Decision: fail-closed (`return false`) or disable
until a client needs PayFast. Recommended: disable.

**S6 — `getyourguide-webhook` accepts unsigned when no secret (plan item, confirmed).**
Signature verification is gated behind `if (webhook_secret_encrypted && KEY)`; a
tenant without a configured GYG secret processes any unsigned payload as a real
booking. Fix: fail-closed when no secret, or mandate secrets at onboarding.

## Verdict (per plan rubric)
Not rollout-ready as-is. **S1 (isolation) and S2 (money) are disqualifying-class**
and must be fixed + re-verified. S3 is a live correctness bug. S5/S6 are the plan's
own forced decisions, both confirmed. None of the actual load phases (1.3–1.4,
2.1–2.2, 3–6) have been executed — those need a stress environment and are the
remaining work before a real go/no-go.
