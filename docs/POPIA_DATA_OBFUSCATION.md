# POPIA Data-Subject Obfuscation

How BookingTours handles a data subject's request to erase/anonymize their
personal information under POPIA (South Africa's privacy law), and exactly
which fields are obfuscated vs retained.

## Why we anonymize rather than hard-delete

POPIA's right to erasure is balanced against other laws that *require* retention
— notably SARS's 5-year retention of financial/tax records. So a "delete"
request is fulfilled by **anonymization**: every field that identifies the
person is removed, while the non-identifying financial shell of each record
(amounts, invoice numbers, dates, counts) is preserved for legal retention. The
records still exist for the books; they just no longer point to a real person.

## The flow

1. **Customer submits a request** — booking site footer → "Privacy Request"
   (`booking/app/popia/page.tsx`): Access, Correction, or Deletion, by email.
2. **Double opt-in** — a confirmation email (`POPIA_CONFIRM_REQUEST`) with a
   one-time link; the request only becomes `CONFIRMED` after the subject clicks
   it (prevents someone erasing another person's data). A 30-day cooling-off
   window (`scheduled_for`) then applies before it becomes actionable.
3. **Admin actions it** — Admin dashboard → Privacy → Data Requests
   (`app/privacy/data-requests/page.tsx`): **Export** (Access requests) or
   **Fulfill** (Deletion → anonymize) or **Reject** (with reason).
4. **Anonymization runs** — the fulfill route resolves the subject's
   `customer_id` from their email (customer-submitted requests don't carry it),
   then calls the `anonymize_customer` RPC, which scrubs every table below and
   records the outcome in `pii_anonymization_log` + `audit_logs`.
   An admin can also action a request received out-of-band (e.g. by phone/email)
   the same way.

Requests, statuses, and the anonymization audit trail live in
`data_subject_requests` and `pii_anonymization_log`.

## What gets OBFUSCATED vs RETAINED

The anonymizer matches the subject by `customer_id`, original **email**, and
original **phone** (compared on the last 9 significant digits, so `0xx`, `27xx`,
and `+27` formats of the same number all match). It also sweeps *orphan* rows
that match by email/phone but were never linked to a `customers` row.

| Table | Obfuscated (removed / replaced) | Retained (legal/financial) |
|---|---|---|
| `customers` | name → "Deleted Customer", email → `deleted-<hash>@anonymized.local`, phone, date_of_birth, notes; `marketing_consent`→false; `deleted_at` set | id (FK integrity), `total_bookings`, `total_spent`, first/last booking dates |
| `bookings` | customer_name, email, phone, customer_company_name, customer_vat_number, `custom_fields`→`{}`, `waiver_payload`→`{"anonymized":true}`, waiver_signed_name | ref, status, qty, `total_amount`, discount fields, slot linkage, dates |
| `invoices` | customer_name, customer_email, customer_phone, customer_company_name, customer_vat_number | invoice_number, subtotal, discount_amount, total_amount, payment_method/reference, dates |
| `vouchers` | buyer_name, buyer_email, buyer_phone, recipient_name, recipient_email, gift_message | code, type, value, purchase_amount, current_balance, tour_name, expiry |
| `conversations` | phone → token, customer_name → "Deleted Customer", email, `state_data`→`{}` | status, current_state/intent, priority |
| `chat_messages` | phone → token, body → "[redacted]", sender → "Deleted Customer" | direction, intent, auto_replied, timestamps |
| `wa_messages` | to_phone → token, body → "[redacted]" | kind, template_name, status, provider_message_id, timestamps |
| `marketing_contacts` | **hard-deleted** (no legal basis to retain marketing data) | — |
| `refunds`, `holds` | no direct PII columns — reached only via booking_id, which is anonymized above | amounts, status, timestamps |

The same anonymization token (`deleted-<16 hex>`) is written across a person's
records so an operator can still see that "these anonymized rows belonged to one
(now erased) person" without knowing who — useful for support and audit without
re-identifying anyone.

## Verification

The `anonymize_customer` RPC returns a per-table count of rows affected, and
writes those counts to `pii_anonymization_log.affected_tables` and an
`audit_logs` row (`action_type = 'POPIA_ANONYMIZE'`). This was validated
end-to-end against the live schema with a synthetic subject whose phone appeared
in three different formats across tables — all were matched and scrubbed, and
the financial columns were left intact.

## Access requests (data export)

Access requests produce a JSON export of the subject's `customers`, `bookings`,
and `marketing_contacts` data, uploaded to the `popia-exports` storage bucket
with a 7-day signed URL, emailed via `POPIA_EXPORT_READY`.
