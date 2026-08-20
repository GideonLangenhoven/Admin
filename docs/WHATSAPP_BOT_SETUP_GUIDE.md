# WhatsApp Booking Bot Setup & Onboarding Guide

This guide documents how the multi-tenant WhatsApp Booking Bot works and details the exact steps required to set up and configure the same automated flow for any new tour operator.

---

## 1. How the Multi-Tenant Architecture Works

Instead of running separate webhooks for each operator, the platform uses a **single, shared Webhook endpoint** powered by a Supabase Edge Function:

```
                  ┌───────────────────────────────┐
                  │      Meta WhatsApp API        │
                  └───────────────┬───────────────┘
                                  │ (Sends webhook payload)
                                  ▼
         ┌──────────────────────────────────────────────────┐
         │  https://<project-ref>.supabase.co/.../wa-webhook│
         └────────────────────────┬─────────────────────────┘
                                  │ (Extracts phone_number_id)
                                  ▼
                    ┌──────────────────────────┐
                    │  resolveTenantByPayload  │
                    └─────────────┬────────────┘
                                  │ (Matches wa_phone_id_lookup)
                                  ▼
                   ┌────────────────────────────┐
                   │  Loads Operator Context    │
                   │  - Decrypts wa_token       │
                   │  - Loads FAQ & Tour Data   │
                   └──────────────┬─────────────┘
                                  │ (Invokes AI with prompt)
                                  ▼
                  ┌───────────────────────────────┐
                  │      Customer Response        │
                  └───────────────────────────────┘
```

When a customer messages an operator's WhatsApp number:
1. Meta triggers a POST request containing the incoming payload.
2. The `wa-webhook` function reads `metadata.phone_number_id` (the Meta ID of the receiving phone).
3. The function queries the `businesses` table to find the record where `wa_phone_id_lookup` matches the incoming ID.
4. The function calls the Supabase RPC `get_business_credentials` using the server-side `SETTINGS_ENCRYPTION_KEY` to decrypt the operator's specific `wa_token`.
5. The AI assistant loads the operator's specific system prompt (`ai_system_prompt`), tours, pricing, and FAQ knowledge, formulating the reply and sending it back via the operator's Meta credentials.

---

## 2. Step-by-Step Setup Runbook

Adding an operator is three jobs: connect their number on the Meta side, store
their credentials on the tenant, then prove it on a real phone.

> [!IMPORTANT]
> **There is one Meta app for the whole platform** — CapeKayakBookings, App ID
> `1643815853336960`, under the CapeWeb business. Do **not** create a second app
> per operator. `wa-webhook` verifies every inbound signature against a single
> `WA_APP_SECRET` (`supabase/functions/wa-webhook/index.ts:31`) and answers the
> verification handshake with a single `WA_VERIFY_TOKEN` (line 28), so a number
> living under a different app would have its webhooks rejected with a 401.
> Per-operator separation is the *token*, not the app.

### Step A: Add the operator's number to the shared app

The operator needs their own WhatsApp Business Account (WABA) and phone number,
shared into the CapeKayakBookings app:

1. **Get access to their WABA.** Either they add CapeWeb as a partner in their
   Meta Business Manager (Business settings → Partners → share the WABA with
   business ID `2304217393358934`), or you create the WABA on their behalf. The
   number must not already be registered to a personal WhatsApp or WhatsApp
   Business app account — it has to be freed up first.
2. **Register the phone number** under WhatsApp → API Setup and complete the SMS
   or voice verification. Note the **Phone Number ID** (digits, e.g.
   `105948375920384`). This is *not* the phone number itself.
3. **Generate a System User access token** in Business Manager → System Users,
   with **`whatsapp_business_messaging`** and **`whatsapp_business_management`**,
   scoped to that operator's WABA. This is the permanent `wa_token`.
4. **Subscribe the app to their WABA** so their inbound messages actually reach
   the webhook — WhatsApp → Configuration, or
   `POST /{waba-id}/subscribed_apps`. Skipping this is the most common cause of
   "I sent a message and nothing happened": the number works, the token works,
   and Meta simply never calls us.

> [!IMPORTANT]
> Do NOT use the temporary 24-hour token from the API Setup tab. It expires
> overnight and every send starts failing with an opaque error the next morning.

