-- Remove one integration and its routing state in the same audited transaction.
CREATE OR REPLACE FUNCTION public.clear_sensitive_credentials_audited(
  p_business_id uuid,
  p_actor_id uuid,
  p_section text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor_business uuid;
BEGIN
  PERFORM public.assert_sensitive_settings_actor(p_actor_id, p_business_id);
  SELECT business_id INTO actor_business FROM public.admin_users WHERE id = p_actor_id;

  CASE p_section
    WHEN 'wa' THEN
      UPDATE public.businesses SET
        wa_token_encrypted = NULL,
        wa_phone_id_encrypted = NULL,
        wa_phone_id_lookup = NULL
      WHERE id = p_business_id;
    WHEN 'yoco' THEN
      UPDATE public.businesses SET
        yoco_secret_key_encrypted = NULL,
        yoco_webhook_secret_encrypted = NULL,
        yoco_webhook_status = NULL
      WHERE id = p_business_id;
    WHEN 'yoco_test' THEN
      -- Keep test mode unchanged so removal cannot enable live charges.
      UPDATE public.businesses SET
        yoco_test_secret_key_encrypted = NULL,
        yoco_test_webhook_secret_encrypted = NULL
      WHERE id = p_business_id;
    ELSE
      RAISE EXCEPTION 'Unknown protected credential section';
  END CASE;

  INSERT INTO public.audit_logs(actor_id, business_id, action_type, target_entity, target_id, after_state)
  VALUES (
    p_actor_id,
    p_business_id,
    'SENSITIVE_CREDENTIAL_CHANGED',
    'businesses',
    p_business_id,
    jsonb_build_object('outcome', 'success', 'section', p_section, 'operation', 'clear', 'assisted', actor_business IS DISTINCT FROM p_business_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.clear_sensitive_credentials_audited(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_sensitive_credentials_audited(uuid, uuid, text) TO service_role;
