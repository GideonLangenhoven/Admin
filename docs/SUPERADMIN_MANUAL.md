# BookingTours — Super Admin Manual

**Platform operations guide for BookingTours staff.**

This manual is for **Super Admins** — the BookingTours platform team who create and manage tenant businesses across the whole platform. It assumes you already understand the operator-facing product (see the **Operator User Manual**); this document focuses on the platform-management capabilities that only Super Admins have.

> **Who is a Super Admin?** A member of the BookingTours platform team. Super Admins are *not* tenant staff — they operate above individual businesses and can create, configure, suspend, and support every tenant. Super Admins are exempt from tenant-level restrictions (including subscription suspension).

---

## Table of Contents

1. How Super Admin access works
2. The roles model (Operator / Main Admin / Super Admin)
3. Onboarding a new tenant business
4. Managing existing businesses
5. Subscriptions & suspension
6. Team seats & tenant admin management
7. Landing page generator
8. Email usage & overage billing
9. OTA drift monitor
10. Security model (how the platform is protected)
11. Common Super Admin tasks (step-by-step)
12. Troubleshooting
13. Quick reference

---

## 1. How Super Admin access works

Super Admin tools live at **`/super-admin`** in the admin app. Access is protected in two layers:

- **Page gate (UX):** the app redirects anyone without a Super Admin role away from `/super-admin` and `/ota-drift` so they never see the page shell. This is a convenience layer only.
- **Server-side checks (the real boundary):** every privileged API call is validated on the server against the signed-in user's actual role in the `admin_users` table. A forged cookie or a direct URL gets nothing — the server rejects it.

You must sign in with a Super Admin account. Some Super Admin actions (like onboarding a tenant) additionally require you to **re-enter your email and password** in the form as an authorization step.

## 2. The roles model

| Role | Scope | Can do | Cannot do |
|---|---|---|---|





| **Operator** | One business | Bookings, inbox, manifest/check-in, refunds, marketing, photos, weather | Settings, billing, team management, platform admin |
| **Main Admin** | One business | Everything for their business: settings, billing, team, integrations, reports | Reach any Super Admin route or other tenants' data |
| **Super Admin** | Whole platform | Create/manage all tenants, set subscriptions, seats, landing pages, email billing, OTA drift; exempt from subscription suspension | — |

Roles are stored in `admin_users.role`. A single person can hold different roles in different businesses. Regular Main Admins can further grant **per-section Settings permissions** to their own team, but that never crosses into Super Admin territory.

## 3. Onboarding a new tenant business

**Where:** `/super-admin` → the onboarding form (top section).

This provisions a complete, ready-to-configure tenant environment.

### Steps
1. **Authorize yourself** — enter your Super Admin **email and current password** in the form. These are verified before anything is created.
2. **Business details:**
   - **Business name** (required)
   - **Tagline** (optional)
   - **Booking subdomain** (required) — becomes `subdomain.booking.bookingtours.co.za`. Must be unique; it's lowercased and sanitised.
   - **Main admin name & email** (required) — the tenant's first administrator, who receives a setup invitation.
3. **Localisation:** timezone (e.g. `Africa/Johannesburg`) and currency (e.g. `ZAR`).
4. **Branding:** upload a logo.
5. **Credentials (optional but recommended):**
   - **Yoco** secret key + webhook secret. The secret key is **validated against Yoco's API before the business is created** — an invalid key blocks onboarding.
   - **WhatsApp** access token + phone ID.
6. Submit.

### What gets provisioned
- A new **business** record (subdomain, timezone, currency, logo).
- The tenant's **Main Admin** account (with a "must set password" flag).
- **Seven booking-site URLs** auto-derived from the subdomain (success, cancel, voucher, waiver, etc.).
- Any provided **Yoco/WhatsApp credentials**, stored **encrypted**.
- An **idempotency key** so an accidental retry doesn't create a duplicate business.

### After onboarding
- The Main Admin receives a **setup email** with a password-creation link.
- Subscription defaults to **Active**.
- The tenant can immediately configure tours, staff, branding, and payments.

> **Gotchas:** the subdomain must be unique; Yoco validation happens before creation so bad keys stop the process; custom domains still need manual DNS/hosting configuration.

## 4. Managing existing businesses

**Where:** `/super-admin` → Business Management (the tenant list).

Each business row shows its name and ID, subscription status, seat usage, and subdomain. Expand **View / Edit Details** to edit, across grouped sections:

