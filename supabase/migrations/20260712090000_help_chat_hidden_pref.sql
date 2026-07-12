-- Per-admin preference to hide the in-dashboard help assistant bubble.
-- Server-side (admin_users) so it follows the admin across devices, using the
-- same self-scoped RPC pattern as onboarding (20260711200000).
BEGIN;

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS help_chat_hidden boolean NOT NULL DEFAULT false;

-- Return type gains a column → must drop before recreate.
DROP FUNCTION IF EXISTS public.get_my_admin_onboarding();

CREATE FUNCTION public.get_my_admin_onboarding()
RETURNS TABLE (onboarding_completed_at timestamptz, help_chat_hidden boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.onboarding_completed_at, a.help_chat_hidden
  FROM public.admin_users a
  WHERE (a.user_id = auth.uid()
         OR (a.user_id IS NULL AND lower(a.email) = lower(auth.jwt() ->> 'email')))
    AND a.suspended IS NOT TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.set_my_help_chat_hidden(p_hidden boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.admin_users
  SET help_chat_hidden = COALESCE(p_hidden, false)
  WHERE (user_id = auth.uid()
         OR (user_id IS NULL AND lower(email) = lower(auth.jwt() ->> 'email')))
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_onboarding() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_help_chat_hidden(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_onboarding() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_help_chat_hidden(boolean) TO authenticated;

COMMIT;
