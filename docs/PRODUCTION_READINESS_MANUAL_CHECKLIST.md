# Production Readiness Manual Checklist

Manual QA checklist for proving the v1 MVP is production-ready.

Scope: standard single-tour bookings, Yoco payments, vouchers, promos, WhatsApp bot, webchat bot, admin operations, and operational resilience.

Out of scope for v1: combo deals and Paysafe. Combo/Paysafe must be disabled and inaccessible unless explicitly re-enabled for v2.

## How To Use This Checklist

For every item, record:

- Result: PASS / FAIL / BLOCKED / N/A.
- Evidence: screenshot, screen recording, SQL output, function logs, provider dashboard evidence, or exact bot transcript.
- Ticket: required for every FAIL.
- Retest: required after every fix.

Do not mark production ready if any launch-scope Critical item fails or is blocked.

## Evidence Folder

Create an evidence folder for the run:

```text
production-readiness/YYYY-MM-DD/
  00-environment/
  01-booking/
  02-payments/
  03-vouchers-promos/
  04-bots/
  05-admin/
  06-mobile-ui/
  07-degraded-mode/
  08-security/
  09-go-no-go/
```

## Gate 0: Environment And Scope

| ID | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| G0.1 | Confirm staging URL for customer booking site | URL recorded and reachable |  |  |
| G0.2 | Confirm staging URL for admin app | URL recorded and reachable |  |  |
| G0.3 | Confirm Supabase staging project ref | Project ref recorded |  |  |
| G0.4 | Confirm database migrations applied | Latest migration recorded |  |  |
| G0.5 | Confirm Yoco test keys and webhook secret | Test mode only |  |  |
| G0.6 | Confirm Paysafe/combo disabled for MVP | No customer can enter combo checkout |  |  |
| G0.7 | Confirm WhatsApp sandbox/test number | Points to staging webhook |  |  |
| G0.8 | Confirm webchat uses staging backend | Messages hit staging `web-chat` |  |  |
| G0.9 | Confirm Resend staging sender | No production customer emails |  |  |
| G0.10 | Confirm test customers/phones | No real customer data used |  |  |
| G0.11 | Confirm SQL/log access | Operator can query DB and function logs |  |  |
| G0.12 | Confirm rollback/restore commands | Written before degraded tests |  |  |

Stop if G0.1-G0.12 are not complete.

## Gate 1: Combo Deals Disabled For MVP

| ID | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| C1 | Customer site navigation | No combo/partner deal CTA visible |  |  |
| C2 | Direct combo URL | Shows coming-soon/disabled page, not checkout |  |  |
| C3 | Combo API GET | Returns disabled response or empty MVP-safe response |  |  |
| C4 | Combo API POST | Returns disabled response, no DB mutation |  |  |
| C5 | Paysafe checkout function | Disabled for MVP; no live Paysafe call |  |  |
| C6 | Paysafe webhook | ACKs safely or disabled; no booking mutation |  |  |
| C7 | Admin combo settings | Hidden or clearly marked v2 |  |  |

Failure of C1-C6 is launch-blocking if combo is out of scope.

## Gate 2: Automated Sanity Checks

| ID | Check | Command / Action | Expected | Result | Evidence |
|---|---|---|---|---|---|
| A1 | Unit tests | `npm run test:unit` | All pass |  |  |
| A2 | Lint | `npm run lint` | No launch-blocking errors |  |  |
| A3 | Build | `npm run build` | Production build succeeds |  |  |
| A4 | Existing E2E smoke | `npx playwright test` if configured | Pass or documented non-launch blockers |  |  |

If build fails, stop. Do not launch.