- **Business info** — name, tagline, support email, timezone, currency, logo, sender ("from") email.
- **Branding & colours** — hero copy and colour palette, chatbot avatar.
- **Operations & content** — directions/meeting point, what to bring/wear.
- **Booking page labels & footer** — custom nav labels and footer text.
- **Booking site URLs** — override the auto-derived URLs, or **Regenerate from subdomain** to re-sync them.
- **Social links** — used in emails and the booking-site footer.
- **Terminology** — activity noun/verb and location phrases used in copy and emails.
- **Hero / marketing / weather** — hero image, marketing test email, and a toggle enabling weather-cancel logic for the tenant.
- **AI chatbot** — the tenant's custom system prompt.
- **FAQs** — question/answer pairs that ground the chatbot.
- **Legal & policies** — terms, privacy, cookies.
- **Tours (read-only)** — an overview of the tenant's tours (edited by the tenant in their own dashboard).
- **Admin users** — list the tenant's admins; **reset an admin's password** directly here if needed.

Click **Save All Changes** to persist.

> **Tips:** the "from" email must be verified with the email provider or sends fail; changing timezone only affects future reminders, not existing booking times; hero/tour image URLs must be publicly reachable.

## 5. Subscriptions & suspension

**Where:** `/super-admin` → Business Management → the status badge on each business.

Click the status badge to toggle a tenant between **Active** and **Suspended**.

**What suspension does (enforced server-side):**
- The tenant's **Main Admin and Operator users lose privileged API access** — they cannot manage bookings, inbox, settings, reports, marketing, etc.
- **Exception:** the tenant's **Billing** pages stay reachable, so they can reactivate/pay.
- **Super Admins are exempt** and keep full access.
- A tenant with **no subscription record** is treated as Active (so newly-created tenants are never accidentally locked out).

Valid statuses include **Active, Trial, Paused, Suspended, Cancelled**. Only Active/Trial grant full access. Use suspension for non-payment or policy enforcement; the tenant's data is preserved throughout.

## 6. Team seats & tenant admin management

- **Seats** — adjust a business's maximum admin seats with the +/- controls; usage (e.g. "2/3") is shown. Changing the limit controls how many new admins can be invited; it doesn't remove existing ones.
- **Reset a tenant admin's password** — expand a business, find the admin under Admin Users, and reset directly (no need for their current password). Use this for locked-out tenants.
- **Suspended admins** (an individual account flag, separate from subscription suspension) cannot sign in at all.

## 7. Landing page generator

**Where:** `/super-admin` → Landing Pages.

Generate a polished marketing landing page for a tenant from their live data.

1. Choose a business and a **template** from the gallery.
2. Click **Generate** — the tool pulls the business's branding, copy, and tours into the template and renders a live preview.
3. **Download** the HTML (or an IDE package), or open it full-page to test.
4. Follow the on-screen **deploy instructions** (hosting CLI commands + custom-domain DNS steps).

> **Gotchas:** template files must exist for the chosen style; hero images and tour images must be publicly reachable or they'll appear broken; custom domains require manual DNS/hosting setup. Some templates may contain placeholder stats/testimonials — review before publishing.

## 8. Email usage & overage billing

**Where:** `/super-admin` → Email Usage & Billing.

Track marketing email volume per tenant and bill for overages.

1. **Pick a month.** The table refreshes for that period.
2. Review the **summary** (total emails sent, tenants over their limit, total overage due) and the **per-business table** (sent, included, overage, rate, amount owed).
3. **Edit the per-email rate** for a business inline if needed.
4. Click **Invoice** for any tenant with an overage to generate an invoice line item.

> **How pricing works:** each business has an included monthly email allowance and a per-email overage rate. Usage is tracked automatically. **Note:** email limits are advisory — the system keeps sending over the limit; you bill for the overage. Invoice generation is **not idempotent**, so avoid clicking **Invoice** twice for the same period.

## 9. OTA drift monitor

**Where:** `/ota-drift` (Super Admin; may be hidden from the nav but reachable by URL).

Detects booking mismatches between BookingTours and connected OTA channels (Viator, GetYourGuide). A daily reconciliation compares your records against the OTA's and flags drift.

- **Summary** — recent runs, total drifts, clean runs.
- **Per run** — channel, timestamp, our count vs. OTA count, matched count, and status.
- **Drift types:**
  - *missing_locally* — the OTA has a booking you don't (possible webhook loss).
  - *missing_on_ota* — you have a booking the OTA doesn't (possible sync lag/deletion).
  - *amount_mismatch* — totals differ between systems.
  - *status_mismatch* — e.g. cancelled on one side but active on the other.

