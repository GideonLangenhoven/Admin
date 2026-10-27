BEGIN;
ALTER TABLE marketing_automations ADD COLUMN revision integer NOT NULL DEFAULT 0;
CREATE TABLE marketing_automation_revisions (
 automation_id uuid NOT NULL, business_id uuid NOT NULL, revision integer NOT NULL,
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by uuid,
 PRIMARY KEY(automation_id,revision),
 FOREIGN KEY(automation_id,business_id) REFERENCES marketing_automations(id,business_id)
);
ALTER TABLE marketing_automation_revisions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON marketing_automation_revisions TO authenticated,service_role;
CREATE POLICY revision_own ON marketing_automation_revisions FOR SELECT TO authenticated USING(business_id=ANY((SELECT current_business_ids())::uuid[]));
CREATE POLICY revision_service ON marketing_automation_revisions FOR SELECT TO service_role USING(true);
-- Empty on rollout. A later, separately approved operator decision supplies
-- limits for one immutable revision. No automatic discounts or approval backfill.
CREATE TABLE marketing_offer_limits (
 business_id uuid NOT NULL, automation_id uuid NOT NULL, revision integer NOT NULL,
 max_voucher_zar numeric NOT NULL CHECK(max_voucher_zar>=0),
 max_discount_percent numeric NOT NULL CHECK(max_discount_percent BETWEEN 0 AND 100),
 max_flat_promo_zar numeric NOT NULL CHECK(max_flat_promo_zar>=0),
 max_valid_days integer NOT NULL CHECK(max_valid_days BETWEEN 1 AND 365),
 max_uses integer NOT NULL CHECK(max_uses BETWEEN 1 AND 100),
 approved_by uuid NOT NULL REFERENCES admin_users(id), approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(automation_id,revision),
 FOREIGN KEY(automation_id,revision) REFERENCES marketing_automation_revisions(automation_id,revision),
 FOREIGN KEY(automation_id,business_id) REFERENCES marketing_automations(id,business_id)
);
ALTER TABLE marketing_offer_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketing_offer_limits FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON marketing_offer_limits TO service_role;
CREATE POLICY offer_limits_service ON marketing_offer_limits FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE TRIGGER offer_limits_immutable BEFORE UPDATE OR DELETE ON marketing_offer_limits FOR EACH ROW EXECUTE FUNCTION marketing_permission_immutable();
CREATE FUNCTION marketing_offer_allowed(p_business_id uuid,p_automation_id uuid,p_step_type text,p_config jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE limits marketing_offer_limits%ROWTYPE;
BEGIN
 SELECT l.* INTO limits FROM marketing_offer_limits l JOIN marketing_automations a ON a.id=l.automation_id AND a.business_id=l.business_id AND a.revision=l.revision
   JOIN admin_users owner ON owner.id=l.approved_by AND NOT owner.suspended AND NOT coalesce(owner.read_only,false)
   AND (owner.role='SUPER_ADMIN' OR (owner.role='MAIN_ADMIN' AND owner.business_id=l.business_id))
   WHERE l.automation_id=p_automation_id AND l.business_id=p_business_id;
 IF NOT FOUND OR nullif(btrim(p_config->>'code_prefix'),'') IS NULL OR
   NOT coalesce((p_config->>'valid_days')::integer BETWEEN 1 AND limits.max_valid_days,false) THEN RETURN false; END IF;
 IF p_step_type='generate_voucher' THEN
   RETURN coalesce(p_config->>'voucher_type'='fixed_amount' AND (p_config->>'amount')::numeric>0 AND (p_config->>'amount')::numeric<=limits.max_voucher_zar,false);
 ELSIF p_step_type='generate_promo' THEN
   RETURN coalesce((p_config->>'max_uses')::integer BETWEEN 1 AND limits.max_uses AND (p_config->>'discount_value')::numeric>0 AND
     ((p_config->>'discount_type'='PERCENT' AND (p_config->>'discount_value')::numeric<=limits.max_discount_percent) OR
      (p_config->>'discount_type'='FLAT' AND (p_config->>'discount_value')::numeric<=limits.max_flat_promo_zar)),false);
 END IF;
 RETURN false;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION marketing_offer_allowed(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION marketing_offer_allowed(uuid,uuid,text,jsonb) TO service_role;

CREATE FUNCTION marketing_assert_editor(p_business_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF auth.role()='service_role' THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM admin_users WHERE user_id=auth.uid() AND NOT suspended AND NOT coalesce(read_only,false)
   AND (role='SUPER_ADMIN' OR (role='MAIN_ADMIN' AND business_id=p_business_id))) THEN
   RAISE EXCEPTION 'Marketing changes require the operator owner' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION marketing_revision_templates(p_business_id uuid,p_steps jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_object_agg(t.id::text,jsonb_build_object('subject_line',t.subject_line,'html_content',t.html_content)),'{}')
 FROM marketing_templates t WHERE t.business_id=p_business_id AND t.id IN (
  SELECT nullif(s->'config'->>'template_id','')::uuid FROM jsonb_array_elements(p_steps) s WHERE s->>'step_type'='send_email');
$$;
REVOKE ALL ON FUNCTION marketing_revision_templates(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION save_marketing_draft(p_business_id uuid,p_id uuid,p_expected_revision integer,p_automation jsonb,p_steps jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a marketing_automations%ROWTYPE; s jsonb; idx integer:=0; snap jsonb; templates jsonb;
BEGIN
 PERFORM marketing_assert_editor(p_business_id);
 IF nullif(btrim(p_automation->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Name required'; END IF;
 IF jsonb_typeof(p_steps) IS DISTINCT FROM 'array' OR jsonb_array_length(p_steps)>100 THEN RAISE EXCEPTION 'Invalid steps'; END IF;
 templates:=marketing_revision_templates(p_business_id,p_steps);
 IF p_id IS NULL THEN
   INSERT INTO marketing_automations(business_id,name,description,trigger_type,trigger_config,status)
   VALUES(p_business_id,p_automation->>'name',p_automation->>'description',p_automation->>'trigger_type',coalesce(p_automation->'trigger_config','{}'),'draft') RETURNING * INTO a;
 ELSE
   SELECT * INTO a FROM marketing_automations WHERE id=p_id AND business_id=p_business_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found'; END IF;
   IF a.revision<>p_expected_revision THEN RAISE EXCEPTION 'Draft changed elsewhere. Reload before saving.'; END IF;
   IF a.revision>0 AND templates=(SELECT snapshot->'templates' FROM marketing_automation_revisions WHERE automation_id=a.id AND revision=a.revision) AND (a.name,a.description,a.trigger_type,a.trigger_config) IS NOT DISTINCT FROM
      (p_automation->>'name',p_automation->>'description',p_automation->>'trigger_type',coalesce(p_automation->'trigger_config','{}'))
      AND p_steps=(SELECT coalesce(jsonb_agg(jsonb_build_object('step_type',step_type,'config',config) ORDER BY position),'[]') FROM marketing_automation_steps WHERE automation_id=a.id AND business_id=p_business_id) THEN
     RETURN jsonb_build_object('id',a.id,'revision',a.revision);
   END IF;
   IF a.status='active' OR EXISTS(SELECT 1 FROM marketing_automation_enrollments WHERE automation_id=a.id AND status='active') THEN
     RAISE EXCEPTION 'This revision has active enrollments. Create a separate draft to change its steps.'; END IF;
   UPDATE marketing_automations SET name=p_automation->>'name',description=p_automation->>'description',
    trigger_type=p_automation->>'trigger_type',trigger_config=coalesce(p_automation->'trigger_config','{}'),updated_at=now()
    WHERE id=a.id;
 END IF;
 DELETE FROM marketing_automation_steps WHERE automation_id=a.id AND business_id=p_business_id;
 FOR s IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
   INSERT INTO marketing_automation_steps(automation_id,business_id,position,step_type,config)
   VALUES(a.id,p_business_id,idx,s->>'step_type',coalesce(s->'config','{}'));
   idx:=idx+1;
 END LOOP;
 UPDATE marketing_automations SET revision=revision+1 WHERE id=a.id RETURNING * INTO a;
 snap:=jsonb_build_object('automation',to_jsonb(a),'steps',p_steps,'templates',templates,'contract_version',1);
 INSERT INTO marketing_automation_revisions VALUES(a.id,p_business_id,a.revision,snap,clock_timestamp(),auth.uid());
 RETURN jsonb_build_object('id',a.id,'revision',a.revision);
END $$;

CREATE TABLE marketing_journey_status_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 automation_id uuid NOT NULL, business_id uuid NOT NULL, previous_status text, next_status text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), actor_id uuid,
 FOREIGN KEY(automation_id,business_id) REFERENCES marketing_automations(id,business_id)
);
ALTER TABLE marketing_journey_status_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON marketing_journey_status_events TO authenticated,service_role;
CREATE POLICY journey_status_own ON marketing_journey_status_events FOR SELECT TO authenticated USING(business_id=ANY((SELECT current_business_ids())::uuid[]));
CREATE POLICY journey_status_service ON marketing_journey_status_events FOR SELECT TO service_role USING(true);
CREATE TRIGGER journey_status_immutable BEFORE UPDATE OR DELETE ON marketing_journey_status_events FOR EACH ROW EXECUTE FUNCTION marketing_permission_immutable();
CREATE FUNCTION marketing_record_journey_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO marketing_journey_status_events(automation_id,business_id,previous_status,next_status,actor_id)
   VALUES(NEW.id,NEW.business_id,CASE WHEN TG_OP='UPDATE' THEN OLD.status END,NEW.status,auth.uid());
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marketing_record_journey_status() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER marketing_journey_status AFTER INSERT OR UPDATE OF status ON marketing_automations FOR EACH ROW EXECUTE FUNCTION marketing_record_journey_status();

CREATE FUNCTION marketing_guard_active_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE aid uuid; a marketing_automations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='marketing_automation_steps' THEN
   aid:=CASE WHEN TG_OP='DELETE' THEN OLD.automation_id ELSE NEW.automation_id END;
   SELECT * INTO a FROM marketing_automations WHERE id=aid FOR UPDATE;
   IF TG_OP='UPDATE' AND NEW.automation_id IS DISTINCT FROM OLD.automation_id AND EXISTS(
     SELECT 1 FROM marketing_automations prior WHERE prior.id=OLD.automation_id AND (prior.status='active' OR EXISTS(
       SELECT 1 FROM marketing_automation_enrollments WHERE automation_id=prior.id AND status='active'))) THEN
     RAISE EXCEPTION 'Active enrollment steps cannot be moved'; END IF;
   IF a.status='active' OR EXISTS(SELECT 1 FROM marketing_automation_enrollments WHERE automation_id=aid AND status='active') THEN
     RAISE EXCEPTION 'Active enrollment revisions cannot be edited'; END IF;
 ELSE
   IF TG_OP='INSERT' THEN
     IF NEW.status='active' THEN RAISE EXCEPTION 'Create a draft before activation'; END IF;
     RETURN NEW;
   END IF;
   a:=OLD;
   IF TG_OP='UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN RAISE EXCEPTION 'Journey tenant cannot change'; END IF;
   IF TG_OP='DELETE' AND a.id='5bb1d74b-8634-4fec-9c42-f6f13cc1c33f' THEN RAISE EXCEPTION 'Review draft deletion is not approved'; END IF;
   IF TG_OP='UPDATE' THEN
     IF (a.status='active' OR EXISTS(SELECT 1 FROM marketing_automation_enrollments WHERE automation_id=a.id AND status='active')) AND
       (NEW.name,NEW.description,NEW.trigger_type,NEW.trigger_config) IS DISTINCT FROM (OLD.name,OLD.description,OLD.trigger_type,OLD.trigger_config) THEN
       RAISE EXCEPTION 'Active enrollment revisions cannot be edited'; END IF;
     IF NEW.status='active' AND OLD.status IS DISTINCT FROM 'active' THEN
       PERFORM marketing_assert_editor(NEW.business_id);
       IF NOT EXISTS(SELECT 1 FROM marketing_automation_revisions r WHERE r.automation_id=NEW.id AND r.revision=NEW.revision
         AND (r.snapshot->'automation'->>'name',r.snapshot->'automation'->>'description',r.snapshot->'automation'->>'trigger_type',r.snapshot->'automation'->'trigger_config') IS NOT DISTINCT FROM
             (NEW.name,NEW.description,NEW.trigger_type,NEW.trigger_config)
         AND r.snapshot->'steps'=(SELECT coalesce(jsonb_agg(jsonb_build_object('step_type',step_type,'config',config) ORDER BY position),'[]') FROM marketing_automation_steps WHERE automation_id=NEW.id AND business_id=NEW.business_id)
         AND r.snapshot->'templates'=marketing_revision_templates(NEW.business_id,r.snapshot->'steps')) THEN
         RAISE EXCEPTION 'Save and review the current content before activation';
       END IF;
       IF NEW.revision<1 OR NOT EXISTS(SELECT 1 FROM marketing_automation_revisions WHERE automation_id=NEW.id AND revision=NEW.revision) OR NOT EXISTS(SELECT 1 FROM marketing_automation_steps WHERE automation_id=NEW.id AND step_type='send_email') THEN
         RAISE EXCEPTION 'Save and review a valid revision before activation'; END IF;
       IF EXISTS(SELECT 1 FROM marketing_automation_steps WHERE automation_id=NEW.id AND
         ((step_type IN ('generate_voucher','generate_promo') AND NOT marketing_offer_allowed(NEW.business_id,NEW.id,step_type,config)) OR
          (step_type='send_email' AND NOT EXISTS(SELECT 1 FROM marketing_templates t WHERE t.id=template_id AND t.business_id=NEW.business_id AND length(btrim(t.html_content))>0)) OR
          (step_type='delay' AND (CASE WHEN coalesce(config->>'duration','') ~ '^[0-9]+([.][0-9]+)?$' THEN (config->>'duration')::numeric<=0 ELSE true END OR coalesce(config->>'unit','') NOT IN ('minutes','hours','days'))) OR
          (step_type='condition' AND coalesce(config->>'condition_type','') NOT IN ('has_tag','opened_email','clicked_link')))) THEN
          RAISE EXCEPTION 'Missing content or unsupported step. Voucher/promo issuance requires separately approved limits.'; END IF;
       IF NEW.trigger_type='tag_added' AND NEW.trigger_config->>'tag'='completed-tour' AND EXISTS(
          SELECT 1 FROM marketing_automation_steps WHERE automation_id=NEW.id AND step_type='condition' AND config->>'condition_type'='opened_email') THEN
          RAISE EXCEPTION 'Review invitations cannot depend on email opens. Review completion is unavailable.'; END IF;
       IF NOT EXISTS(SELECT 1 FROM marketing_contacts c WHERE c.business_id=NEW.business_id AND marketing_eligibility(NEW.business_id,c.id)='eligible') THEN
          RAISE EXCEPTION 'No contacts have verified email-marketing permission. Approve the collection notice and evidence first.'; END IF;
     END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER marketing_guard_automation BEFORE INSERT OR UPDATE OR DELETE ON marketing_automations FOR EACH ROW EXECUTE FUNCTION marketing_guard_active_revision();
CREATE TRIGGER marketing_guard_steps BEFORE INSERT OR UPDATE OR DELETE ON marketing_automation_steps FOR EACH ROW EXECUTE FUNCTION marketing_guard_active_revision();
CREATE TRIGGER marketing_revision_immutable BEFORE UPDATE OR DELETE ON marketing_automation_revisions FOR EACH ROW EXECUTE FUNCTION marketing_permission_immutable();
CREATE FUNCTION marketing_protect_active_template() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a marketing_automations%ROWTYPE;
BEGIN
 FOR a IN SELECT auto.* FROM marketing_automations auto WHERE EXISTS(
   SELECT 1 FROM marketing_automation_steps s WHERE s.automation_id=auto.id AND s.business_id=auto.business_id AND s.template_id=OLD.id AND s.business_id=OLD.business_id)
   FOR UPDATE LOOP
  IF a.status='active' OR EXISTS(SELECT 1 FROM marketing_automation_enrollments WHERE automation_id=a.id AND status='active') THEN
    RAISE EXCEPTION 'This email belongs to an active revision. Create a new template and draft.';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION marketing_protect_active_template() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER marketing_protect_template BEFORE UPDATE OR DELETE ON marketing_templates FOR EACH ROW EXECUTE FUNCTION marketing_protect_active_template();

REVOKE ALL ON FUNCTION marketing_assert_editor(uuid),marketing_guard_active_revision(),save_marketing_draft(uuid,uuid,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION save_marketing_draft(uuid,uuid,integer,jsonb,jsonb) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
