-- Two fixes to the WhatsApp DELETE-keyword anonymization path:
--
-- 1. Collision bug: the phone-only path set EVERY matching customers row to the
--    same deterministic anon email (hash of phone+business). A subject with more
--    than one customers row (same phone tail) tripped the unique index
--    uq_customers_business_email (business_id, email_lower) -> the whole RPC rolled
--    back, so nothing was anonymized and no record was kept. Make the customers
--    anon email per-row-unique (append the row id, same trick already used for
--    conversations.phone). Only customers has a unique email index; bookings /
--    invoices / vouchers keep the shared v_anon_email marker.
--
-- 2. Visibility: the WA path called this RPC with p_request_id = NULL and never
--    created a data_subject_requests row, so the deletion never showed up in the
--    operator's POPIA Data Requests tab. When there is no pre-existing request
--    (p_request_id IS NULL), record a FULFILLED DELETION row so the operator sees
--    it. The email-driven admin flow passes a real p_request_id and is untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.anonymize_customer(
  p_customer_id uuid, p_business_id uuid, p_request_id uuid, p_admin_id uuid,
  p_email text DEFAULT NULL, p_phone text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_token text; v_anon_email text; v_orig_email text; v_orig_phone text; v_orig_tail text;
  v_counts jsonb := '{}'::jsonb; v_n int;
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT email, phone INTO v_orig_email, v_orig_phone FROM customers WHERE id = p_customer_id AND business_id = p_business_id;
  END IF;
  IF v_orig_email IS NULL THEN v_orig_email := p_email; END IF;
  IF v_orig_phone IS NULL THEN v_orig_phone := p_phone; END IF;
  v_orig_email := lower(coalesce(v_orig_email, ''));
  v_orig_tail := nullif(right(regexp_replace(coalesce(v_orig_phone, ''), '\D', '', 'g'), 9), '');
  -- md5 (built-in, no extension) — an opaque anonymization marker, not
  -- security-sensitive; pgcrypto's digest() is in the excluded extensions schema.
  v_token := 'deleted-' || substring(md5(coalesce(p_customer_id::text, nullif(v_orig_email, ''), v_orig_phone, '') || p_business_id::text) for 16);
  v_anon_email := v_token || '@anonymized.local';

  -- customers: per-row-unique email (id suffix) so multiple rows sharing a phone
  -- tail don't collide on uq_customers_business_email.
  IF p_customer_id IS NOT NULL THEN
    UPDATE customers SET email = v_token || '-' || id::text || '@anonymized.local', name = 'Deleted Customer', phone = NULL, marketing_consent = false, date_of_birth = NULL, notes = NULL, deleted_at = now(), updated_at = now() WHERE id = p_customer_id AND business_id = p_business_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('customers', v_n);
  ELSIF v_orig_tail IS NOT NULL THEN
    -- Phone-only entry (WA DELETE keyword): no customer_id known, match by tail.
    UPDATE customers SET email = v_token || '-' || id::text || '@anonymized.local', name = 'Deleted Customer', phone = NULL, marketing_consent = false, date_of_birth = NULL, notes = NULL, deleted_at = now(), updated_at = now()
    WHERE business_id = p_business_id AND right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) = v_orig_tail;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('customers', v_n);
  END IF;

  -- Before bookings' emails are overwritten below, use them to reach the
  -- email-keyed marketing_contacts rows for this phone number.
  IF v_orig_tail IS NOT NULL THEN
    DELETE FROM marketing_contacts mc USING bookings b
    WHERE mc.business_id = p_business_id AND b.business_id = p_business_id
      AND right(regexp_replace(coalesce(b.phone,''), '\D', '', 'g'), 9) = v_orig_tail
      AND lower(mc.email) = lower(coalesce(b.email, ''));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('marketing_contacts_by_phone', v_n);
  END IF;

  UPDATE bookings SET customer_name = 'Deleted Customer', email = v_anon_email, phone = NULL, customer_company_name = NULL, customer_vat_number = NULL, custom_fields = '{}'::jsonb, waiver_payload = jsonb_build_object('anonymized', true), waiver_signed_name = NULL
  WHERE business_id = p_business_id AND ((p_customer_id IS NOT NULL AND customer_id = p_customer_id) OR (v_orig_email <> '' AND lower(email) = v_orig_email) OR (v_orig_tail IS NOT NULL AND right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) = v_orig_tail));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('bookings', v_n);

  UPDATE invoices SET customer_name = 'Deleted Customer', customer_email = v_anon_email, customer_phone = NULL, customer_company_name = NULL, customer_vat_number = NULL
  WHERE business_id = p_business_id AND ((v_orig_email <> '' AND lower(customer_email) = v_orig_email) OR (v_orig_tail IS NOT NULL AND right(regexp_replace(coalesce(customer_phone,''), '\D', '', 'g'), 9) = v_orig_tail) OR booking_id IN (SELECT id FROM bookings WHERE business_id = p_business_id AND email = v_anon_email));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('invoices', v_n);

  UPDATE vouchers SET buyer_name = NULL, buyer_email = NULL, buyer_phone = NULL, recipient_name = NULL, recipient_email = NULL, gift_message = NULL
  WHERE business_id = p_business_id AND ((v_orig_email <> '' AND (lower(buyer_email) = v_orig_email OR lower(recipient_email) = v_orig_email)) OR (v_orig_tail IS NOT NULL AND right(regexp_replace(coalesce(buyer_phone,''), '\D', '', 'g'), 9) = v_orig_tail));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('vouchers', v_n);

  -- Per-row id suffix keeps (business_id, phone) unique when the subject has
  -- multiple conversation rows; re-running sets the same value (idempotent).
  UPDATE conversations SET phone = v_token || '-' || id::text, customer_name = 'Deleted Customer', email = NULL, state_data = '{}'::jsonb, updated_at = now()
  WHERE business_id = p_business_id AND ((v_orig_tail IS NOT NULL AND right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) = v_orig_tail) OR (v_orig_email <> '' AND lower(email) = v_orig_email));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('conversations', v_n);

  IF v_orig_tail IS NOT NULL THEN
    UPDATE chat_messages SET phone = v_token, body = '[redacted]', sender = 'Deleted Customer' WHERE business_id = p_business_id AND right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) = v_orig_tail;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('chat_messages', v_n);
    UPDATE wa_messages SET to_phone = v_token, body = '[redacted]' WHERE business_id = p_business_id AND right(regexp_replace(coalesce(to_phone,''), '\D', '', 'g'), 9) = v_orig_tail;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('wa_messages', v_n);
  END IF;

  IF v_orig_email <> '' THEN
    DELETE FROM marketing_contacts WHERE business_id = p_business_id AND lower(email) = v_orig_email;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('marketing_contacts', v_n);
  END IF;

  INSERT INTO pii_anonymization_log (business_id, request_id, customer_id, anonymized_token, affected_tables, performed_by) VALUES (p_business_id, p_request_id, p_customer_id, v_token, v_counts, p_admin_id);
  INSERT INTO audit_logs (business_id, actor_id, action_type, target_entity, target_id, after_state) VALUES (p_business_id, p_admin_id, 'POPIA_ANONYMIZE', 'customers', p_customer_id, v_counts);

  -- No pre-existing request (WA DELETE keyword / direct call): record a FULFILLED
  -- DELETION request so the operator sees it in the POPIA Data Requests tab.
  IF p_request_id IS NULL THEN
    INSERT INTO data_subject_requests (business_id, customer_id, email, request_type, status, reason, confirmed_at, fulfilled_at, metadata)
    VALUES (
      p_business_id, p_customer_id,
      coalesce(nullif(v_orig_email, ''), 'wa:' || coalesce(v_orig_phone, 'unknown')),
      'DELETION', 'FULFILLED',
      'Requested via WhatsApp DELETE keyword', now(), now(),
      jsonb_build_object('source', CASE WHEN p_phone IS NOT NULL THEN 'whatsapp_delete_keyword' ELSE 'direct' END, 'phone', v_orig_phone, 'affected', v_counts)
    );
  END IF;

  RETURN v_counts;
END;
$function$;

REVOKE ALL ON FUNCTION public.anonymize_customer(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_customer(uuid, uuid, uuid, uuid, text, text) TO service_role;

COMMIT;
