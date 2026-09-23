-- Schema-only fixture copied from live metadata on 2026-09-07; NO user records.
-- Minimal Supabase auth context for a disposable PostgreSQL cluster.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
-- Minimal Supabase Storage surface used by the read-only account trigger.
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$
  select string_to_array($1, '/')
$$;
create type public.whatsapp_bot_mode as enum ('OFF', 'ALWAYS_ON', 'OUTSIDE_HOURS');
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role')
$$;
create function public.bt_request_header(p_name text) returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> p_name, '')
$$;

create table public.add_ons (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  name text not null,
  description text,
  price numeric(10,2) default 0 not null,
  image_url text,
  active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table public.admin_users (
  id uuid default gen_random_uuid() not null,
  email text not null,
  password_hash text not null,
  role text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  business_id uuid,
  name text,
  password_set_at timestamp with time zone,
  must_set_password boolean default true not null,
  setup_token_hash text,
  setup_token_expires_at timestamp with time zone,
  invite_sent_at timestamp with time zone,
  user_id uuid,
  suspended boolean default false not null,
  settings_permissions jsonb default '{}'::jsonb,
  onboarding_completed_at timestamp with time zone,
  help_chat_hidden boolean default false not null,
  setup_token_hash_used text
);

create table public.booking_add_ons (
  id uuid default gen_random_uuid() not null,
  booking_id uuid not null,
  add_on_id uuid not null,
  qty integer default 1 not null,
  unit_price numeric(10,2) not null,
  created_at timestamp with time zone default now() not null
);

create table public.conversations (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  phone text not null,
  status text default 'BOT'::text not null,
  customer_name text,
  last_activity_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.bookings (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  tour_id uuid not null,
  slot_id uuid,
  customer_name text not null,
  phone text,
  email text not null,
  qty integer not null,
  unit_price numeric(10,2) not null,
  total_amount numeric(10,2) not null,
  status text default 'PENDING'::text not null,
  source text default 'WHATSAPP'::text not null,
  voucher_code character(8),
  payfast_m_payment_id text,
  created_at timestamp with time zone default now() not null,
  cancelled_at timestamp with time zone,
  cancellation_reason text,
  reschedule_count integer default 0 not null,
  refund_status text,
  refund_amount numeric(10,2) default NULL::numeric,
  refund_processed_at timestamp with time zone,
  refund_notes text,
  discount_type text,
  discount_percent integer default 0,
  original_total numeric(10,2) default NULL::numeric,
  yoco_checkout_id text,
  ref_code text,
  converted_to_voucher_id uuid,
  reminder_queued boolean default false,
  thankyou_queued boolean default false,
  yoco_payment_id text,
  invoice_id uuid,
  referral_code text,
  referral_discount numeric(10,2) default 0,
  review_prompted boolean default false,
  payment_deadline timestamp with time zone,
  checked_in boolean default false not null,
  checked_in_at timestamp with time zone,
  external_ref text,
  external_source_details jsonb default '{}'::jsonb not null,
  supplier_payment_status text,
  supplier_settlement_status text,
  supplier_payout_amount numeric,
  supplier_commission_amount numeric,
  created_by_admin_name text,
  created_by_admin_email text,
  discount_notes text,
  custom_fields jsonb default '{}'::jsonb not null,
  waiver_status text default 'PENDING'::text not null,
  waiver_token uuid default gen_random_uuid() not null,
  waiver_signed_at timestamp with time zone,
  waiver_signed_name text,
  waiver_payload jsonb default '{}'::jsonb not null,
  confirmation_sent_at timestamp with time zone,
  waiver_token_expires_at timestamp with time zone,
  refund_error text,
  total_captured numeric default 0,
  total_refunded numeric default 0,
  marketing_opt_in boolean,
  is_combo boolean default false not null,
  combo_booking_id uuid,
  discount_amount numeric default 0,
  promo_code text,
  payment_status text,
  payment_method text,
  customer_id uuid,
  ota_channel text,
  ota_external_booking_id text,
  ota_net_amount numeric(12,2),
  ota_gross_amount numeric(12,2),
  ota_metadata jsonb,
  voucher_amount_paid numeric(12,2) default 0 not null,
  terms_accepted_at timestamp with time zone,
  completed_at timestamp with time zone,
  customer_company_name text,
  customer_vat_number text,
  payment_url text,
  allow_unpaid boolean default false not null
);

create table public.businesses (
  id uuid default gen_random_uuid() not null,
  name text not null,
  timezone text default 'Africa/Johannesburg'::text not null,
  operator_email text not null,
  created_at timestamp with time zone default now() not null,
  chatbot_avatar text,
  color_main text,
  color_secondary text,
  color_cta text,
  cookies_policy text,
  privacy_policy text,
  terms_conditions text,
  directions text,
  hero_eyebrow text,
  hero_title text,
  hero_subtitle text,
  business_name text,
  business_tagline text,
  logo_url text,
  color_bg text,
  color_nav text,
  color_hover text default '#48cfad'::text,
  currency text default 'ZAR'::text not null,
  brand_colors jsonb default jsonb_build_object('main', '#0f5dd7', 'secondary', '#101828', 'cta', '#0c8a59', 'bg', '#f5f5f5', 'nav', '#ffffff', 'hover', '#48cfad') not null,
  weather_widget_locations jsonb default '[]'::jsonb not null,
  waiver_url text,
  ai_system_prompt text default ''::text not null,
  faq_json jsonb default '{}'::jsonb not null,
  terminology jsonb default '{}'::jsonb not null,
  wa_token_encrypted bytea,
  wa_phone_id_encrypted bytea,
  yoco_secret_key_encrypted bytea,
  booking_site_url text,
  manage_bookings_url text,
  gift_voucher_url text,
  booking_success_url text,
  booking_cancel_url text,
  voucher_success_url text,
  nav_gift_voucher_label text,
  nav_my_bookings_label text,
  card_cta_label text,
  chat_widget_label text,
  footer_line_one text,
  footer_line_two text,
  booking_custom_fields jsonb default '[]'::jsonb not null,
  yoco_webhook_secret_encrypted bytea,
  email_img_payment text,
  email_img_confirm text,
  email_img_invoice text,
  email_img_gift text,
  email_img_cancel text,
  email_img_cancel_weather text,
  email_img_indemnity text,
  email_img_admin text,
  email_img_voucher text,
  email_img_photos text,
  what_to_bring text,
  what_to_wear text,
  subscription_status text default 'ACTIVE'::text not null,
  email_color text default '#1b3b36'::text not null,
  paysafe_api_key_encrypted bytea,
  paysafe_api_secret_encrypted bytea,
  paysafe_account_id text,
  paysafe_linked_account_id text,
  marketing_email_usage integer default 0 not null,
  marketing_included_emails integer default 20 not null,
  marketing_overage_rate_zar numeric(10,2) default 0.10 not null,
  max_admin_seats integer default 3 not null,
  subdomain text,
  from_email text,
  hero_image text,
  social_facebook text,
  social_instagram text,
  social_tiktok text,
  social_youtube text,
  social_twitter text,
  social_linkedin text,
  social_tripadvisor text,
  social_google_reviews text,
  marketing_test_email text,
  automation_config jsonb default '{}'::jsonb,
  activity_noun text,
  activity_verb_past text,
  location_phrase text,
  weather_relevance boolean default true not null,
  google_drive_folder_id text,
  google_drive_email text,
  invoice_company_name text,
  invoice_address_line1 text,
  invoice_address_line2 text,
  invoice_address_line3 text,
  invoice_reg_number text,
  invoice_vat_number text,
  google_drive_refresh_token_encrypted bytea,
  bank_account_owner_encrypted bytea,
  bank_account_number_encrypted bytea,
  bank_account_type_encrypted bytea,
  bank_name_encrypted bytea,
  bank_branch_code_encrypted bytea,
  meeting_point_address text,
  arrival_instructions text,
  business_address text,
  yoco_test_mode boolean default false not null,
  yoco_test_secret_key_encrypted bytea,
  yoco_test_webhook_secret_encrypted bytea,
  google_place_id text,
  google_reviews_last_synced_at timestamp with time zone,
  refund_policy_tiers jsonb default '[{"hours_before": 24, "refund_percent": 100}, {"hours_before": 2, "refund_percent": 50}, {"hours_before": 0, "refund_percent": 0}]'::jsonb not null,
  refund_policy_text text default 'Cancel free up to 24 hours before your tour for a full refund. Within 24 hours, 50% refund. Within 2 hours of tour start, no refund. Weather cancellations by the operator are fully refunded.'::text,
  gdrive_photos_folder_id text,
  gdrive_photos_folder_url text,
  whatsapp_bot_mode whatsapp_bot_mode default 'ALWAYS_ON'::whatsapp_bot_mode not null,
  whatsapp_bot_mode_changed_at timestamp with time zone,
  whatsapp_bot_mode_changed_by uuid,
  meeting_point text,
  notification_email text,
  business_hours jsonb,
  public_email text,
  public_phone text,
  public_whatsapp text,
  wa_phone_id_lookup text,
  email_tagline text,
  billing_admin_user_id uuid,
  directory_visible boolean default true not null,
  suspension_reason text,
  ai_included_replies integer default 5000 not null,
  ai_overage_rate_zar numeric default 0.15 not null,
  yoco_webhook_status text
);

create table public.customers (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  email text not null,
  email_lower text generated always as (lower(email)) stored,
  name text,
  phone text,
  marketing_consent boolean default false not null,
  total_bookings integer default 0 not null,
  total_spent numeric(12,2) default 0 not null,
  first_booking_at timestamp with time zone,
  last_booking_at timestamp with time zone,
  date_of_birth date,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  user_id uuid,
  deleted_at timestamp with time zone
);

create table public.holds (
  id uuid default gen_random_uuid() not null,
  booking_id uuid not null,
  expires_at timestamp with time zone not null,
  status text default 'ACTIVE'::text not null,
  created_at timestamp with time zone default now() not null,
  slot_id uuid,
  qty integer default 1,
  hold_type text default 'BOOKING'::text not null,
  metadata jsonb
);

create table public.idempotency_keys (
  id uuid default gen_random_uuid() not null,
  key text not null,
  created_at timestamp with time zone default now() not null
);

create table public.marketing_automation_enrollments (
  id uuid default gen_random_uuid() not null,
  automation_id uuid not null,
  contact_id uuid not null,
  business_id uuid not null,
  current_step integer default 0 not null,
  status text default 'active'::text not null,
  next_action_at timestamp with time zone default now() not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.marketing_automation_steps (
  id uuid default gen_random_uuid() not null,
  automation_id uuid not null,
  "position" integer not null,
  step_type text not null,
  config jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table public.marketing_automations (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  name text not null,
  description text,
  trigger_type text not null,
  trigger_config jsonb default '{}'::jsonb not null,
  status text default 'draft'::text not null,
  enrolled_count integer default 0 not null,
  completed_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.marketing_campaigns (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  template_id uuid,
  name text not null,
  subject_line text default ''::text not null,
  audience_filter jsonb default '{}'::jsonb,
  status text default 'draft'::text not null,
  total_recipients integer default 0,
  total_sent integer default 0,
  total_failed integer default 0,
  scheduled_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  total_opens integer default 0 not null,
  total_clicks integer default 0 not null,
  total_unsubscribes integer default 0 not null,
  total_bounces integer default 0 not null
);

create table public.marketing_contacts (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  email text not null,
  first_name text,
  last_name text,
  status text default 'active'::text not null,
  source text default 'manual'::text,
  tags text[] default '{}'::text[],
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  bounce_status text,
  bounced_at timestamp with time zone,
  total_received integer default 0 not null,
  total_opens integer default 0 not null,
  total_clicks integer default 0 not null,
  last_open_at timestamp with time zone,
  last_click_at timestamp with time zone,
  notes text,
  phone text,
  last_email_at timestamp with time zone,
  date_of_birth date,
  anniversary_date date
);

create table public.marketing_queue (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  campaign_id uuid not null,
  contact_id uuid not null,
  email text not null,
  first_name text,
  status text default 'pending'::text not null,
  error_message text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  resend_email_id text,
  retry_count integer default 0 not null,
  next_retry_at timestamp with time zone,
  processing_started_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

create table public.marketing_templates (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  name text not null,
  category text default 'general'::text,
  subject_line text default ''::text not null,
  html_content text default ''::text not null,
  editor_json jsonb default '[]'::jsonb,
  thumbnail_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.marketing_usage_monthly (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  period text not null,
  emails_sent integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.paid_booking_events (
  booking_id uuid not null,
  business_id uuid not null,
  period_key date not null,
  created_at timestamp with time zone default now() not null
);

create table public.pending_reschedules (
  id uuid default gen_random_uuid() not null,
  booking_id uuid not null,
  business_id uuid not null,
  old_slot_id uuid not null,
  new_slot_id uuid not null,
  hold_id uuid,
  diff numeric not null,
  new_unit_price numeric not null,
  new_total_amount numeric not null,
  new_tour_id uuid,
  status text default 'PENDING'::text not null,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  expired_at timestamp with time zone,
  new_qty integer
);

create table public.promotion_uses (
  id uuid default gen_random_uuid() not null,
  promotion_id uuid not null,
  email text not null,
  booking_id uuid,
  used_at timestamp with time zone default now() not null,
  phone text
);

create table public.promotions (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  code text not null,
  description text default ''::text not null,
  discount_type text not null,
  discount_value numeric not null,
  valid_from timestamp with time zone default now() not null,
  valid_until timestamp with time zone,
  max_uses integer,
  used_count integer default 0 not null,
  min_order_amount numeric default 0,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  max_uses_per_customer integer default 1 not null
);

create table public.reviews (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  tour_id uuid,
  booking_id uuid,
  source text not null,
  status text default 'PENDING'::text not null,
  rating smallint,
  comment text,
  reviewer_name text,
  reviewer_avatar_url text,
  google_review_id text,
  submission_token text,
  submitted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  reminder_sent_at timestamp with time zone
);

create table public.slots (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  tour_id uuid not null,
  start_time timestamp with time zone not null,
  status text default 'OPEN'::text not null,
  capacity_total integer not null,
  booked integer default 0 not null,
  held integer default 0 not null,
  price_per_person_override numeric(10,2),
  created_at timestamp with time zone default now() not null,
  is_peak boolean default false,
  is_manually_overridden boolean default false,
  local_departure_time text,
  image_url text,
  last_minute_at timestamp with time zone,
  price_before_deal numeric
);

create table public.tours (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  name text not null,
  base_price_per_person numeric(10,2) not null,
  default_capacity integer not null,
  duration_minutes integer default 90 not null,
  created_at timestamp with time zone default now() not null,
  description text default ''::text,
  active boolean default true,
  sort_order integer default 0,
  peak_price_per_person numeric(10,2),
  hidden boolean default false,
  image_url text,
  meeting_point text,
  confirmation_tagline text,
  last_minute_hours integer,
  last_minute_price numeric,
  last_minute_end_hours integer
);

create table public.trip_photos (
  id uuid default gen_random_uuid() not null,
  business_id uuid,
  slot_id uuid,
  uploaded_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

create table public.usage_counters (
  business_id uuid not null,
  period_key date not null,
  paid_bookings_count integer default 0 not null,
  topup_quota_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.vouchers (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  code text not null,
  type text default 'PRODUCT'::text not null,
  value_amount numeric(10,2),
  status text default 'ACTIVE'::text not null,
  redeemed_booking_id uuid,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  value numeric(10,2) default NULL::numeric,
  source_booking_id uuid,
  redeemed_at timestamp with time zone,
  redeemed_by_phone text,
  gift_message text,
  recipient_name text,
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  tour_name text,
  purchase_amount numeric(10,2),
  yoco_checkout_id text,
  current_balance numeric default 0,
  pax_limit integer default 1,
  purchase_value numeric,
  recipient_email text,
  payment_url text,
  payment_reminder_sent_at timestamp with time zone
);

alter table public.add_ons add constraint "add_ons_pkey" PRIMARY KEY (id);
alter table public.admin_users add constraint "admin_users_email_key" UNIQUE (email);
alter table public.admin_users add constraint "admin_users_pkey" PRIMARY KEY (id);
alter table public.booking_add_ons add constraint "booking_add_ons_pkey" PRIMARY KEY (id);
alter table public.conversations add constraint "conversations_pkey" PRIMARY KEY (id);
alter table public.bookings add constraint "bookings_payfast_m_payment_id_key" UNIQUE (payfast_m_payment_id);
alter table public.bookings add constraint "bookings_pkey" PRIMARY KEY (id);
alter table public.bookings add constraint "bookings_refund_ceiling" CHECK (((total_captured IS NULL) OR (COALESCE(total_refunded, (0)::numeric) <= total_captured)));
alter table public.bookings add constraint "bookings_waiver_status_check" CHECK ((waiver_status = ANY (ARRAY['PENDING'::text, 'SIGNED'::text])));
alter table public.businesses add constraint "businesses_pkey" PRIMARY KEY (id);
alter table public.businesses add constraint "businesses_subdomain_key" UNIQUE (subdomain);
alter table public.businesses add constraint "businesses_suspension_reason_check" CHECK (((suspension_reason IS NULL) OR (suspension_reason = ANY (ARRAY['NON_PAYMENT'::text, 'MANUAL'::text]))));
alter table public.customers add constraint "customers_pkey" PRIMARY KEY (id);
alter table public.holds add constraint "holds_pkey" PRIMARY KEY (id);
alter table public.idempotency_keys add constraint "idempotency_keys_key_key" UNIQUE (key);
alter table public.idempotency_keys add constraint "idempotency_keys_pkey" PRIMARY KEY (id);
alter table public.marketing_automation_enrollments add constraint "marketing_automation_enrollments_automation_id_contact_id_key" UNIQUE (automation_id, contact_id);
alter table public.marketing_automation_enrollments add constraint "marketing_automation_enrollments_pkey" PRIMARY KEY (id);
alter table public.marketing_automation_enrollments add constraint "marketing_automation_enrollments_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'exited'::text, 'paused'::text])));
alter table public.marketing_automation_steps add constraint "marketing_automation_steps_pkey" PRIMARY KEY (id);
alter table public.marketing_automation_steps add constraint "marketing_automation_steps_step_type_check" CHECK ((step_type = ANY (ARRAY['send_email'::text, 'delay'::text, 'condition'::text, 'generate_voucher'::text, 'generate_promo'::text])));
alter table public.marketing_automations add constraint "marketing_automations_pkey" PRIMARY KEY (id);
alter table public.marketing_automations add constraint "marketing_automations_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'archived'::text])));
alter table public.marketing_automations add constraint "marketing_automations_trigger_type_check" CHECK ((trigger_type = ANY (ARRAY['contact_added'::text, 'tag_added'::text, 'post_booking'::text, 'date_field'::text, 'manual'::text])));
alter table public.marketing_campaigns add constraint "marketing_campaigns_pkey" PRIMARY KEY (id);
alter table public.marketing_campaigns add constraint "marketing_campaigns_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'pending'::text, 'sending'::text, 'paused'::text, 'done'::text, 'cancelled'::text])));
alter table public.marketing_contacts add constraint "marketing_contacts_bounce_status_check" CHECK ((bounce_status = ANY (ARRAY['hard'::text, 'soft'::text, 'complaint'::text])));
alter table public.marketing_contacts add constraint "marketing_contacts_pkey" PRIMARY KEY (id);
alter table public.marketing_contacts add constraint "marketing_contacts_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'unsubscribed'::text, 'bounced'::text, 'inactive'::text])));
alter table public.marketing_contacts add constraint "unique_contact_per_business" UNIQUE (business_id, email);
alter table public.marketing_queue add constraint "marketing_queue_pkey" PRIMARY KEY (id);
alter table public.marketing_queue add constraint "marketing_queue_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text])));
alter table public.marketing_queue add constraint "unique_queue_per_campaign_contact" UNIQUE (campaign_id, contact_id);
alter table public.marketing_templates add constraint "marketing_templates_pkey" PRIMARY KEY (id);
alter table public.marketing_usage_monthly add constraint "marketing_usage_monthly_business_id_period_key" UNIQUE (business_id, period);
alter table public.marketing_usage_monthly add constraint "marketing_usage_monthly_pkey" PRIMARY KEY (id);
alter table public.paid_booking_events add constraint "paid_booking_events_pkey" PRIMARY KEY (booking_id);
alter table public.pending_reschedules add constraint "pending_reschedules_pkey" PRIMARY KEY (id);
alter table public.pending_reschedules add constraint "pending_reschedules_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'COMPLETED'::text, 'EXPIRED'::text, 'CANCELLED'::text])));
alter table public.promotion_uses add constraint "promotion_uses_pkey" PRIMARY KEY (id);
alter table public.promotions add constraint "promotions_business_id_code_key" UNIQUE (business_id, code);
alter table public.promotions add constraint "promotions_discount_type_check" CHECK ((discount_type = ANY (ARRAY['FLAT'::text, 'PERCENT'::text])));
alter table public.promotions add constraint "promotions_discount_value_check" CHECK ((discount_value > (0)::numeric));
alter table public.promotions add constraint "promotions_pkey" PRIMARY KEY (id);
alter table public.reviews add constraint "reviews_google_review_id_key" UNIQUE (google_review_id);
alter table public.reviews add constraint "reviews_pkey" PRIMARY KEY (id);
alter table public.reviews add constraint "reviews_rating_check" CHECK (((rating >= 1) AND (rating <= 5)));
alter table public.reviews add constraint "reviews_source_check" CHECK ((source = ANY (ARRAY['NATIVE'::text, 'GOOGLE'::text])));
alter table public.reviews add constraint "reviews_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'HIDDEN'::text, 'SPAM'::text])));
alter table public.reviews add constraint "reviews_submission_token_key" UNIQUE (submission_token);
alter table public.slots add constraint "slots_business_id_tour_id_start_time_key" UNIQUE (business_id, tour_id, start_time);
alter table public.slots add constraint "slots_pkey" PRIMARY KEY (id);
alter table public.tours add constraint "tours_last_minute_window_chk" CHECK (((last_minute_end_hours IS NULL) OR ((last_minute_hours IS NOT NULL) AND (last_minute_end_hours >= 0) AND (last_minute_end_hours < last_minute_hours))));
alter table public.tours add constraint "tours_pkey" PRIMARY KEY (id);
alter table public.trip_photos add constraint "trip_photos_pkey" PRIMARY KEY (id);
alter table public.usage_counters add constraint "usage_counters_pkey" PRIMARY KEY (business_id, period_key);
alter table public.vouchers add constraint "vouchers_code_key" UNIQUE (code);
alter table public.vouchers add constraint "vouchers_pkey" PRIMARY KEY (id);
