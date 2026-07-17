-- Platform invoices previously billed only plan base + extra seats; the
-- marketing email overage (emails_sent beyond marketing_included_emails at
-- marketing_overage_rate_zar) was shown on the tenant's billing page but
-- never invoiced. Store the overage line so the invoice email can show the
-- breakdown and amount_zar can include it.
BEGIN;

ALTER TABLE public.platform_invoices
  ADD COLUMN IF NOT EXISTS email_overage_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_overage_zar numeric NOT NULL DEFAULT 0;

COMMIT;
