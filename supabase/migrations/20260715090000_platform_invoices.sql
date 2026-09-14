-- Platform billing: BookingTours -> operator monthly invoices, plus a
-- singleton table for BookingTours' own logo + banking details.
-- Both tables are service-role-only (superadmin API routes use the
-- service-role key) — RLS enabled with zero policies denies anon/
-- authenticated by default; service_role bypasses RLS entirely.

BEGIN;

-- ── platform_invoices ──
CREATE TABLE public.platform_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_number        text NOT NULL UNIQUE,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  plan_id               text NOT NULL,
  plan_name             text NOT NULL,
  monthly_price_zar     integer NOT NULL,
  active_days           integer NOT NULL,
  total_days            integer NOT NULL,
  pro_rated             boolean NOT NULL DEFAULT false,
  pause_note            text,
  amount_zar            numeric NOT NULL,
  status                text NOT NULL DEFAULT 'DRAFT',
  yoco_checkout_id      text,
  yoco_payment_link_url text,
  yoco_payment_id       text,
  paid_at               timestamptz,
  paid_method           text,
  paid_notes            text,
  sent_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, period_start),
  CONSTRAINT platform_invoices_status_check
    CHECK (status IN ('DRAFT', 'SENT', 'PAID', 'PAID_MANUALLY', 'VOID')),
  CONSTRAINT platform_invoices_paid_method_check
    CHECK (paid_method IS NULL OR paid_method IN ('YOCO', 'MANUAL', 'EFT', 'OTHER'))
);

CREATE INDEX idx_platform_invoices_business ON public.platform_invoices (business_id, period_start DESC);

CREATE SEQUENCE public.platform_invoice_seq;

ALTER TABLE public.platform_invoices ALTER COLUMN invoice_number SET DEFAULT
  'BT-' || to_char(now(), 'YYYY-MM') || '-' || lpad(nextval('public.platform_invoice_seq')::text, 4, '0');

ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_invoices FROM anon, authenticated;
GRANT ALL ON public.platform_invoices TO service_role;
REVOKE ALL ON SEQUENCE public.platform_invoice_seq FROM anon, authenticated;
GRANT USAGE ON SEQUENCE public.platform_invoice_seq TO service_role;

-- ── platform_settings (singleton) ──
CREATE TABLE public.platform_settings (
  id                             boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  logo_url                       text,
  bank_account_owner_encrypted   bytea,
  bank_account_number_encrypted  bytea,
  bank_account_type_encrypted    bytea,
  bank_name_encrypted            bytea,
  bank_branch_code_encrypted     bytea,
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_settings (id) VALUES (true);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_settings FROM anon, authenticated;
GRANT ALL ON public.platform_settings TO service_role;

-- ── RPC: decrypt and return BookingTours' own bank details (singleton, no business_id) ──
CREATE OR REPLACE FUNCTION public.get_platform_bank_details(
  p_key text
)
RETURNS TABLE (
  account_owner  text,
  account_number text,
  account_type   text,
  bank_name      text,
  branch_code    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    app_private.decrypt_secret(s.bank_account_owner_encrypted, p_key),
    app_private.decrypt_secret(s.bank_account_number_encrypted, p_key),
    app_private.decrypt_secret(s.bank_account_type_encrypted, p_key),
    app_private.decrypt_secret(s.bank_name_encrypted, p_key),
    app_private.decrypt_secret(s.bank_branch_code_encrypted, p_key)
  FROM public.platform_settings s
  WHERE s.id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_bank_details(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_bank_details(text) TO service_role;

-- ── RPC: encrypt and store BookingTours' own bank details ──
CREATE OR REPLACE FUNCTION public.set_platform_bank_details(
  p_key            text,
  p_account_owner  text DEFAULT NULL,
  p_account_number text DEFAULT NULL,
  p_account_type   text DEFAULT NULL,
  p_bank_name      text DEFAULT NULL,
  p_branch_code    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  UPDATE public.platform_settings
  SET
    bank_account_owner_encrypted  = CASE WHEN p_account_owner  IS NOT NULL THEN app_private.encrypt_secret(p_account_owner,  p_key) ELSE NULL END,
    bank_account_number_encrypted = CASE WHEN p_account_number IS NOT NULL THEN app_private.encrypt_secret(p_account_number, p_key) ELSE NULL END,
    bank_account_type_encrypted   = CASE WHEN p_account_type   IS NOT NULL THEN app_private.encrypt_secret(p_account_type,   p_key) ELSE NULL END,
    bank_name_encrypted           = CASE WHEN p_bank_name      IS NOT NULL THEN app_private.encrypt_secret(p_bank_name,      p_key) ELSE NULL END,
    bank_branch_code_encrypted    = CASE WHEN p_branch_code    IS NOT NULL THEN app_private.encrypt_secret(p_branch_code,    p_key) ELSE NULL END,
    updated_at = now()
  WHERE id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_platform_bank_details(text, text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_bank_details(text, text, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
