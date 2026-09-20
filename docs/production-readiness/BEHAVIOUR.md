# Behaviour baseline

Status: evolving G0 record for candidate `76d00f3157acb2c73159bef6b8d40a108a9e767d`. This is not a release test result.

| Capability | Intended behavior to preserve | Observed defect / evidence gap | Required proof |
|---|---|---|---|
| Demo login and browsing | Shared demo is read-only; login may refresh only isolated synthetic dates | Alternate API/RPC/Storage/worker coverage not yet proven | Positive browse plus zero-side-effect negative tests |
| Existing account login/recovery | Linked Auth and genuine legacy users retain IDs and recover without re-onboarding | Normal login and recovery still use duplicate SHA-256 password hashes; reset claim race remains | Old/new account login, atomic reset, replay/expiry, recovery; hashes retained until compatible cutover |
| Refund initiation | Authorized own-tenant staff/customer-support path works; customer cancellation choice stays separate | Role policy conflicts across docs; unknown-role match and wrapper elevation need hardening | Approved matrix; allowed and denied roles; zero provider/DB effect when denied |
| Refund execution | Captured amount/mode/currency bounds, durable operation ID, retry-safe pending/unknown state | Batch collapses 202/manual-required into success; audit tenant uses request body; audit writes unchecked | Mixed completed/pending/failed/unprocessed batch with stable IDs |
| Booking bulk actions | UI summarizes actual final results and preserves accepted work if interrupted | `runBulk()` persists every selected ID as succeeded from unchanged initial state | Deterministic mixed-result regression plus interruption semantics |
| Guide check-in | Active own-tenant staff can check in once; client event ID makes replay idempotent | Offline worker deletes 401/429 and all other 4xx; account/tenant queue isolation and visible terminal failure absent | Recoverable auth/rate-limit retention, explicit reauth, no cross-user replay, visible terminal failure |
| Voucher reminders | Mark sent only after truthful provider outcome; retries use durable original intent | Cron path ignores email HTTP result | 401/429/5xx/network/crash boundary tests |
| Photo upload | Own-tenant guide workflow and tenant branding remain | No handler-level byte size or actual image validation | Valid image positive case; oversized/spoofed/foreign negative cases |
| Booking/onboarding companion flows | Approved pricing, booking, payment, voucher and branded public journeys continue | Exact deployed companion/onboarding revisions unknown; CI pin fails 3 Admin UI contract tests | Both candidate builds and authenticated staged cross-app E2E |

## Existing-customer continuity

Preserve business/admin/Auth/customer/booking/invoice/voucher IDs, relationships, balances, provider references, original payment modes, valid links, consent, and pending work. No database reset, account recreation, historical replay, blanket password reset, or forced re-onboarding is acceptable. The 100-account cross-version fixture and actual migration ledger are not yet available.

## Smoke-map minimum

Enabled user-visible areas requiring final smoke coverage: identity/onboarding; dashboard and tenant switch; bookings/calendar/search/manual booking; payments/refunds/vouchers/invoices; inbox/WhatsApp/web chat; marketing/consent; reports/exports; tours/settings/credentials/team/platform controls; guide check-in/photos/offline queue; public booking, customer portal, waiver, and notifications. Current unit/build evidence does not substitute for those journeys.
