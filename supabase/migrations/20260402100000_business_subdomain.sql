-- Add subdomain column for per-business booking pages
-- e.g. "aonyx" → aonyx.bookingtours.co.za
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS subdomain text UNIQUE;

-- Index for fast subdomain lookups
CREATE INDEX IF NOT EXISTS idx_businesses_subdomain ON public.businesses (subdomain) WHERE subdomain IS NOT NULL;

-- RPC to resolve a business by subdomain (public, no auth needed)
CREATE OR REPLACE FUNCTION public.resolve_business_by_subdomain(p_subdomain text)
RETURNS TABLE (
  id uuid,
  business_name text,
  business_tagline text,
  logo_url text,
  timezone text,
  currency text,
  color_main text,
  color_secondary text,
  color_cta text,
  color_bg text,
  color_nav text,
  color_hover text,
  chatbot_avatar text,
  hero_eyebrow text,
  hero_title text,
  hero_subtitle text,
  booking_site_url text,
  faq_json jsonb,
  ai_system_prompt text,
  directions text,
  what_to_bring text,
  what_to_wear text,
  terms_conditions text,
  privacy_policy text,
  cookies_policy text,
  nav_gift_voucher_label text,
  nav_my_bookings_label text,
  card_cta_label text,
  chat_widget_label text,
  footer_line_one text,
  footer_line_two text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    b.id, b.business_name, b.business_tagline, b.logo_url, b.timezone, b.currency,
    b.color_main, b.color_secondary, b.color_cta, b.color_bg, b.color_nav, b.color_hover,
    b.chatbot_avatar, b.hero_eyebrow, b.hero_title, b.hero_subtitle,
    b.booking_site_url, b.faq_json, b.ai_system_prompt,
    b.directions, b.what_to_bring, b.what_to_wear,
    b.terms_conditions, b.privacy_policy, b.cookies_policy,
    b.nav_gift_voucher_label, b.nav_my_bookings_label, b.card_cta_label,
    b.chat_widget_label, b.footer_line_one, b.footer_line_two
  FROM public.businesses b
  WHERE LOWER(b.subdomain) = LOWER(p_subdomain)
    AND b.subscription_status = 'ACTIVE'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_business_by_subdomain TO anon, authenticated;
