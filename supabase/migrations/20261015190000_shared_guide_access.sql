BEGIN;
-- Guide identities deliberately never enter admin_users or its tenant grants.
CREATE TABLE public.guide_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES public.businesses(id),
  login_name text NOT NULL UNIQUE CHECK(login_name ~ '^guide@[a-z0-9][a-z0-9-]*$'),
  email text NOT NULL UNIQUE,
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  must_set_password boolean NOT NULL DEFAULT true,
  password_set_at timestamptz,
  suspended boolean NOT NULL DEFAULT false,
  setup_token_hash text,
  setup_token_expires_at timestamptz,
  setup_claim_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.guide_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guide_accounts FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,business_id,login_name,user_id) ON public.guide_accounts TO authenticated;
GRANT ALL ON public.guide_accounts TO service_role;
CREATE POLICY guide_self ON public.guide_accounts FOR SELECT TO authenticated
  USING(user_id=auth.uid() AND NOT suspended AND NOT must_set_password);

-- Never let a shared password acquire an office identity, including during setup.
CREATE FUNCTION public.protect_shared_guide_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.user_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('staff-identity:'||NEW.user_id::text,0)); END IF;
 IF TG_TABLE_NAME='admin_users' THEN
   IF lower(NEW.email) LIKE '%@guides.bookingtours.co.za' OR EXISTS(SELECT 1 FROM guide_accounts WHERE user_id=NEW.user_id) THEN
     RAISE EXCEPTION 'Shared guide identities cannot be office accounts' USING ERRCODE='42501'; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM admin_users WHERE user_id=NEW.user_id OR lower(email)=NEW.email) THEN
     RAISE EXCEPTION 'An office identity cannot be used for shared guide access' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_shared_guide_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER protect_shared_guide_identity BEFORE INSERT OR UPDATE OF user_id,email ON public.guide_accounts FOR EACH ROW EXECUTE FUNCTION public.protect_shared_guide_identity();
CREATE TRIGGER protect_office_identity BEFORE INSERT OR UPDATE OF user_id,email ON public.admin_users FOR EACH ROW EXECUTE FUNCTION public.protect_shared_guide_identity();

ALTER TABLE public.trip_photos ADD COLUMN uploaded_by_guide_id uuid REFERENCES public.guide_accounts(id) ON DELETE SET NULL;

CREATE FUNCTION public.current_guide_business() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT g.business_id FROM guide_accounts g JOIN businesses b ON b.id=g.business_id
 WHERE g.user_id=auth.uid() AND NOT g.suspended AND NOT g.must_set_password
 AND upper(b.subscription_status) IN ('ACTIVE','TRIAL','PAST_DUE')
$$;
REVOKE ALL ON FUNCTION public.current_guide_business() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guide_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid:=current_guide_business();
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'Guide access denied' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('id',id,'name',name,'business_name',business_name,'logo_url',logo_url,
   'timezone',timezone,'subscription_status',subscription_status,'subdomain',subdomain) FROM businesses WHERE id=target);
END $$;

