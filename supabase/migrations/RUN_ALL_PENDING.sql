-- ══════════════════════════════════════════════════════════════
-- ALL PENDING MIGRATIONS — Run this entire block in Supabase SQL Editor
-- Safe to run multiple times (all statements use IF NOT EXISTS / OR REPLACE)
-- ══════════════════════════════════════════════════════════════

-- ┌─────────────────────────────────────────────────────┐
-- │ 1. PROMOTIONS TABLE + PROMO USES                    │
-- └─────────────────────────────────────────────────────┘

CREATE TABLE IF NOT EXISTS public.promotions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  discount_type  text NOT NULL CHECK (discount_type IN ('FLAT', 'PERCENT')),
  discount_value numeric NOT NULL CHECK (discount_value > 0),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz,
  max_uses       integer,
  used_count     integer NOT NULL DEFAULT 0,
  min_order_amount numeric DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, code)
);

CREATE TABLE IF NOT EXISTS public.promotion_uses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  email        text NOT NULL,
  booking_id   uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  used_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS promo_code text;

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_uses ENABLE ROW LEVEL SECURITY;

-- Anon full access (app uses custom auth)
DROP POLICY IF EXISTS "promotions_anon_all" ON public.promotions;
CREATE POLICY "promotions_anon_all" ON public.promotions FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "promotion_uses_anon_all" ON public.promotion_uses;
CREATE POLICY "promotion_uses_anon_all" ON public.promotion_uses FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON public.promotions TO anon, authenticated;
GRANT ALL ON public.promotion_uses TO anon, authenticated;

-- ┌─────────────────────────────────────────────────────┐
-- │ 2. PROMO VALIDATION & APPLICATION RPCs              │
-- └─────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION public.validate_promo_code(
    p_business_id UUID, p_code TEXT, p_order_amount NUMERIC DEFAULT 0, p_customer_email TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_promo RECORD; v_email_used BOOLEAN;
BEGIN
    SELECT * INTO v_promo FROM public.promotions WHERE business_id = p_business_id AND UPPER(code) = UPPER(TRIM(p_code)) LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'error', 'Invalid promo code'); END IF;
    IF NOT v_promo.active THEN RETURN jsonb_build_object('valid', false, 'error', 'This promo code is not currently active'); END IF;
    IF v_promo.valid_from > NOW() THEN RETURN jsonb_build_object('valid', false, 'error', 'This promo code is not yet active'); END IF;
    IF v_promo.valid_until IS NOT NULL AND v_promo.valid_until < NOW() THEN RETURN jsonb_build_object('valid', false, 'error', 'This promo code has expired'); END IF;
    IF v_promo.max_uses IS NOT NULL AND v_promo.used_count >= v_promo.max_uses THEN RETURN jsonb_build_object('valid', false, 'error', 'This promo code is no longer available'); END IF;
    IF p_order_amount > 0 AND v_promo.min_order_amount > 0 AND p_order_amount < v_promo.min_order_amount THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Minimum order of R' || v_promo.min_order_amount::TEXT || ' required for this promo');
    END IF;
    IF p_customer_email IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM public.promotion_uses WHERE promotion_id = v_promo.id AND LOWER(email) = LOWER(TRIM(p_customer_email))) INTO v_email_used;
        IF v_email_used AND v_promo.max_uses = 1 THEN RETURN jsonb_build_object('valid', false, 'error', 'You have already used this promo code'); END IF;
    END IF;
    RETURN jsonb_build_object('valid', true, 'promo_id', v_promo.id, 'code', v_promo.code, 'discount_type', v_promo.discount_type, 'discount_value', v_promo.discount_value, 'description', COALESCE(v_promo.description, ''));
END; $$;