**Access level matters.** Acting on a WABA the app does not own requires
**Advanced Access** on both permissions. Check App Review → Permissions and
Features before onboarding, not after — Standard Access will pass every step
here and then fail on the first real send.

---

### Step B: Point the app at the webhook (once for the platform)

This is app-level configuration. It is already done, and is only repeated if the
callback URL or app secret changes — **not** per operator.

1. Meta Developer Portal → **WhatsApp → Configuration**, Edit under Webhooks:
   * **Callback URL**: `https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/wa-webhook`
   * **Verify Token**: the value of the `WA_VERIFY_TOKEN` Supabase secret.
2. **Verify and Save.** `wa-webhook` answers the `hub.challenge` handshake at
   `index.ts:3380`; a mismatched token returns 403 and Meta refuses to save.
3. Under **Webhook Fields** → Manage, subscribe to **`messages`**. That single
   field carries both inbound customer messages and the `statuses` delivery
   callbacks the 24-hour-window reopener depends on.

> [!WARNING]
> If the app secret is ever reset, every tenant's WhatsApp goes silent at once —
> `wa-webhook` fails closed and returns 401 on every payload
> (`index.ts:55`). Update the `WA_APP_SECRET` Supabase secret in the same sitting.

---

### Step C: Store the credentials on the tenant

**For an existing tenant — the normal case.** Admin app → **Settings →
Credentials → WhatsApp**, paste the Access Token and Phone Number ID, save.
That posts to `app/api/credentials/route.ts` with `section: "wa"`, which is
MAIN_ADMIN/SUPER_ADMIN gated and **validates the pair against Meta Graph before
storing anything** (`GET /v19.0/{phone_id}?fields=display_phone_number`). A
token Meta rejects is refused with Meta's own error text and nothing is saved,
so a wrong paste cannot sit there reading "✓ Configured" while every send fails.
It then calls the narrow `set_wa_credentials` RPC.

**For a brand-new tenant**, create the tenant first — see
[CLIENT_ONBOARDING_RUNBOOK.md](./CLIENT_ONBOARDING_RUNBOOK.md). The wizard's
WhatsApp step is **display-only**: `whatsapp` is absent from `STEP_COLUMNS`
(`supabase/functions/_shared/onboarding-guards.ts:11`) and `save-credentials`
handles Yoco only, so the client cannot enter their own Meta details. You store
them afterwards via Settings → Credentials as above.

`super-admin-onboard` can also take `wa_token`/`wa_phone_id`, but only at
creation time and only through the broad `set_business_credentials` RPC.

> [!CAUTION]
> Never call `set_business_credentials` on an existing tenant to change only
> WhatsApp. It writes all four credential columns in one UPDATE, so the omitted
> Yoco secret key and webhook secret are encrypted from NULL and that tenant
> stops taking payments. Use `set_wa_credentials(p_business_id, p_key,
> p_wa_token, p_wa_phone_id)` — which is what the admin app already does.

**On `wa_phone_id_lookup`:** neither RPC writes it, and you do not need to set it
by hand. It is a routing cache. The first inbound message from an unknown phone
id falls through to a paged scan that decrypts every tenant, finds the match,
and backfills the column for the whole platform as it goes
(`_shared/tenant.ts:247-266`). One slow message, then the indexed fast path
forever. The wizard's go-live step also writes it directly when credentials
already exist (`onboarding-wizard/index.ts:580`).

---

### Step D: Set Up the AI Assistant & Knowledge Base
The bot requires operator-specific guidelines to answer inquiries:

1. **Add Tours & Pricing**:
   * Navigate to the operator's settings and add their tours, prices, durations, and capacities.
   * A tour with no future slots is hidden from the bot's booking flows, so seed
     slots before testing or the bot will correctly say there is nothing to book.
2. **Configure FAQ Knowledge**:
   * In the operator's **Settings > Chat FAQ**, add common questions and answers (e.g. cancellation policy, clothing recommendations, parking availability).
   * `kb-sync` builds the tenant's pgvector knowledge base from `faq_json`,
     `chat_faq_entries` and active `tours`. The cron runs hourly at **:23**, so
     new answers are not retrievable immediately. To not wait:
     `POST /functions/v1/kb-sync {"business_id": "<uuid>"}` with the service key.