## Gate 3: Standard Booking Flow

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| B1 | Landing to booking | Open booking site, choose tour | Tour selection works |  |  |
| B2 | Slot selection | Pick available date/time | Slot selectable, clear price shown |  |  |
| B3 | Customer details | Enter valid name/email/SA phone | Form accepts and normalizes phone consistently |  |  |
| B4 | Invalid email | Enter invalid email | Clear validation error |  |  |
| B5 | Invalid/short phone | Enter invalid phone | Clear validation or normalization behavior |  |  |
| B6 | Draft save | Fill required draft fields, blur email | DRAFT row created only when expected |  |  |
| B7 | Zero add-on quantity | Add add-on then set qty 0 | Add-on removed from total and DB |  |  |
| B8 | Duplicate submit | Double-click booking submit on slow network | One booking only |  |  |
| B9 | Full slot hidden | Capacity-0 slot | Not selectable or clear sold-out error |  |  |
| B10 | Past slot hidden | Past/too-soon slot | Not selectable |  |  |
| B11 | Direct past-slot attempt | Submit/API/RPC with past slot | Server rejects |  |  |
| B12 | Direct full-slot attempt | Submit/API/RPC with full slot | Server rejects |  |  |

## Gate 4: Yoco Payment And Webhook Idempotency

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| Y1 | Create Yoco checkout | Complete booking until payment link | HELD booking and active hold created |  |  |
| Y2 | Successful payment | Pay with Yoco test card | Booking paid/confirmed |  |  |
| Y3 | Confirmation page | Return from payment | Correct booking details shown |  |  |
| Y4 | Customer email | Check inbox/Resend logs | One confirmation email |  |  |
| Y5 | WhatsApp confirmation | Check sandbox phone/logs | One confirmation message |  |  |
| Y6 | Slot conversion | Query slot | `held` decremented, `booked` incremented once |  |  |
| Y7 | Duplicate webhook replay | Replay exact same Yoco success webhook | No duplicate email/message/slot increment |  |  |
| Y8 | Parallel duplicate webhook | Fire same success webhook twice in parallel | One processed side effect |  |  |
| Y9 | Failed/cancelled payment | Cancel or fail checkout | Booking not confirmed; hold eventually releases |  |  |

Critical fail: duplicate charge, duplicate confirmation side effect, or paid booking without confirmation.

## Gate 5: Capacity, Holds, And Race Conditions

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| R1 | Last spot N=2 | Capacity 1, fire 2 bookings in parallel | 1 success, 1 clean failure |  |  |
| R2 | Last spot N=5 | Capacity 1, fire 5 bookings in parallel | 1 success, 4 clean failures |  |  |
| R3 | Capacity 3 N=10 | Capacity 3, fire 10 bookings in parallel | 3 successes, 7 clean failures |  |  |
| R4 | Invariant query | After each race | `booked + held <= capacity_total` |  |  |
| R5 | Expired normal hold | Expire active hold, run cron | `slots.held` released exactly once |  |  |
| R6 | Hold cleanup idempotency | Run cleanup again | No double release |  |  |
| R7 | Abandoned checkout | Create checkout, do not pay | Hold releases after expiry/grace |  |  |

Critical fail: any overbooking or stuck held capacity that does not self-heal.

## Gate 6: Vouchers

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| V1 | Valid voucher partial | Apply voucher less than total | Discount applied correctly |  |  |
| V2 | Valid voucher full payment | Voucher covers full amount | Booking confirms only after capacity hold succeeds |  |  |
| V3 | Expired voucher | Apply expired voucher | Clear expired message, no balance movement |  |  |
| V4 | Exhausted voucher | Apply zero-balance voucher | Clear unavailable/insufficient message |  |  |
| V5 | Concurrent drain N=2 | Same voucher, 2 parallel attempts | One success or correct split; balance never negative |  |  |
| V6 | Concurrent drain N=5 | Same voucher, 5 parallel attempts | Balance never negative |  |  |
| V7 | Cross-channel drain | WhatsApp + webchat same voucher | One clean winner, one clean failure |  |  |
| V8 | Remaining balance message | Partial voucher use | Remaining balance communicated once |  |  |

Critical fail: negative balance, duplicate redemption beyond balance, or confirmed booking after failed capacity hold.

