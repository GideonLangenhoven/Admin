# Production Runbook

## 1. Database

- Apply all pending Supabase migrations.
- Confirm `businesses` contains tenant config columns:
  - branding, timezone, currency
  - booking/manage/voucher URLs
  - waiver URL
  - AI prompt, FAQ JSON, terminology JSON
  - encrypted credential columns
- Confirm RPCs exist:
  - `set_app_settings_encryption_key`
  - `set_business_credentials`
  - `get_business_credentials`
  - shared capacity / external booking RPCs used by current flows

## 2. Secrets

Set these in Supabase Edge Function secrets before deploy:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SETTINGS_ENCRYPTION_KEY`
- `RESEND_API_KEY`
- `GEMINI_API_KEY`
- `WA_VERIFY_TOKEN`

Optional platform-wide defaults:

- `BOOKING_SUCCESS_URL`
- `BOOKING_CANCEL_URL`
- `VOUCHER_SUCCESS_URL`
- `ADMIN_APP_ORIGINS`

Recommended rule:
- Prefer tenant-specific URLs stored on `businesses`.
- Only use the env URL values as emergency fallback defaults.

## 3. Tenant Onboarding

For each new tenant, confirm the super admin sets:

- business name
- timezone
- currency
- booking site URL
- manage bookings URL
- gift voucher URL
- booking success URL
- booking cancel URL
- voucher success URL
- waiver URL
- WhatsApp token + phone ID
- Yoco secret key
- Yoco webhook signing secret
- AI prompt / FAQ / terminology

## 4. Edge Functions To Deploy

Deploy at minimum:

- `create-checkout`
- `wa-webhook`
- `web-chat`
- `yoco-webhook`
- `send-email`
- `send-invoice`
- `send-whatsapp-text`
- `auto-messages`
- `cron-tasks`
- `manual-mark-paid`
- `process-refund`
- `admin-reply`
- `external-booking`
- `super-admin-onboard`
- `waiver-form`

## 5. RLS Verification

Manually verify in Supabase:

- tenant admins can only read/write their own `business_id`
- cross-tenant access fails for `bookings`, `slots`, `tours`, `invoices`, `refunds`, `vouchers`, `conversations`, `chat_messages`
- service-role edge functions still work after RLS is enabled

## 6. Smoke Tests

Run these in a staging tenant first:

1. Super admin creates a new tenant from `/super-admin`.
2. New admin receives setup link and logs in.
3. Admin updates booking URLs and branding in `/settings`.
4. Admin creates a booking from `/new-booking`.
5. Public/chat booking creates a Yoco payment link.
6. Complete Yoco payment and confirm:
   - booking marked paid
   - invoice created
   - confirmation email sent
   - WhatsApp confirmation sent
7. Confirm waiver link is included when waiver is pending.
8. Trigger day-before reminder and confirm the second reminder email is sent only if waiver is still pending.
9. Test refund processing.
10. Test two tours sharing one resource and verify capacity is deducted correctly.
11. Test WhatsApp webhook against the correct tenant phone number.
12. Test external booking webhook auth with API key and HMAC.

## 7. Post-Deploy Monitoring

Watch these logs closely after release:

- checkout creation failures
- credential decryption failures
- webhook tenant resolution failures
- webhook signature verification failures
- email send failures
- WhatsApp send failures
- waiver reminder send failures

## 8. Rollback Priority

If production fails, rollback in this order:

1. edge functions
2. app deployment
3. then database migrations only if strictly necessary

Do not rotate `SETTINGS_ENCRYPTION_KEY` unless you have a re-encryption plan for stored credentials.
