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

Follow these four steps to onboard a new operator to the WhatsApp Bot.

### Step A: Configure the Meta Developer Portal
To connect the operator's phone number to Meta's Cloud API:

1. **Create a Meta Developer App**:
   * Go to the [Meta Developer Portal](https://developers.facebook.com/).
   * Create a new app (select **Business** or **Other** type).
2. **Add the WhatsApp Product**:
   * Under App Setup, click **Set Up** next to the **WhatsApp** product.
   * Link it to the operator's Meta Business Manager.
3. **Register/Verify Phone Number**:
   * Under WhatsApp > **API Setup**, add the operator's phone number.
   * Note the **Phone Number ID** (a long string of digits, e.g., `105948375920384`).
4. **Generate a System User Access Token**:
   * In your Meta Business Manager under **System Users**, create a system user.
   * Generate an access token with the **`whatsapp_business_messaging`** and **`whatsapp_business_management`** permissions.
   * Save this token as it will act as the permanent `wa_token`.

> [!IMPORTANT]
> Do NOT use the temporary 24-hour access token generated in the API Setup tab. You must create a System User in Business Manager to get a permanent token.

---

### Step B: Configure the Webhook in Meta
Point Meta's incoming notifications to the platform's Supabase Edge Function:

1. In the Meta Developer Portal, go to **WhatsApp > Configuration**.
2. Click **Edit** under Webhooks:
   * **Callback URL**: `https://<supabase-project-ref>.supabase.co/functions/v1/wa-webhook`
   * **Verify Token**: Enter the value of `WA_VERIFY_TOKEN` (located in your Supabase environment secrets).
3. Click **Verify and Save**.
4. Under **Webhook Fields**, click **Manage** and subscribe to **`messages`** (this is critical to receive inbound chat messages).

---

### Step C: Register the Operator in the Super-Admin Dashboard
Once you have the Meta credentials, onboard the operator via the **Super Admin Onboarding Panel**:

1. Log in to the [Super Admin Dashboard](https://caepweb-admin.vercel.app/super-admin).
2. Fill in the operator's registration details:
   * **Business Name**, **Subdomain**, **Timezone**, and **Currency**.
3. Under **Credentials**, enter the values gathered in Step A:
   * **WhatsApp Access Token (`wa_token`)**
   * **WhatsApp Phone ID (`wa_phone_id`)**
4. Click **Create Operator**.

The onboarding script invokes the `super-admin-onboard` edge function, which:
* Creates the operator's database records.
* Calls the `set_business_credentials` Supabase RPC to securely encrypt the `wa_token` and `wa_phone_id` using AES-256 (via the server's `SETTINGS_ENCRYPTION_KEY`).
* Backfills the fast-path search index column `wa_phone_id_lookup`.

---

### Step D: Set Up the AI Assistant & Knowledge Base
The bot requires operator-specific guidelines to answer inquiries:

1. **Add Tours & Pricing**:
   * Navigate to the operator's settings and add their tours, prices, durations, and capacities.
2. **Configure FAQ Knowledge**:
   * In the operator's **Settings > Chat FAQ**, add common questions and answers (e.g. cancellation policy, clothing recommendations, parking availability).
3. **Turn Bot Mode ON**:
   * Go to **Settings > WhatsApp Bot**.
   * Toggle Bot Mode to **ALWAYS_ON** (responds 24/7) or **OUTSIDE_HOURS** (responds only outside business hours, forwarding active chats to the Inbox during work hours).

---

## 3. Webhook Payload Resolution Reference

For troubleshooting or extending the resolver, here is the database layout:

### `businesses` table
* `id` (uuid) — unique business identifier.
* `wa_phone_id_lookup` (text) — indexed, plaintext phone number ID used for instant route matching.

### `credentials` table (accessible via RPC only)
* `wa_token` (encrypted) — Meta access token.
* `wa_phone_id` (encrypted) — Meta phone number ID.

```sql
-- The secure encryption RPC used to write credentials:
SELECT set_business_credentials(
  p_business_id := 'operator-uuid',
  p_key := 'YOUR_SETTINGS_ENCRYPTION_KEY',
  p_wa_token := 'EAAg...',
  p_wa_phone_id := '105948...'
);
```
