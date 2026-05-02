-- Revoke anon SELECT on 14 sensitive columns in public.businesses.
-- Booking site (anon) needs the table for tenant resolution and display,
-- but never reads credentials, bank details, or encrypted secrets.
--
-- Approach: revoke table-level SELECT from anon, re-grant on 85 safe columns.
-- authenticated and service_role are unaffected (keep table-level SELECT).
--
-- REVOKED columns (14):
--   CRITICAL:  google_drive_refresh_token (plaintext OAuth token)
--   HIGH:      bank_account_owner, bank_account_number, bank_account_type,
--              bank_name, bank_branch_code (financial PII)
--   MEDIUM:    paysafe_account_id, paysafe_linked_account_id
--   LOW:       wa_token_encrypted, wa_phone_id_encrypted,
--              yoco_secret_key_encrypted, yoco_webhook_secret_encrypted,
--              paysafe_api_key_encrypted, paysafe_api_secret_encrypted

BEGIN;

-- Step 1: Remove table-level SELECT from anon
REVOKE SELECT ON public.businesses FROM anon;

-- Step 2: Grant column-level SELECT on 85 non-sensitive columns to anon
GRANT SELECT (
  id,
  name,
  timezone,
  operator_email,
  created_at,
  chatbot_avatar,
  color_main,
  color_secondary,
  color_cta,
  cookies_policy,
  privacy_policy,
  terms_conditions,
  directions,
  hero_eyebrow,
  hero_title,
  hero_subtitle,
  business_name,
  business_tagline,
  logo_url,
  color_bg,
  color_nav,
  color_hover,
  currency,
  brand_colors,
  weather_widget_locations,
  waiver_url,
  ai_system_prompt,
  faq_json,
  terminology,
  booking_site_url,
  manage_bookings_url,
  gift_voucher_url,
  booking_success_url,
  booking_cancel_url,
  voucher_success_url,
  nav_gift_voucher_label,
  nav_my_bookings_label,
  card_cta_label,
  chat_widget_label,
  footer_line_one,
  footer_line_two,
  booking_custom_fields,
  email_img_payment,
  email_img_confirm,
  email_img_invoice,
  email_img_gift,
  email_img_cancel,
  email_img_cancel_weather,
  email_img_indemnity,
  email_img_admin,
  email_img_voucher,
  email_img_photos,
  what_to_bring,
  what_to_wear,
  subscription_status,
  email_color,
  marketing_email_usage,
  marketing_included_emails,
  marketing_overage_rate_zar,
  max_admin_seats,
  subdomain,
  from_email,
  hero_image,
  social_facebook,
  social_instagram,
  social_tiktok,
  social_youtube,
  social_twitter,
  social_linkedin,
  social_tripadvisor,
  social_google_reviews,
  marketing_test_email,
  automation_config,
  activity_noun,
  activity_verb_past,
  location_phrase,
  weather_relevance,
  google_drive_folder_id,
  google_drive_email,
  invoice_company_name,
  invoice_address_line1,
  invoice_address_line2,
  invoice_address_line3,
  invoice_reg_number,
  invoice_vat_number
) ON public.businesses TO anon;

-- Step 3: Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