## Gate 7: Promo Codes

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| P1 | Valid promo | Apply active promo | Discount correct |  |  |
| P2 | Expired promo | Apply expired promo | Clear expired message |  |  |
| P3 | Exhausted promo | Apply maxed-out promo | Clear no-longer-available message |  |  |
| P4 | Minimum order | Apply below min order | Message includes minimum amount |  |  |
| P5 | Same email reuse | Use same promo twice | Second use blocked |  |  |
| P6 | Email casing | Use `A@B.COM` then `a@b.com` | Second use blocked |  |  |
| P7 | Concurrent same customer | 5 parallel attempts same promo/email | One use only |  |  |
| P8 | Global max uses race | Promo max uses 1, 5 customers parallel | One use only |  |  |

Critical fail: duplicate promo use when product rule forbids it.

## Gate 8: WhatsApp Bot

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| WA1 | Webhook verification | Send bad signature | 401, no processing |  |  |
| WA2 | Valid inbound | Send signed text webhook | 200, reply sent |  |  |
| WA3 | Duplicate inbound | Replay same message ID | One reply only |  |  |
| WA4 | New booking flow | Complete booking info | Correct collected data |  |  |
| WA5 | Payment handoff | Reach payment-link stage | Link is for correct tour/slot/qty |  |  |
| WA6 | Full slot | Ask for full slot | No payment link; alternatives or handoff |  |  |
| WA7 | Expired voucher | Provide expired voucher | Clear rejection and alternate payment option |  |  |
| WA8 | Stale session | Simulate idle > TTL, message again | Restart or re-confirm; no old payment link |  |  |
| WA9 | Ambiguous cancel | “Can I cancel?” | Clarifying question |  |  |
| WA10 | Cancellation policy | “What is your cancellation policy?” | KB answer, not cancellation action |  |  |
| WA11 | Out-of-KB | Ask unrelated question | Refusal + human handoff offer |  |  |
| WA12 | Prompt injection | Run WB7 prompt list | No prompt leak, no fake discounts |  |  |
| WA13 | Media/voice/location | Send unsupported media | Friendly text-only fallback |  |  |
| WA14 | Outbound failure | Simulate WhatsApp send failure | Failure logged; no false delivered state |  |  |
| WA15 | Cold start | Send after idle period | Message processed, no loss |  |  |
| WA16 | Admin-cancel awareness | Cancel booking in admin, ask bot status | Bot reports current cancelled status |  |  |

Critical fail: prompt leak, fake discount, session contamination, silent message loss, or payment link for unavailable slot.

## Gate 9: Webchat Bot

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| WC1 | Widget opens | Click launcher | Widget opens without layout break |  |  |
| WC2 | New booking flow | Complete booking info | Correct collected data |  |  |
| WC3 | Payment handoff | Reach payment-link stage | Correct link and clear availability wording |  |  |
| WC4 | Refresh behavior | Refresh mid-flow | Defined behavior: resume or restart cleanly |  |  |
| WC5 | Parallel sessions | Two browsers, different customers | No state contamination |  |  |
| WC6 | Same user as WhatsApp | Use webchat + WhatsApp simultaneously | No cross-channel contamination |  |  |
| WC7 | Full slot | Ask for full slot | No payment link; alternatives/handoff |  |  |
| WC8 | Expired voucher | Provide expired voucher | Clear rejection and alternate payment option |  |  |
| WC9 | Out-of-KB | Ask unrelated question | Refusal + handoff offer |  |  |
| WC10 | Prompt injection | Run WB7 prompt list | No prompt leak, no fake discounts |  |  |
| WC11 | Network failure | Kill/block request | User sees recoverable error |  |  |
| WC12 | Function 500 | Force/test failure path | No stack trace, clear retry/handoff |  |  |

Critical fail: prompt leak, fake discount, cross-session leak, or silent message loss.

## Gate 10: Bot Handoff Races

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| H1 | WhatsApp last-spot race | Bot reaches payment link, web user takes last spot, bot user clicks | No charge; sold-out recovery |  |  |
| H2 | Webchat last-spot race | Same as H1 via webchat | No charge; sold-out recovery |  |  |
| H3 | WhatsApp voucher race | WhatsApp + webchat use same voucher | One succeeds, one cleanly fails |  |  |
| H4 | Payment-link stale slot | Click old bot payment link after slot full | No charge; choose another time |  |  |
| H5 | Payment-link stale voucher | Click old link after voucher drained/expired | Discount rejected safely |  |  |

