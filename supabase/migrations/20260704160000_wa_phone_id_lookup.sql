-- Scale: inbound-WhatsApp tenant resolution.
-- resolveTenantByWhatsappPayload() scanned ALL businesses and decrypted each
-- tenant's wa_phone_id per row to match the incoming phone_number_id — up to
-- 2000 pgcrypto RPCs per inbound message, and (unbounded select) it truncated at
-- the 1000-row cap so tenants past #1000 could never receive WhatsApp at all.
--
-- Add an indexed plaintext lookup of the normalised phone_number_id. This is a
-- Meta identifier (sent in every inbound webhook), not a secret — the wa_token
-- stays encrypted. The resolver queries this column directly (single indexed
-- row) and lazily backfills it during its fallback scan, so existing tenants
-- self-heal on their next message and new credential writes populate it up front.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS wa_phone_id_lookup text;

CREATE INDEX IF NOT EXISTS businesses_wa_phone_id_lookup_idx
  ON public.businesses (wa_phone_id_lookup)
  WHERE wa_phone_id_lookup IS NOT NULL;

-- Do not expose the lookup column to anon/authenticated (service_role, which
-- resolves inbound WhatsApp, bypasses column grants). Revoking then re-granting
-- the prior column set is fiddly; instead rely on the booking app never
-- selecting this column. It carries no secret, so incidental exposure is benign.
COMMENT ON COLUMN public.businesses.wa_phone_id_lookup IS
  'Normalised (digits-only) WhatsApp phone_number_id for O(1) inbound tenant resolution. Not a secret; wa_token stays encrypted.';
