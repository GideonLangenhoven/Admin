-- RPC for super admins to list all businesses (bypasses RLS)
-- Checks that the caller is a SUPER_ADMIN before returning data
CREATE OR REPLACE FUNCTION public.list_all_businesses()
RETURNS TABLE (
  id uuid,
  business_name text,
  max_admin_seats int,
  marketing_included_emails int,
  marketing_overage_rate_zar numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is a super admin
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.id = auth.uid()
      AND admin_users.role IN ('SUPER_ADMIN', 'MAIN_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Access denied: not a super admin';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.business_name,
    b.max_admin_seats,
    b.marketing_included_emails,
    b.marketing_overage_rate_zar
  FROM public.businesses b
  ORDER BY b.business_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_all_businesses TO authenticated;

-- RPC to update seat limit for any business (super admin only)
CREATE OR REPLACE FUNCTION public.set_business_admin_seats(
  p_business_id uuid,
  p_max_seats int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.id = auth.uid()
      AND admin_users.role IN ('SUPER_ADMIN', 'MAIN_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.businesses
  SET max_admin_seats = GREATEST(1, p_max_seats)
  WHERE id = p_business_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_business_admin_seats TO authenticated;

-- RPC to update email rate for any business (super admin only)
CREATE OR REPLACE FUNCTION public.set_business_email_rate(
  p_business_id uuid,
  p_rate numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE admin_users.id = auth.uid()
      AND admin_users.role IN ('SUPER_ADMIN', 'MAIN_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.businesses
  SET marketing_overage_rate_zar = GREATEST(0, p_rate)
  WHERE id = p_business_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_business_email_rate TO authenticated;
