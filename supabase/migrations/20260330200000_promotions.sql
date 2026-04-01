-- Promo codes system: promotions + promotion_uses tables
-- Fundamentally different from vouchers — reusable discount instruments, not prepaid balances

-- ── promotions table ──
CREATE TABLE IF NOT EXISTS public.promotions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  discount_type  text NOT NULL CHECK (discount_type IN ('FLAT', 'PERCENT')),
  discount_value numeric NOT NULL CHECK (discount_value > 0),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz,
  max_uses       integer,        -- NULL = unlimited
  used_count     integer NOT NULL DEFAULT 0,
  min_order_amount numeric DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, code)
);

-- ── promotion_uses table (per-email tracking) ──
CREATE TABLE IF NOT EXISTS public.promotion_uses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  email        text NOT NULL,
  booking_id   uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  used_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Add promo columns to bookings ──
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promo_code text;

-- ── RLS ──
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_uses ENABLE ROW LEVEL SECURITY;

-- promotions: anon can SELECT (customer code lookup), authenticated scoped to business
DROP POLICY IF EXISTS "promotions_anon_select" ON public.promotions;
CREATE POLICY "promotions_anon_select" ON public.promotions
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "promotions_auth_select" ON public.promotions;
CREATE POLICY "promotions_auth_select" ON public.promotions
  FOR SELECT TO authenticated USING (business_id IN (SELECT current_business_ids()));

DROP POLICY IF EXISTS "promotions_auth_insert" ON public.promotions;
CREATE POLICY "promotions_auth_insert" ON public.promotions
  FOR INSERT TO authenticated WITH CHECK (business_id IN (SELECT current_business_ids()));

DROP POLICY IF EXISTS "promotions_auth_update" ON public.promotions;
CREATE POLICY "promotions_auth_update" ON public.promotions
  FOR UPDATE TO authenticated USING (business_id IN (SELECT current_business_ids()));

DROP POLICY IF EXISTS "promotions_auth_delete" ON public.promotions;
CREATE POLICY "promotions_auth_delete" ON public.promotions
  FOR DELETE TO authenticated USING (business_id IN (SELECT current_business_ids()));

-- promotion_uses: anon can SELECT + INSERT (customer records usage), authenticated scoped via join
DROP POLICY IF EXISTS "promotion_uses_anon_select" ON public.promotion_uses;
CREATE POLICY "promotion_uses_anon_select" ON public.promotion_uses
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "promotion_uses_anon_insert" ON public.promotion_uses;
CREATE POLICY "promotion_uses_anon_insert" ON public.promotion_uses
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "promotion_uses_auth_select" ON public.promotion_uses;
CREATE POLICY "promotion_uses_auth_select" ON public.promotion_uses
  FOR SELECT TO authenticated
  USING (promotion_id IN (SELECT id FROM public.promotions WHERE business_id IN (SELECT current_business_ids())));

DROP POLICY IF EXISTS "promotion_uses_auth_insert" ON public.promotion_uses;
CREATE POLICY "promotion_uses_auth_insert" ON public.promotion_uses
  FOR INSERT TO authenticated
  WITH CHECK (promotion_id IN (SELECT id FROM public.promotions WHERE business_id IN (SELECT current_business_ids())));

DROP POLICY IF EXISTS "promotion_uses_auth_update" ON public.promotion_uses;
CREATE POLICY "promotion_uses_auth_update" ON public.promotion_uses
  FOR UPDATE TO authenticated
  USING (promotion_id IN (SELECT id FROM public.promotions WHERE business_id IN (SELECT current_business_ids())));

DROP POLICY IF EXISTS "promotion_uses_auth_delete" ON public.promotion_uses;
CREATE POLICY "promotion_uses_auth_delete" ON public.promotion_uses
  FOR DELETE TO authenticated
  USING (promotion_id IN (SELECT id FROM public.promotions WHERE business_id IN (SELECT current_business_ids())));

-- ── Grants ──
GRANT ALL ON public.promotions TO authenticated;
GRANT ALL ON public.promotion_uses TO authenticated;
GRANT SELECT ON public.promotions TO anon;
GRANT SELECT, INSERT ON public.promotion_uses TO anon;