CREATE OR REPLACE FUNCTION public.apply_promo_code(p_promo_id UUID, p_customer_email TEXT, p_booking_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE public.promotions SET used_count = used_count + 1 WHERE id = p_promo_id;
    INSERT INTO public.promotion_uses (id, promotion_id, email, booking_id, used_at) VALUES (gen_random_uuid(), p_promo_id, LOWER(TRIM(p_customer_email)), p_booking_id, NOW());
END; $$;

GRANT EXECUTE ON FUNCTION public.validate_promo_code TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_promo_code TO anon, authenticated;

-- ┌─────────────────────────────────────────────────────┐
-- │ 3. BUSINESS ADMIN SEATS                             │
-- └─────────────────────────────────────────────────────┘

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS max_admin_seats INTEGER NOT NULL DEFAULT 3;

-- ┌─────────────────────────────────────────────────────┐
-- │ 4. ANON UPDATE POLICY FOR BUSINESSES                │
-- └─────────────────────────────────────────────────────┘

DROP POLICY IF EXISTS "businesses_anon_update" ON public.businesses;
CREATE POLICY "businesses_anon_update" ON public.businesses FOR UPDATE TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "businesses_anon_insert" ON public.businesses;
CREATE POLICY "businesses_anon_insert" ON public.businesses FOR INSERT TO anon WITH CHECK (true);

-- ┌─────────────────────────────────────────────────────┐
-- │ 5. EMAIL DEFAULTS (20 free, R0.10 per overage)      │
-- └─────────────────────────────────────────────────────┘

ALTER TABLE public.businesses ALTER COLUMN marketing_included_emails SET DEFAULT 20;
ALTER TABLE public.businesses ALTER COLUMN marketing_overage_rate_zar SET DEFAULT 0.10;
UPDATE public.businesses SET marketing_included_emails = 20, marketing_overage_rate_zar = 0.10
WHERE marketing_included_emails = 500 OR marketing_overage_rate_zar = 0.15;

-- ┌─────────────────────────────────────────────────────┐
-- │ 6. SUBDOMAIN COLUMN                                 │
-- └─────────────────────────────────────────────────────┘

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS subdomain text UNIQUE;
CREATE INDEX IF NOT EXISTS idx_businesses_subdomain ON public.businesses (subdomain) WHERE subdomain IS NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_business_by_subdomain(p_subdomain text)
RETURNS TABLE (
  id uuid, business_name text, business_tagline text, logo_url text, timezone text, currency text,
  color_main text, color_secondary text, color_cta text, color_bg text, color_nav text, color_hover text,
  chatbot_avatar text, hero_eyebrow text, hero_title text, hero_subtitle text,
  booking_site_url text, faq_json jsonb, ai_system_prompt text,
  directions text, what_to_bring text, what_to_wear text,
  terms_conditions text, privacy_policy text, cookies_policy text,
  nav_gift_voucher_label text, nav_my_bookings_label text, card_cta_label text,
  chat_widget_label text, footer_line_one text, footer_line_two text
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT b.id, b.business_name, b.business_tagline, b.logo_url, b.timezone, b.currency,
    b.color_main, b.color_secondary, b.color_cta, b.color_bg, b.color_nav, b.color_hover,
    b.chatbot_avatar, b.hero_eyebrow, b.hero_title, b.hero_subtitle,
    b.booking_site_url, b.faq_json, b.ai_system_prompt,
    b.directions, b.what_to_bring, b.what_to_wear,
    b.terms_conditions, b.privacy_policy, b.cookies_policy,
    b.nav_gift_voucher_label, b.nav_my_bookings_label, b.card_cta_label,
    b.chat_widget_label, b.footer_line_one, b.footer_line_two
  FROM public.businesses b WHERE LOWER(b.subdomain) = LOWER(p_subdomain) AND b.subscription_status = 'ACTIVE' LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_business_by_subdomain TO anon, authenticated;

-- ┌─────────────────────────────────────────────────────┐
-- │ 7. FROM_EMAIL COLUMN                                │
-- └─────────────────────────────────────────────────────┘

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS from_email text;

-- ┌─────────────────────────────────────────────────────┐
-- │ 8. HERO_IMAGE COLUMN (for landing pages)            │
-- └─────────────────────────────────────────────────────┘

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS hero_image text;

-- ══════════════════════════════════════════════════════════════
-- DONE — All migrations applied. Refresh your dashboard.
-- ══════════════════════════════════════════════════════════════
