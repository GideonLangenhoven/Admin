-- AN3 P1: restrict the column surface anon can read from public.businesses.
-- Pre-fix: anon had table-wide SELECT, which included encrypted credential
-- ciphertexts, operator_email, internal billing/marketing counters, and
-- WhatsApp bot operational state. RLS already restricts which row anon can
-- see (one tenant per request via x-tenant-business-id header), but column
-- exposure is independent of RLS and needed its own fence.
--
-- ThemeProvider on the booking site was updated to enumerate the safe
-- columns (capekayak-booking 9d007b5), so PostgREST no longer expands `*`
-- into the restricted columns. Other booking-site reads of public.businesses
-- already used explicit single-column selects.

revoke select on public.businesses from anon;

do $$
declare
  cols text;
  sensitive_cols text[] := array[
    -- PII / contact
    'operator_email','notification_email','marketing_test_email',
    -- Encrypted credentials (ciphertext leaks enable offline brute force
    -- if the SETTINGS_ENCRYPTION_KEY is ever compromised)
    'wa_token_encrypted','wa_phone_id_encrypted',
    'yoco_secret_key_encrypted','yoco_webhook_secret_encrypted',
    'yoco_test_secret_key_encrypted','yoco_test_webhook_secret_encrypted',
    'paysafe_api_key_encrypted','paysafe_api_secret_encrypted',
    'google_drive_refresh_token_encrypted',
    'bank_account_owner_encrypted','bank_account_number_encrypted','bank_account_type_encrypted',
    'bank_name_encrypted','bank_branch_code_encrypted',
    -- Account / integration identifiers
    'paysafe_account_id','paysafe_linked_account_id',
    'google_drive_folder_id','google_drive_email',
    'gdrive_photos_folder_id','gdrive_photos_folder_url',
    -- Billing / quota internals
    'max_admin_seats',
    'marketing_email_usage','marketing_included_emails','marketing_overage_rate_zar',
    -- Automation engine internals
    'automation_config',
    -- WhatsApp bot operational mode
    'whatsapp_bot_mode','whatsapp_bot_mode_changed_at','whatsapp_bot_mode_changed_by'
  ];
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
    where table_schema='public' and table_name='businesses'
      and column_name <> all(sensitive_cols);

  execute format('grant select (%s) on public.businesses to anon', cols);
end $$;
