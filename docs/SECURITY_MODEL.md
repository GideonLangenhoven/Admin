# Security Model — Admin Roles & Privilege Escalation

Audited: 2026-05-03 (Prompt 16)

## Admin Role Model

| Role | Scope | Can do |
|---|---|---|
| OPERATOR | Own tenant | View bookings/slots, check guests in. Cannot change settings, billing, or other admins. |
| ADMIN | Own tenant | Everything OPERATOR can, plus refunds, manual bookings, marketing, photos. |
| MAIN_ADMIN | Own tenant | Everything ADMIN can, plus billing, settings, credentials, manage other admins, partnerships. |
| SUPER_ADMIN | Cross-tenant | Onboard new businesses, manage invite tokens, view all tenants, manage subscriptions. |

## Privileged Endpoints

| Endpoint | Required Role | Tenant Check | Auth Method |
|---|---|---|---|
| `super-admin-onboard` (edge fn) | SUPER_ADMIN | N/A (creates new) | Email + password hash |
| `generate-invite-token` (edge fn) | SUPER_ADMIN | N/A (global) | Email + password hash |
| `/api/admin/setup-link` (send) | MAIN_ADMIN+ | Yes (own business) | JWT via Authorization header |
| `/api/admin/setup-link` (validate/complete) | None (token-gated) | N/A | Setup token (hashed, expiring) |
| `/api/credentials` (GET/POST) | MAIN_ADMIN+ | Yes (own business) | JWT via Authorization header |
| `/api/partnerships` (GET) | Any admin | Yes (own business) | JWT via Authorization header |
| `/api/partnerships` (invite/accept/revoke) | MAIN_ADMIN+ | Yes (own business) | JWT via Authorization header |
| `/api/partnerships` (accept_token) | None (token-gated) | N/A | Invite token + email match |
| `/api/partnerships/approve` (GET) | None (token-gated) | N/A | Invite token in URL |
| `/api/combo-offers` (all) | MAIN_ADMIN+ | Yes (own business) | JWT via Authorization header |
| `/api/combo-settlements` (all) | MAIN_ADMIN+ | Yes (own business) | JWT via Authorization header |
| `/api/combo-cancel` (operator) | Any admin | Yes (own business) | JWT via Authorization header |
| `cancel-booking` (edge fn) | Any admin | Yes (own business) | JWT via verifyAdminSession |
| `manual-mark-paid` (edge fn) | Any admin | Yes (own business) | JWT via requireAuth |
| `batch-refund` (edge fn) | Any admin | Yes (own business) | JWT via requireAuth |
| Settings page (add admin) | MAIN_ADMIN+ (UI) | Own business (RLS) | Supabase client session |
| Super-admin page | SUPER_ADMIN (UI) | All (UI-gated) | Supabase client session |

## Auth Patterns

### Edge Functions
- `requireAuth(req)` from `_shared/auth.ts` — validates JWT or service_role key, returns `{ userId, businessId, role, isServiceRole }`
- `verifyAdminSession(req)` — inline pattern in cancel-booking, returns `{ user_id, business_id, role }` or null
- Email + password hash — used by super-admin-onboard and generate-invite-token (separate from Supabase Auth)

### Next.js API Routes
- `getCallerAdmin(req)` from `app/lib/api-auth.ts` — extracts JWT from Authorization header, validates via `supabase.auth.getUser()`, looks up admin_users row, checks suspended status
- `isPrivilegedRole(role)` — returns true for MAIN_ADMIN or SUPER_ADMIN
- Frontend sends JWT via `getAuthHeaders()` from `app/lib/admin-auth.ts`

## What Was Hardened (Prompt 16)

| Endpoint | Bug | Severity | Fix |
|---|---|---|---|
| `/api/credentials` | No auth — anyone could overwrite WA/payment credentials for any business | CRITICAL | Added getCallerAdmin + MAIN_ADMIN role check + tenant guard |
| `/api/partnerships` | No auth — anyone could create/accept/revoke partnerships for any business | HIGH | Added getCallerAdmin + MAIN_ADMIN role check + tenant guard |
| `/api/combo-offers` | No auth — anyone could create/modify combo offers for any business | HIGH | Added getCallerAdmin + MAIN_ADMIN role check + tenant guard |
| `/api/combo-settlements` | No auth — anyone could view/mark settlements for any business | HIGH | Added getCallerAdmin + MAIN_ADMIN role check + tenant guard |
| `/api/admin/setup-link` (send) | No auth — anyone could trigger password reset emails and set must_set_password | HIGH | Added getCallerAdmin + MAIN_ADMIN role check + tenant guard |
| `super-admin-onboard` | Missing suspended check — suspended SUPER_ADMIN could create tenants | MEDIUM | Added suspended check after role verification |
| `generate-invite-token` | Missing suspended check — suspended SUPER_ADMIN could manage tokens | MEDIUM | Added suspended check after role verification |

## SECURITY DEFINER Functions (SQL RPCs)

All credential RPCs (`set_business_credentials`, `set_wa_credentials`, `set_yoco_credentials`, `set_paysafe_credentials`, `get_business_credentials`) are:
- SECURITY DEFINER (run with definer's privileges)
- REVOKE ALL FROM public, anon, authenticated
- GRANT EXECUTE TO service_role only

This means they can only be called via the service role key — which is only available server-side. No direct client-side exploitation possible.

Operational RPCs (`deduct_voucher_balance`, `create_hold_with_capacity_check`, `confirm_payment_atomic`, etc.) operate on row-level data and don't modify admin/role/tenant structures. Not an escalation surface.

## Known Limitations

- Client-side admin creation (`handleAddAdmin` in settings) hardcodes `role: "ADMIN"`, but a malicious admin with browser dev tools could modify the Supabase client insert to use `role: "MAIN_ADMIN"`. This depends on RLS INSERT policies on admin_users — should be verified.
- No standalone "forgot password" flow exists — password resets require a MAIN_ADMIN to trigger via settings page.
- Sub-tenant role changes (MAIN_ADMIN updating an ADMIN's role within same tenant) are not restricted beyond UI checks.
