# Onboarding completeness review + super-admin edit capability

**Date:** 2026-04-17
**Changes in this pass:** 3 code edits, 1 SQL backfill migration

---

## 0. What was fixed in this pass

### Code
- `~/Desktop/ActvityHub/Onboarding/app/api/onboarding/route.ts` — the `businessInsert` object now auto-derives all 6 customer-facing URLs from `booking_site_url`:
  - `manage_bookings_url = {base}/my-bookings`
  - `booking_success_url = {base}/success`
  - `booking_cancel_url = {base}/cancelled`
  - `gift_voucher_url = {base}/voucher`
  - `voucher_success_url = {base}/voucher-success`
  - `waiver_url = {base}/waiver`

- `~/Desktop/CapeKayak/capekayak/app/super-admin/page.tsx` — three changes:
  1. `saveSubdomain()` now updates all 6 derived URLs whenever the subdomain changes.
  2. New `regenerateDerivedUrls(businessId, subdomain)` helper — one-click reset of a tenant's 6 URLs to match their subdomain (undoes custom overrides).
  3. `saveBizDetail()` now persists 21 previously-uneditable fields: 6 booking URLs, 8 social links (Facebook, Instagram, TikTok, YouTube, Twitter, LinkedIn, TripAdvisor, Google Reviews), 3 terminology fields (`activity_noun`, `activity_verb_past`, `location_phrase`), `hero_image`, `marketing_test_email`, and a `weather_relevance` toggle.
  4. New UI fieldsets in the "View / Edit Details" panel: **Booking Site URLs** (with ⟲ Regenerate button), **Social Links**, **Terminology & Messaging**, **Hero / Marketing / Weather**.

### Database
- Migration `backfill_derived_urls_for_existing_tenants` — filled the 4 NULL URL columns on Atlantic Skydive (Cape Kayak already had them). Zero risk to existing flows (only writes COALESCE-defaults; never overwrites an existing non-NULL value).

### Where to edit what (post-fix)

| Role | Entry point | What they can edit |
|---|---|---|
| **Operator (self-service)** | `admin.bookingtours.co.za` → **Settings** page | Their own tenant: URLs, branding, policies, hero/nav/footer labels, tours, slots, credentials (Yoco/WhatsApp), marketing settings. Wide surface, well-developed. |
| **Super admin (fix-mistakes)** | `admin.bookingtours.co.za` → **Super Admin** page → **View / Edit Details** on any tenant row | Everything editable in Settings, plus cross-tenant access: change subdomain (auto-cascades URLs), toggle subscription status (suspend/reactivate), adjust seat limit, reset any admin's password, regenerate any tenant's 6 URLs in one click. |

---

## 1. What onboarding now collects and persists (post-fix)

### Fields the onboarding form collects and writes to `businesses`

**Contact & identity:**
- `name`, `business_name` — primary business name
- `business_tagline` — tagline
- `operator_email` — primary contact
- `subdomain` — URL slug (also used to derive booking_site_url)

**Booking-site URLs (all now auto-derived from subdomain):**
- `booking_site_url`
- `manage_bookings_url`
- `booking_success_url`
- `booking_cancel_url`
- `gift_voucher_url`
- `voucher_success_url`
- `waiver_url`

**Operations content:**
- `timezone`, `directions` (composed), `what_to_bring`, `what_to_wear`
- `terms_conditions`, `privacy_policy`, `cookies_policy` (composed from inputs)

**Branding:**
- `logo_url`, `chatbot_avatar`
- `color_main`, `color_secondary`, `color_cta`, `color_bg`, `color_nav`, `color_hover`
- `hero_eyebrow`, `hero_title`, `hero_subtitle`

**AI / automation:**
- `ai_system_prompt` (from `automations.aiPersona`)
- `faq_json` (from FAQ entries)

**Linked rows:**
- One `admin_users` row (operator becomes MAIN_ADMIN)
- One `policies` row (from policy inputs)
- One `subscriptions` row (from plan selection)
- N `tours` + 30-day `slots` pre-generated
- One `landing_page_orders` row (stores the full raw payload in `metadata` JSONB for audit/rollback)

---

## 2. Onboarding gaps — collected but not persisted to businesses

These are captured in the wizard but currently only end up in `landing_page_orders.metadata` (JSONB blob), not in queryable columns on `businesses` or `admin_users`. The admin UI cannot surface these without reading the blob.

| Onboarding field | Suggested destination |
|---|---|
| `business.legalName` | `businesses.legal_name` (new column) — needed for invoice generation + PAIA compliance |
| `business.industry` | `businesses.industry` (new column) — nice for super-admin filtering |
| `business.yearEstablished` | `businesses.year_established` (new column) — displayed in footer copy |
| `business.ownerPhone` | `admin_users.phone` (new column) — needed for operator WhatsApp contact |
| `business.bookingDomain` | Currently redundant with `subdomain`; can be dropped |
| `operations.city` | `businesses.city` (new column) or append to existing `location_phrase` |
| `operations.arriveEarlyMinutes` | `businesses.arrive_early_minutes` (new column) — currently baked into `directions` text |
| `operations.googleMapsUrl` | `businesses.google_maps_url` (new column) — currently baked into `directions` text |
| `operations.facilities`, `parkingInfo`, `safetyInfo`, `officeHours` | Own columns OR a single `operations_details` JSONB — currently baked into `directions`/`terms_conditions` (hard to edit later) |
| `operations.reviewUrl` | Should feed `social_google_reviews` or a `review_platforms` JSONB |
| `operations.whatsappPhone` | `businesses.whatsapp_phone` (new column) — currently lost |
| All `sops.*` | A `sops` JSONB column — currently only in `knowledge_base` text |
| `automations.reminderEnabled`, `reviewRequestEnabled`, `reengagementEnabled` | These should toggle rows in `marketing_automations` or live in `automation_config` JSONB — currently unused |

