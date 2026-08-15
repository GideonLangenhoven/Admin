# Client onboarding runbook

How a new operator gets from "signed up" to "taking bookings", using the
onboarding wizard at `onboarding.bookingtours.co.za`.

The client fills the wizard in themselves, on their own machine, while you walk
them through it on a call. It takes about 30 minutes. The wizard holds no
secrets and cannot reach any tenant other than the one their invite points at.

---

## Before the call

1. Open **Super Admin → Onboarding Invites**.
2. Generate an invite with the client's name, their email, and the subdomain
   they will trade under (`seakayak` becomes `seakayak.booking.bookingtours.co.za`).
   The subdomain is fixed at this point, so confirm it with them first.
3. Copy the invite link and email it to them. Default expiry is 48 hours.

Generating the invite immediately creates their tenant in a fenced
`ONBOARDING` state. It cannot take payments or be invoiced until the wizard
finishes, so there is no risk in creating it early.

If the link expires mid-call, use **Reissue** on that row. It mints a fresh
token against the same half-filled tenant, so nothing they have already entered
is lost. **Revoke** is for abandoned onboardings: it deletes the token and, if
the tenant never went live, the skeleton business too, which frees the
subdomain for reuse.

---

## On the call

Have them open the link and share their screen. Each screen asks one question.
Everything saves as they go, so if the call drops they reopen the same link and
carry on from where they stopped.

Order of the wizard:

| Section | What they enter | Notes |
|---|---|---|
| Identity | Business name, tagline, address, timezone, currency | Address lookup prefills from Google, which also wires up their review link |
| Branding | Logo, two or three colours, hero text | The rest of the theme is derived. Colours can be suggested from their existing website |
| Operations | Meeting point, directions, what to bring and wear | This copy feeds the booking site, emails and the WhatsApp bot |
| Refunds | Cancellation tiers and policy text | Tiers drive real refund amounts, so read them back to the client |
| Tours | Each tour with price, duration, capacity, and its schedule | Schedules generate the actual bookable slots. Several date ranges per tour are fine |
| FAQs and AI persona | Common questions, tone of voice | Feeds the customer-facing assistant |
| WhatsApp | Their WhatsApp business number | Display only. You do the Meta side separately, see below |
| Yoco | Their Yoco secret key | The key is validated live and payment notifications are connected automatically |
| Go live | Confirmation summary | Creates their subscription, seeds defaults, emails their password setup link |

### If the Yoco step says payment notifications are pending

That is expected behaviour, not a failure. The key is saved and validated; only
the webhook registration did not go through. The client can carry on. Afterwards
the tenant shows **Yoco webhook needs manual registration** in Super Admin →
Business Management. Register the webhook against
`https://<project>.supabase.co/functions/v1/yoco-webhook` and save the signing
secret on the tenant's credentials. Do this before they take real money, since
until then payments will not confirm bookings automatically.

### WhatsApp

The client cannot create their own Meta app, so the wizard only records their
number and shows pending. You connect the number on the Meta side and save the
credentials from the admin app afterwards. Their number starts routing as soon
as the credentials are stored.

---

## Finishing: the test booking

The last screen is the point of the whole call. It links to their live booking
site and asks them to make a real booking, paying with a real card.

Watch for it to appear on their screen as confirmed. That single booking proves
the tour, the slot, the payment key, the webhook, the confirmation email and the
booking site are all working together. Refund it afterwards from the admin app.

If the booking does not appear within a minute, check in this order: the tour
has slots on the date they picked, the Yoco webhook is registered (see above),
and the payment actually completed on Yoco's side.

---

## After the call

- The client receives a **welcome email with a link to set their password**. It
  is valid for 48 hours. If they miss it, resend from Super Admin → Business
  Management → their business → admin users.
- Confirm `yoco_webhook_status` reads REGISTERED.
- Follow up on the WhatsApp connection once Meta is done.
- Refund the test booking.

---

## What go-live creates behind the scenes

Pressing go-live is idempotent, so pressing it twice is harmless. It:

- creates the `subscriptions` row on the standard plan, which is what makes the
  tenant invoiceable at month end
- seeds the `policies` row of loyalty and group-discount defaults, which the
  WhatsApp bot requires
- creates the MAIN_ADMIN user and sends the password setup email
- writes the WhatsApp routing hint, if credentials exist
- flips the tenant from `ONBOARDING` to `ACTIVE`, which is what allows it to
  trade

The status flip is last, so if anything above fails the tenant stays fenced
rather than half-open.

---

## First-time deployment checklist

This is on top of the normal deploy runbook, and only needs doing once.

1. Apply `supabase/migrations/20260815140000_onboarding_wizard.sql`, then
   regenerate `supabase/security-baseline.json` from the live database and
   confirm `npm run check-security-drift` exits 0.
2. Deploy the edge functions `onboarding-wizard` and `generate-invite-token`.
3. Set the edge function env vars:
   - **`ONBOARDING_APP_URL`** (e.g. `https://onboarding.bookingtours.co.za`).
     Required. Without it the invite panel cannot build a link at all: it falls
     back to copying the bare token and warns you the variable is missing. Set
     this before generating the first invite.
   - `ADMIN_DOMAIN` is optional, defaulting to `admin.bookingtours.co.za`. The
     password setup link is built per tenant as
     `https://{subdomain}.{ADMIN_DOMAIN}`, because each operator has their own
     console and a shared host would land them on somebody else's. Set
     `ADMIN_APP_URL` only if you need to override that with one fixed origin.
   - `GOOGLE_PLACES_API_KEY` if not already set. Without it the address lookup
     returns a "not configured" message and the client types their details in
     by hand; nothing else breaks.
   - `BOOKING_DOMAIN` is optional, defaulting to `booking.bookingtours.co.za`.
4. On the `bookingtours-onboarding` Vercel project: unpause it, set
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and **remove
   the v1 secrets that are still configured there** (`SUPABASE_SERVICE_ROLE_KEY`,
   `SETTINGS_ENCRYPTION_KEY`, `RESEND_API_KEY`, `ONBOARDING_INVITE_CODE`). The
   rebuilt app reads none of them, and a service-role key on a public frontend
   project is worth removing on its own merits.
5. Smoke test against a throwaway invite:
   `SUPABASE_URL=... SUPABASE_ANON_KEY=... INVITE_TOKEN=... node scripts/smoke-onboarding-wizard.mjs`
   It walks every step, checks the write whitelist and the SSRF guard, and
   leaves the token unused unless you pass `RUN_COMPLETE=1`.

Note for anyone building the wizard app locally: that repo lives on the Desktop
and its `node_modules` reads are extremely slow there, so `next build` can sit
for many minutes at near-zero CPU without failing. It is an I/O problem, not a
code problem. Vercel builds it fine on its own infrastructure.