CREATE FUNCTION public.guide_day(p_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid:=current_guide_business(); zone text; first_at timestamptz; last_at timestamptz;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'Guide access denied' USING ERRCODE='42501'; END IF;
 IF p_date IS NULL THEN RAISE EXCEPTION 'Choose a date'; END IF;
 SELECT timezone INTO zone FROM businesses WHERE id=target;
 first_at:=p_date::timestamp AT TIME ZONE zone; last_at:=(p_date+1)::timestamp AT TIME ZONE zone;
 RETURN (SELECT coalesce(jsonb_agg(item ORDER BY start_time,id),'[]'::jsonb) FROM (
   SELECT s.id,s.start_time,jsonb_build_object('id',s.id,'start_time',s.start_time,'tour_name',t.name,
    'pax_expected',coalesce(b.pax,0),'booking_count',coalesce(b.count,0),'photo_count',coalesce(p.count,0)) item
   FROM slots s JOIN tours t ON t.id=s.tour_id AND t.business_id=target
   LEFT JOIN LATERAL (SELECT sum(qty)::integer pax,count(*)::integer count FROM bookings
     WHERE business_id=target AND slot_id=s.id AND (status IN ('PAID','CONFIRMED','COMPLETED') OR
       (status IN ('PENDING','PENDING PAYMENT','HELD') AND (allow_unpaid OR payment_deadline IS NULL OR payment_deadline>now())))) b ON true
   LEFT JOIN LATERAL (SELECT count(*)::integer count FROM trip_photos WHERE business_id=target AND slot_id=s.id) p ON true
   WHERE s.business_id=target AND s.start_time>=first_at AND s.start_time<last_at
    AND s.status IS DISTINCT FROM 'CANCELLED' AND (b.pax>0 OR p.count>0)
 ) departures);
END $$;

CREATE FUNCTION public.guide_photos(p_slot_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid:=current_guide_business(); result jsonb;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'Guide access denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('slot',jsonb_build_object('tour_name',t.name,'start_time',s.start_time),
  'photos',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'photo_url',p.photo_url,'gdrive_view_url',p.gdrive_view_url,'uploaded_at',p.uploaded_at) ORDER BY p.uploaded_at DESC)
    FROM trip_photos p WHERE p.business_id=target AND p.slot_id=s.id),'[]'::jsonb)) INTO result
 FROM slots s JOIN tours t ON t.id=s.tour_id AND t.business_id=target WHERE s.id=p_slot_id AND s.business_id=target;
 IF result IS NULL THEN RAISE EXCEPTION 'Trip not found' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.guide_context(),public.guide_day(date),public.guide_photos(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.guide_context(),public.guide_day(date),public.guide_photos(uuid) TO authenticated;

CREATE FUNCTION public.claim_guide_setup(p_email text,p_token_hash text,p_claim_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE g guide_accounts%ROWTYPE;
BEGIN
 SELECT * INTO g FROM guide_accounts WHERE email=p_email AND setup_token_hash=p_token_hash
  AND setup_token_expires_at>now() AND NOT suspended FOR UPDATE;
 IF NOT FOUND OR g.setup_claim_id IS NOT NULL OR p_claim_id IS NULL THEN RETURN NULL; END IF;
 UPDATE guide_accounts SET setup_claim_id=p_claim_id WHERE id=g.id;
 RETURN jsonb_build_object('id',g.id,'email',g.email,'business_id',g.business_id,'user_id',g.user_id,'role','GUIDE');
END $$;
CREATE FUNCTION public.complete_guide_setup(p_id uuid,p_claim_id uuid,p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE guide_accounts g SET user_id=p_user_id,must_set_password=false,password_set_at=now(),
  setup_token_hash=NULL,setup_token_expires_at=NULL,setup_claim_id=NULL
 WHERE g.id=p_id AND g.setup_claim_id=p_claim_id AND NOT g.suspended AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user_id AND lower(u.email)=g.email);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_guide_setup(text,text,uuid),public.complete_guide_setup(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guide_setup(text,text,uuid),public.complete_guide_setup(uuid,uuid,uuid) TO service_role;
-- Shared guides upload through the tenant-checked photo API, never broad storage grants.
CREATE FUNCTION public.is_shared_guide() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM guide_accounts WHERE user_id=auth.uid())
$$;
REVOKE ALL ON FUNCTION public.is_shared_guide() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_shared_guide() TO authenticated;
CREATE POLICY guide_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(NOT public.is_shared_guide());
CREATE POLICY guide_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(NOT public.is_shared_guide()) WITH CHECK(NOT public.is_shared_guide());
CREATE POLICY guide_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(NOT public.is_shared_guide());
NOTIFY pgrst,'reload schema';
COMMIT;