3. **Check the tenant has its `policies` row.** The bot reads it for loyalty and
   group discounts (`wa-webhook/index.ts:453`). A missing row does not crash the
   bot — the result is guarded and simply yields no discount — but the operator
   will report that their loyalty discount never applies. The wizard's go-live
   step seeds it; `super-admin-onboard` does not, so tenants created that way
   need it backfilled:
   `insert into policies (business_id) values ('<uuid>') on conflict do nothing;`
4. **Turn Bot Mode ON**:
   * Go to **Settings > WhatsApp Bot**.
   * Toggle Bot Mode to **ALWAYS_ON** (responds 24/7) or **OUTSIDE_HOURS** (responds only outside business hours, forwarding active chats to the Inbox during work hours).
   * `OUTSIDE_HOURS` means the bot is **silent during the operator's working
     day** by design. Test at 10am on an `OUTSIDE_HOURS` tenant and it will look
     broken. Use `ALWAYS_ON` to test, or test after hours.

---

### Step E: Prove it on a real phone

Nothing above proves the loop. Send a real WhatsApp to the operator's number
from a phone that is not an admin, then check in this order — each query
isolates one link in the chain.

1. **Did Meta call us at all?** Supabase → Edge Functions → `wa-webhook` logs. No
   entry means the problem is on the Meta side: the app is not subscribed to
   that WABA (Step A.4), or the `messages` field is not subscribed (Step B.3).
2. **Was the signature accepted?** A log line reading
   `WA webhook rejected — invalid or missing signature` means `WA_APP_SECRET`
   does not match the app's current secret. Nothing reaches the bot until that
   is fixed.
3. **Did it route to the right tenant?** `No business matched WhatsApp
   phone_number_id <id>` means the stored `wa_phone_id` is not the id Meta is
   sending. Re-copy the Phone Number ID — people paste the phone *number* here.
4. **Did the message land, and did we reply?**

   ```sql
   select created_at, direction, bot_skipped_reason, left(body, 60)
   from chat_messages
   where business_id = '<uuid>'
   order by created_at desc limit 10;
   ```

   An `IN` row with **no following `OUT` row** is the diagnostic that matters:
   * `bot_skipped_reason` set (`mode_off`, etc.) — the mode gate stopped it.
     Check Step D.4.
   * `bot_skipped_reason` **NULL** — the mode gate *passed* and something after
     it returned silently. In practice that is the per-conversation HUMAN hold:

     ```sql
     select id, status, current_state from conversations
     where business_id = '<uuid>' and phone = '<test phone>';
     ```

     `status = 'HUMAN'` means an admin replied in the Inbox once and pinned the
     thread. Clear it with the Inbox's **Return to bot** button, or have the
     customer send `menu`.

Once a reply comes back, the whole chain is proven: subscription, signature,
routing, decryption, bot, and outbound send on the operator's own token.

---

## 3. Webhook Payload Resolution Reference

For troubleshooting or extending the resolver, here is the database layout:

There is no separate credentials table. Everything lives as columns on
`businesses`, encrypted in place with pgcrypto under `SETTINGS_ENCRYPTION_KEY`.

### `businesses`
* `id` (uuid) — unique business identifier.
* `wa_phone_id_lookup` (text) — indexed plaintext phone number ID, the fast-path
  route match. Written lazily by the resolver, never by the credential RPCs.
* `wa_phone_id_encrypted` (bytea) — Meta phone number ID, the source of truth.
* `wa_token_encrypted` (bytea) — Meta system-user access token.
* `whatsapp_bot_mode` (enum) — `OFF` / `ALWAYS_ON` / `OUTSIDE_HOURS`.
* `business_hours` (jsonb) — per-day open/close, read by the `OUTSIDE_HOURS` gate.

### `conversations`
* `status` — `BOT` or `HUMAN`. The second, invisible switch: `HUMAN` silences the
  bot for that one thread regardless of `whatsapp_bot_mode`.

```sql
-- Read back what is actually stored (decrypts):
SELECT * FROM get_business_credentials('operator-uuid', 'SETTINGS_ENCRYPTION_KEY');

-- Write WhatsApp credentials WITHOUT touching Yoco. Prefer the admin app's
-- Settings → Credentials screen, which also validates against Meta first.
SELECT set_wa_credentials(
  p_business_id := 'operator-uuid',
  p_key         := 'SETTINGS_ENCRYPTION_KEY',
  p_wa_token    := 'EAAg...',
  p_wa_phone_id := '105948...'
);
```