Critical fail: customer is charged for an unavailable slot or stale discount.

## Gate 11: Admin Operations

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| AD1 | Login | Sign in as admin | Dashboard loads |  |  |
| AD2 | Bookings list | Open bookings | Loads, filters/search work |  |  |
| AD3 | Booking detail | Open booking | Correct customer/tour/payment data |  |  |
| AD4 | Manual booking | Create booking in admin | Booking created once |  |  |
| AD5 | Cancel booking | Cancel paid booking | Status cancelled, capacity released, customer notified |  |  |
| AD6 | Cancel already-cancelled | Repeat cancellation | Idempotent; no duplicate refund/email |  |  |
| AD7 | Refund flow | Process refund/test refund | No duplicate refund possible |  |  |
| AD8 | Manual mark paid | Mark pending booking paid | Slot/booked state correct, one confirmation |  |  |
| AD9 | Slot close/weather cancel | Close slot with bookings | Bookings handled, capacity consistent |  |  |
| AD10 | Reports/settings/photos | Open key operations pages | No launch-blocking console errors |  |  |

## Gate 12: Email, WhatsApp, And Notifications

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| N1 | Booking confirmation email | Complete paid booking | One correct email |  |  |
| N2 | Booking confirmation WhatsApp | Complete paid booking | One correct WhatsApp message |  |  |
| N3 | Cancellation email/message | Cancel booking | One clear cancellation notice |  |  |
| N4 | Reminder/outbox | Trigger scheduled message | Sent or queued as expected |  |  |
| N5 | Duplicate prevention | Replay trigger | No duplicate notifications |  |  |
| N6 | Missing email key | Remove in staging only | Booking still completes; email 503 logged |  |  |
| N7 | WhatsApp API failure | Simulate failure | Error logged; retry/queued/recoverable state |  |  |

## Gate 13: Degraded Mode

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| D1 | Resend key missing | Unset in staging | 503 from email function, booking unaffected |  |  |
| D2 | Gemini key missing | Unset in staging | Bot fallback/handoff, no silence |  |  |
| D3 | Gemini timeout | Force timeout | Fallback within 10 seconds |  |  |
| D4 | WhatsApp outbound unreachable | Simulate failure | No false delivered state |  |  |
| D5 | Webchat backend error | Force function error | User sees recoverable message |  |  |
| D6 | Supabase function cold start | Wait idle, send message | First and second messages processed |  |  |
| D7 | Network slow 3G | Full booking flow | Loading states, no blank screen |  |  |

Do not run D1-D4 against production.

## Gate 14: Mobile, Responsive, And Browser Coverage

| ID | Check | Device / Viewport | Expected | Result | Evidence |
|---|---|---|---|---|---|
| M1 | Booking flow 320px | DevTools 320 | Complete without horizontal scroll |  |  |
| M2 | Booking flow 375px | DevTools 375 | Complete without zoom |  |  |
| M3 | Booking flow 414px | DevTools 414 | Complete without layout break |  |  |
| M4 | Real iOS | Safari | Full booking smoke pass |  |  |
| M5 | Real Android | Chrome | Full booking smoke pass |  |  |
| M6 | Webchat 320px | DevTools 320 | Widget fits and usable |  |  |
| M7 | Admin mobile 375px | DevTools or phone | Dashboard/bookings usable |  |  |
| M8 | Desktop Chrome | 1280+ | Core flows pass |  |  |
| M9 | Desktop Safari/Firefox | 1280+ | Core flows pass |  |  |
| M10 | Slow 3G | 375px | Loading states and no timeout |  |  |

If real devices are unavailable, record: "DevTools only; real-device verification outstanding."

## Gate 15: Dark Mode / Theme Scope

| ID | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| T1 | Decide v1 dark-mode support | Supported or explicitly light-only |  |  |
| T2 | Booking pages | Readable in supported theme |  |  |
| T3 | Confirmation/failure pages | Readable in supported theme |  |  |
| T4 | Webchat widget | Fits supported theme or documented light-only |  |  |
| T5 | Admin pages | Readable in supported theme |  |  |
| T6 | Payment provider pages | Provider behavior documented |  |  |

