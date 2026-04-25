-- ════════════════════════════════════════════════════════════════════
-- MVP hardening: atomic promo-code enforcement (AH9)
--
-- Problem: validate_promo_code() + apply_promo_code() are split across
-- two RPCs with no row lock between the duplicate-use check and the
-- INSERT into promotion_uses. Two concurrent requests from the same
-- email can both pass validation and both insert — bypassing the
-- max_uses=1 rule entirely.
--
-- Fix:
--   1. Backfill: dedupe any rows already in promotion_uses with the
--      same (promotion_id, lower(email)) — keep the oldest.
--   2. Add a UNIQUE INDEX on (promotion_id, lower(email)). This makes
--      duplicate use a HARD database error, not an application check.
--   3. Replace apply_promo_code() with an atomic version that locks
--      the promo row (SELECT FOR UPDATE), re-checks max_uses, performs
--      the INSERT (which will fail loudly on duplicate), and increments
--      used_count in the same transaction. Returns JSONB so callers
--      can detect and recover from duplicate-use failures.
--   4. Strengthen validate_promo_code() so it always checks per-email
--      use, not just when max_uses=1. Anyone trying to use the same
--      code twice with the same email gets an early, friendly error
--      instead of a 500 from the unique constraint.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Backfill: dedupe existing duplicate (promotion_id, lower(email)) rows ──
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY promotion_id, LOWER(TRIM(email))
      ORDER BY used_at ASC, id ASC
    ) AS rn
  FROM public.promotion_uses
)
DELETE FROM public.promotion_uses
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 2. Hard DB constraint: one use per (promo, normalized email) ──
CREATE UNIQUE INDEX IF NOT EXISTS promotion_uses_promo_email_uniq
  ON public.promotion_uses (promotion_id, LOWER(TRIM(email)));

-- ── 3. Atomic apply RPC ──
-- Returns: { ok: true, used_count: N } on success
--          { ok: false, error: <reason> } on any failure.
-- p_customer_phone is accepted for forward-compatibility with existing
-- callers (create-checkout, yoco-webhook) that pass it; it is currently
-- unused but kept in the signature so upgrades don't 404 those callers.
-- Drop both old signatures so the new return type (jsonb) replaces VOID/etc.
DROP FUNCTION IF EXISTS public.apply_promo_code(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.apply_promo_code(uuid, text, uuid, text);
CREATE OR REPLACE FUNCTION public.apply_promo_code(
    p_promo_id UUID,
    p_customer_email TEXT,
    p_booking_id UUID DEFAULT NULL,
    p_customer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_promo RECORD;
    v_normalized_email TEXT;
BEGIN
    v_normalized_email := LOWER(TRIM(COALESCE(p_customer_email, '')));
    IF v_normalized_email = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'customer email is required');
    END IF;

    -- Lock the promo row to serialize concurrent applies
    SELECT id, max_uses, used_count, active, valid_until INTO v_promo
    FROM public.promotions
    WHERE id = p_promo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'promo not found');
    END IF;

    IF NOT v_promo.active THEN
        RETURN jsonb_build_object('ok', false, 'error', 'promo is not active');
    END IF;

    IF v_promo.valid_until IS NOT NULL AND v_promo.valid_until < NOW() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'promo has expired');
    END IF;

    IF v_promo.max_uses IS NOT NULL AND v_promo.used_count >= v_promo.max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', 'promo has reached its use limit');
    END IF;

    -- Insert the use record. Unique index on (promotion_id, lower(email))
    -- guarantees a single email cannot consume the same promo twice even
    -- under concurrent requests. Catch the duplicate so we can return a
    -- friendly response instead of a 23505 surface error.
    BEGIN
        INSERT INTO public.promotion_uses (id, promotion_id, email, booking_id, used_at)
        VALUES (gen_random_uuid(), p_promo_id, v_normalized_email, p_booking_id, NOW());
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'error', 'this email has already used this promo');
    END;

    -- Increment under the same lock
    UPDATE public.promotions
    SET used_count = used_count + 1
    WHERE id = p_promo_id;

    RETURN jsonb_build_object('ok', true, 'used_count', v_promo.used_count + 1);
END;
$$;

-- ── 4. Stronger validate: always check per-email use ──
CREATE OR REPLACE FUNCTION public.validate_promo_code(
    p_business_id UUID,
    p_code TEXT,
    p_order_amount NUMERIC DEFAULT 0,
    p_customer_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_promo RECORD;
    v_email_used BOOLEAN;
BEGIN
    SELECT * INTO v_promo
    FROM public.promotions
    WHERE business_id = p_business_id
      AND UPPER(code) = UPPER(TRIM(p_code))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Invalid promo code');
    END IF;

    IF NOT v_promo.active THEN
        RETURN jsonb_build_object('valid', false, 'error', 'This promo code is not currently active');
    END IF;

    IF v_promo.valid_from > NOW() THEN
        RETURN jsonb_build_object('valid', false, 'error', 'This promo code is not yet active');
    END IF;

    IF v_promo.valid_until IS NOT NULL AND v_promo.valid_until < NOW() THEN
        RETURN jsonb_build_object('valid', false, 'error', 'This promo code has expired');
    END IF;

    IF v_promo.max_uses IS NOT NULL AND v_promo.used_count >= v_promo.max_uses THEN
        RETURN jsonb_build_object('valid', false, 'error', 'This promo code is no longer available');
    END IF;

    IF p_order_amount > 0 AND v_promo.min_order_amount > 0 AND p_order_amount < v_promo.min_order_amount THEN
        RETURN jsonb_build_object('valid', false, 'error',
            'Minimum order of R' || v_promo.min_order_amount::TEXT || ' required for this promo');
    END IF;

    -- Always check per-email duplicate use, regardless of max_uses.
    -- The unique index enforces this anyway; this just gives a friendly
    -- early error before the customer fills out the rest of the form.
    IF p_customer_email IS NOT NULL AND TRIM(p_customer_email) <> '' THEN
        SELECT EXISTS(
            SELECT 1 FROM public.promotion_uses
            WHERE promotion_id = v_promo.id
              AND LOWER(TRIM(email)) = LOWER(TRIM(p_customer_email))
        ) INTO v_email_used;

        IF v_email_used THEN
            RETURN jsonb_build_object('valid', false, 'error', 'You have already used this promo code');
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'promo_id', v_promo.id,
        'code', v_promo.code,
        'discount_type', v_promo.discount_type,
        'discount_value', v_promo.discount_value,
        'description', COALESCE(v_promo.description, '')
    );
END;
$$;

-- Use explicit signatures — both functions were previously defined with
-- different signatures, leaving overloads in place that make ambiguous
-- GRANT statements fail with "function name is not unique" (42725).
GRANT EXECUTE ON FUNCTION public.validate_promo_code(uuid, text, numeric, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_promo_code(uuid, text, uuid, text) TO anon, authenticated;
