-- Fix: drop ambiguous 5-param overload of validate_promo_code
-- Two overloads existed: (uuid, text, numeric, text) and (uuid, text, numeric, text, text).
-- Calling with 4 args caused PostgreSQL error 42725 "function is not unique",
-- breaking promo code application on booking detail page.
DROP FUNCTION IF EXISTS public.validate_promo_code(uuid, text, numeric, text, text);
GRANT EXECUTE ON FUNCTION public.validate_promo_code(uuid, text, numeric, text) TO anon, authenticated;