---

## 3. Information NOT collected at onboarding that is required for production use

These are gaps in the **form itself** (not in the persistence layer). A South African SaaS billing real operators should ask for these:

### Required for compliance / invoicing
- **Legal business name** (vs trading name) — needed on invoices
- **VAT / tax number** — required if the operator is VAT-registered
- **Business registration number** (CK / Pty number)
- **Physical business address** — invoice recipient address
- **Billing contact** (may differ from operator_email — e.g. accounts@)

### Required for payouts (not stored in `businesses` today)
- **Bank account holder name**
- **Bank name + branch code**
- **Account number**
- **Yoco requires these for merchant onboarding** — the onboarding form currently only collects `yocoSecretKey`, which means the operator has already set up Yoco elsewhere. If we want to onboard people without them having pre-existing Yoco accounts, we need bank details.

### Required for deliverability
- **SPF / DKIM for the operator's custom domain** (if they're using one) — relevant only if they want emails sent from `info@theirdomain.co.za` instead of `info@bookingtours.co.za`

### Required for marketing
- **Physical address for email footers** — CAN-SPAM / POPIA compliance requires a physical address in every marketing email
- **Unsubscribe-from contact email**

### Nice to have (not blockers)
- Business logo (currently collected, good)
- Business colour palette (currently collected, good)
- Social media handles (now editable via super-admin)
- Operating hours by day of week (currently only a free-text `officeHours`)
- Seasonal closures (no column today)

---

## 4. Recommendations

Ordered by ease-of-fix vs value:

### Quick wins (1 hour)
1. **Add `social_*` inputs to the onboarding form** — the columns exist, the super-admin can now edit them; just needs form fields. Currently operators don't know to add these until after onboarding.
2. **Add `marketing_test_email` field to the onboarding form** — default to the owner's email so test campaigns work on day 1.
3. **Collect `business.whatsappPhone` in onboarding** and persist it (needs a new column `businesses.whatsapp_phone`).

### Medium effort (half day)
4. **Add a "Business Legal Details" step** to the wizard collecting: legal name, VAT number, registration number, physical address, billing contact.
   - New columns needed: `legal_name`, `vat_number`, `registration_number`, `street_address`, `city`, `postal_code`, `billing_contact_email` (or one `billing_details` JSONB).
5. **Add a "Bank / Payout Details" step** (optional — skippable for now if the operator already has Yoco set up). Stored encrypted the same way `yoco_secret_key_encrypted` is.
6. **Add a "Trial vs Paid" flag on subscriptions** — right now subscriptions are created as `ACTIVE` immediately. Consider `TRIAL` as the default state until first payment clears.

### Larger effort (1 day)
7. **Refactor `directions`, `terms_conditions`, `privacy_policy` from composed text to structured JSONB** — operators can then edit individual pieces (parking, safety, etc.) in the Settings page without editing a long text block.
8. **Split operations SOPs** (`sops.weatherCancellation`, etc.) into individual columns or a `sops` JSONB — today they're buried in the knowledge_base string and not edit-surfaced.

---

## 5. Sanity checks after this pass

Verified via MCP:

```sql
SELECT business_name, manage_bookings_url, booking_success_url, waiver_url
FROM public.businesses ORDER BY business_name;
```

- **Atlantic Skydive Co.** — all 6 URLs now populated.
- **MarineTours (Cape Kayak)** — unchanged, already had all URLs set.

The super-admin's **View / Edit Details** panel now has 11 fieldsets (was 7). New ones:
- Booking Site URLs (6 inputs + Regenerate button)
- Social Links (8 inputs)
- Terminology & Messaging (3 inputs)
- Hero / Marketing / Weather (3 inputs)

---

## 6. Files changed in this session (post-isolation-test)

```
M ActvityHub/Onboarding/app/api/onboarding/route.ts   ← URL derivation
M capekayak/app/super-admin/page.tsx                  ← saveSubdomain cascade + regenerate + saveBizDetail new fields + 4 new UI fieldsets
```

Plus DB migrations applied:
- `cleanup_isolation_test_data` (removed the 10 test tenants)
- `backfill_derived_urls_for_existing_tenants` (filled NULL URLs on Atlantic)

---

## 7. Deploy checklist

1. `git diff app/super-admin/page.tsx` to review the super-admin changes.
2. `git diff ~/Desktop/ActvityHub/Onboarding/app/api/onboarding/route.ts` to review the onboarding change (note: this is the Onboarding repo, not the admin repo).
3. Commit + push each repo.
4. Vercel will auto-deploy both (`caepweb-admin` and `bookingtours-onboarding`).
5. Smoke test: after deploy, open super-admin → pick a tenant → "View / Edit Details" → confirm the 4 new fieldsets render. Hit "Regenerate from subdomain" and confirm the 6 URL fields update in the UI.

Any operator who had a broken customer email link pointing at a null URL is now fixed retroactively via the backfill migration.
