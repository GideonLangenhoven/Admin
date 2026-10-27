-- Section 5: validate_promo_code stays open to anon so the storefront can check
-- a code, but that made it an unthrottled oracle: a script could guess a
-- tenant's codes and, given a code, test which emails have used it. Browser
-- callers (storefront and admin) now share the per-IP bucket the edge
-- functions use: 30 checks a minute. service_role callers (combo checkout,
-- external-booking) are not counted, since they share one server IP. The IP is
-- read the way _shared/otp-attempts.ts getClientIp reads it.
-- The rest of the body is production's as of 27 Oct, unchanged. CREATE OR
-- REPLACE keeps the existing grants.
CREATE OR REPLACE FUNCTION public.validate_promo_code(p_business_id uuid, p_code text, p_order_amount numeric DEFAULT 0, p_customer_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_promo RECORD;
    v_email_used BOOLEAN;
    v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip text := coalesce(nullif(trim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''), nullif(v_headers ->> 'cf-connecting-ip', ''));
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' AND v_ip IS NOT NULL
       AND NOT public.check_rate_limit(v_ip, 'validate_promo_code', 30) THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Too many promo code attempts. Wait a minute, then try again.');
    END IF;

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
$function$;