**Response workflow:** decide if the drift is expected; if a booking should exist, re-sync or contact the OTA; if it's orphaned locally, cancel it to free inventory; confirm resolution in the next day's run. Runs are scoped per tenant, and there is no automatic remediation — every drift is a manual decision.

## 10. Security model (how the platform is protected)

Understanding this helps you support tenants safely and answer buyer security questions.

- **Multi-tenant isolation:** every business-scoped table carries a `business_id` and is protected by row-level security. One tenant can never read or modify another's data. (Combo bookings across operators are the single intentional cross-tenant flow, with settlements split per tenant.)
- **Page gates vs. server checks:** the `/super-admin` and `/ota-drift` page gates are **UX only**. The real boundary is the **server-side role + ownership check on every API call**, so a forged cookie or direct URL is rejected.
- **Subscription enforcement:** access for suspended tenants is blocked **on the server** (billing routes excepted), so it cannot be bypassed from the browser.
- **Payment webhooks:** every payment webhook verifies its signature **before** any database write and is idempotent (safe against replays/duplicates).
- **External (B2B) API:** partner integrations must sign their requests (HMAC) for any booking-changing action; read-only availability may use an API key alone.
- **Encrypted secrets:** tenant Yoco/WhatsApp credentials and OTA keys are stored encrypted; secret keys live only in server environments, never in browser code.
- **Security baseline:** the expected security state of every table is recorded in `supabase/security-baseline.json`. Before any deploy, run `npm run check-security-drift` (with a database connection) — it must pass (exit 0). If it reports drift, either the change was intentional (update the baseline) or the live database must be corrected.

## 11. Common Super Admin tasks (step-by-step)

**Onboard a new tenant (~5 min)**
1. `/super-admin` → onboarding form.
2. Enter business name, admin name/email, subdomain, timezone, currency; optionally logo, Yoco keys, WhatsApp.
3. Enter your Super Admin email + password to authorise.
4. Submit. Confirm the success message shows the new business + admin.
5. The tenant admin receives a setup email; find the new business under Business Management.

**Suspend a tenant (~30 sec)**
1. `/super-admin` → Business Management → find the tenant.
2. Click the green **Active** badge → confirm.
3. Their staff lose access immediately (except Billing). Toggle back to reactivate.

**Reset a tenant admin's password (~1 min)**
1. `/super-admin` → Business Management → expand the business.
2. Under Admin Users, click **Reset Password** for the admin and set a new one.

**Bill email overage (~5 min)**
1. `/super-admin` → Email Usage & Billing → pick the month.
2. Adjust any per-email rates, then click **Invoice** for each tenant with an overage (once only per period).

**Investigate an OTA drift (~10 min)**
1. `/ota-drift` → review recent runs.
2. Expand a flagged run, read the drift type/details, cross-check with the OTA.
3. Re-sync or cancel locally as appropriate; verify in the next run.

**Change a tenant's subdomain**
1. `/super-admin` → Business Management → set/change subdomain.
2. Use **Regenerate from subdomain** to re-sync the booking-site URLs.

## 12. Troubleshooting

| Issue | Likely cause | Fix |
|---|---|---|
| Onboarding rejected: "Invalid Yoco API keys" | Wrong or test key supplied where a live key is expected | Get the correct live secret key from the tenant's Yoco dashboard and retry. |
| Tenant admin didn't get the setup email | Delivery delay or wrong address | Wait ~1 minute and check spam; otherwise use Reset Password to re-trigger. |
| Subdomain change didn't update booking URLs | URLs were manually overridden | Use **Regenerate from subdomain**. |
| Landing page shows broken images or 404 | Missing template file or unreachable image URLs | Verify the template exists and that logo/tour/hero images are public. |
| Suspended tenant still seems to have access | Cached browser session | Confirm the subscription shows Suspended; have them hard-refresh. Server calls will already be blocked. |
| OTA drift keeps recurring | Persistent webhook/sync issue with the channel | Check the channel credentials and contact OTA support; reconcile manually until clean. |

## 13. Quick reference

**Key URLs**
- Super Admin console: `/super-admin`
- OTA drift monitor: `/ota-drift`
- A tenant's booking site: `https://{subdomain}.booking.bookingtours.co.za`

**Roles:** Operator (one business, ops only) · Main Admin (one business, full) · Super Admin (whole platform, exempt from suspension).

**Before any deploy:** run `npm run check-security-drift` — must pass (exit 0).

**Suspension effect:** tenant staff blocked server-side except Billing; Super Admins exempt; no subscription record = treated as Active.

---

*BookingTours Super Admin Manual · last updated 2026-07-02. For tenant-facing feature detail, see the Operator User Manual.*