Do not fail v1 for unsupported dark mode if product explicitly declares light-only MVP.

## Gate 16: Security, Privacy, And Access Control

| ID | Check | Steps | Expected | Result | Evidence |
|---|---|---|---|---|---|
| S1 | No secrets in client bundle | Search/build inspect | No service role/API secrets exposed |  |  |
| S2 | Webhook signature required | Bad Yoco/WA signatures | Rejected |  |  |
| S3 | RLS/customer reads | Try reading another customer booking | Blocked |  |  |
| S4 | Admin auth | Access admin logged out | Redirect/login required |  |  |
| S5 | Role isolation | Operator/admin permissions | Correct access only |  |  |
| S6 | Bot prompt leakage | Injection suite | No system prompt/KB structure leaked |  |  |
| S7 | Logs privacy | Review logs | No card data/secrets/raw tokens |  |  |
| S8 | CORS/origin | Request from unknown origin | Blocked or safe response |  |  |
| S9 | Rate abuse | Rapid bot messages | Rate-limited or gracefully handled |  |  |

Critical fail: secret leak, cross-customer data exposure, or prompt/system leak.

## Gate 17: Operational Readiness

| ID | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| O1 | Error log access | Operator can view Supabase function logs |  |  |
| O2 | Provider dashboards | Yoco, Resend, WhatsApp accessible |  |  |
| O3 | Cron schedule | Hold cleanup/reminders configured |  |  |
| O4 | Backup/restore | Supabase backup policy known |  |  |
| O5 | Rollback plan | Last known good deploy identified |  |  |
| O6 | Incident contacts | Owner/on-call contact known |  |  |
| O7 | Manual recovery | Can manually cancel/release stuck booking |  |  |
| O8 | Support scripts | Common SQL queries saved |  |  |
| O9 | Launch monitoring window | First 24h monitoring assigned |  |  |

## Required SQL Checks

Run before and after stateful tests.

```sql
-- Slot capacity invariant
select id, capacity_total, booked, held
from slots
where booked + held > capacity_total;

-- Active expired holds that should have been cleaned
select id, booking_id, slot_id, expires_at, status
from holds
where status = 'ACTIVE'
  and expires_at < now() - interval '5 minutes';

-- Duplicate promo use by normalized email
select promotion_id, lower(email) as email, count(*)
from promotion_uses
group by promotion_id, lower(email)
having count(*) > 1;

-- Negative voucher balances
select id, code, current_balance
from vouchers
where current_balance < 0;

-- Pending bookings older than expected
select id, status, created_at, payment_deadline
from bookings
where status in ('HELD', 'PENDING', 'PENDING PAYMENT')
  and created_at < now() - interval '1 hour';
```

## Go / No-Go Summary

Fill this in at the end.

```text
Run date:
Operator:
Environment:
Git commit:
Supabase project:

Total checks:
Passed:
Failed:
Blocked:
N/A:

Critical failures:
Major failures:
Minor failures:
Blocked launch-scope checks:

Combo/Paysafe disabled for MVP: YES / NO
Standard booking ready: YES / NO
Yoco payments ready: YES / NO
Vouchers/promos ready: YES / NO
WhatsApp bot ready: YES / NO
Webchat bot ready: YES / NO
Admin operations ready: YES / NO
Mobile/browser ready: YES / NO
Operational monitoring ready: YES / NO

Recommendation: GO / NO-GO / GO-WITH-CAVEATS
```

## Automatic No-Go Conditions

Any of these means NO-GO for launch scope:

- Build fails.
- Customer can access combo/Paysafe checkout in MVP.
- Duplicate payment confirmation side effects.
- `booked + held > capacity_total`.
- Expired holds do not release capacity.
- Voucher balance goes negative.
- Promo duplicate-use rule is bypassed.
- Bot leaks prompt/system/KB internals.
- Bot grants fake discount/free tour/refund.
- WhatsApp or webchat silently drops customer messages.
- Cross-customer or cross-channel session contamination.
- Payment captured but booking not confirmed.
- Service role key, provider token, card data, or customer-private data exposed.

