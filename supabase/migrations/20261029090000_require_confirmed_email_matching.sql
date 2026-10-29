-- S2: an email match only proves ownership when the address is confirmed.
-- Email confirmation is enforced today; if it were ever relaxed, anyone could register with a
-- guest's (or a not-yet-linked admin's) email and be matched to that row. These four SECURITY
-- DEFINER functions match an auth user to a row by email, so each now also requires
-- auth.users.email_confirmed_at. Signatures, attributes and grants are unchanged.

CREATE OR REPLACE FUNCTION public.link_customer_user()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN; END IF;

  UPDATE public.customers
  SET user_id = auth.uid(), updated_at = now()
  WHERE email_lower = lower(v_email)
    AND user_id IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_admin_onboarding()
 RETURNS TABLE(onboarding_completed_at timestamp with time zone, help_chat_hidden boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.onboarding_completed_at, a.help_chat_hidden
  FROM public.admin_users a
  WHERE (a.user_id = auth.uid()
         OR (a.user_id IS NULL AND lower(a.email) = lower(auth.jwt() ->> 'email')
             AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL)))
    AND a.suspended IS NOT TRUE
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.complete_my_admin_onboarding()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.admin_users
  SET onboarding_completed_at = now()
  WHERE (user_id = auth.uid()
         OR (user_id IS NULL AND lower(email) = lower(auth.jwt() ->> 'email')
             AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL)))
    AND onboarding_completed_at IS NULL
$function$;

CREATE OR REPLACE FUNCTION public.set_my_help_chat_hidden(p_hidden boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.admin_users
  SET help_chat_hidden = COALESCE(p_hidden, false)
  WHERE (user_id = auth.uid()
         OR (user_id IS NULL AND lower(email) = lower(auth.jwt() ->> 'email')
             AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL)))
$function$;
