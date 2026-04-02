-- ══════════════════════════════════════════════════════════
-- Promo Code Validation & Application RPC
-- Used by all booking pipelines (Yoco, Paysafe, admin, external)
-- ══════════════════════════════════════════════════════════

-- Validate a promo code: checks existence, active, dates, uses, min order
-- Returns the promo details if valid, or an error message
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
    -- Lookup promo (case-insensitive)
    SELECT * INTO v_promo
    FROM public.promotions
    WHERE business_id = p_business_id
      AND UPPER(code) = UPPER(TRIM(p_code))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Invalid promo code');
    END IF;

    -- Check active
    IF NOT v_promo.active THEN
        RETURN jsonb_build_object('valid', false, 'error', 'This promo code is not currently active');
    END IF;

    -- Check valid_from
    IF v_promo.valid_from > NOW() THEN
        RETURN jsonb_build_object('valid', false, 'error', 'This promo code is not yet active');
    END IF;

    -- Check valid_until
    IF v_promo.valid_until IS NOT NULL AND v_promo.valid_until < NOW() THEN
        RETURN jsonb_build_object('valid', false, 'error', 'This promo code has expired');
    END IF;

    -- Check max_uses
    IF v_promo.max_uses IS NOT NULL AND v_promo.used_count >= v_promo.max_uses THEN
        RETURN jsonb_build_object('valid', false, 'error', 'This promo code is no longer available');
    END IF;

    -- Check min_order_amount
    IF p_order_amount > 0 AND v_promo.min_order_amount > 0 AND p_order_amount < v_promo.min_order_amount THEN
        RETURN jsonb_build_object('valid', false, 'error',
            'Minimum order of R' || v_promo.min_order_amount::TEXT || ' required for this promo');
    END IF;

    -- Check per-email usage (if email provided and max_uses = 1, prevent reuse)
    IF p_customer_email IS NOT NULL THEN
        SELECT EXISTS(
            SELECT 1 FROM public.promotion_uses
            WHERE promotion_id = v_promo.id
              AND LOWER(email) = LOWER(TRIM(p_customer_email))
        ) INTO v_email_used;

        IF v_email_used AND v_promo.max_uses = 1 THEN
            RETURN jsonb_build_object('valid', false, 'error', 'You have already used this promo code');
        END IF;
    END IF;

    -- Valid! Return promo details
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

-- Apply a promo: increments used_count and records in promotion_uses
-- Call AFTER successful payment/booking creation
CREATE OR REPLACE FUNCTION public.apply_promo_code(
    p_promo_id UUID,
    p_customer_email TEXT,
    p_booking_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Increment used_count
    UPDATE public.promotions
    SET used_count = used_count + 1
    WHERE id = p_promo_id;

    -- Record usage
    INSERT INTO public.promotion_uses (id, promotion_id, email, booking_id, used_at)
    VALUES (gen_random_uuid(), p_promo_id, LOWER(TRIM(p_customer_email)), p_booking_id, NOW());
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION public.validate_promo_code TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_promo_code TO anon, authenticated;
