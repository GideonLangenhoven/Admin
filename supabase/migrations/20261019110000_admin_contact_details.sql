BEGIN;

ALTER TABLE public.admin_users ADD COLUMN phone text CHECK (length(phone) <= 40);

-- Auth owns a linked account's email. Its transaction also updates the admin
-- row, so a failed profile write cannot leave two different login addresses.
CREATE FUNCTION public.sync_admin_auth_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.admin_users SET email = lower(trim(NEW.email)) WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_admin_auth_email() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sync_admin_auth_email AFTER UPDATE OF email ON auth.users
FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.sync_admin_auth_email();

CREATE FUNCTION public.guard_admin_contact_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  PERFORM pg_advisory_xact_lock(hashtextextended('admin-email:' || NEW.email, 0));
  IF EXISTS (SELECT 1 FROM public.admin_users WHERE lower(email) = NEW.email AND id <> NEW.id) THEN
    RAISE EXCEPTION 'Email already belongs to another administrator' USING ERRCODE = '23505';
  END IF;
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = NEW.user_id AND lower(email) = NEW.email
  ) THEN
    RAISE EXCEPTION 'Change the sign-in email through account management' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.email IS DISTINCT FROM NEW.email THEN
    IF NEW.user_id IS NULL AND EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = NEW.email) THEN
      RAISE EXCEPTION 'Email already belongs to another sign-in account' USING ERRCODE = '23505';
    END IF;
    IF OLD.setup_token_claim_id IS NOT NULL AND OLD.setup_token_claimed_at > now() - interval '5 minutes' THEN
      RAISE EXCEPTION 'Password setup is in progress. Try again in a few minutes.' USING ERRCODE = '55000';
    END IF;
    NEW.setup_token_hash := NULL;
    NEW.setup_token_hash_used := NULL;
    NEW.setup_token_expires_at := NULL;
    NEW.setup_token_claim_id := NULL;
    NEW.setup_token_claimed_at := NULL;
    NEW.invite_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_admin_contact_email() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_admin_contact_email BEFORE INSERT OR UPDATE OF email, user_id ON public.admin_users
FOR EACH ROW EXECUTE FUNCTION public.guard_admin_contact_email();

NOTIFY pgrst, 'reload schema';
COMMIT;
