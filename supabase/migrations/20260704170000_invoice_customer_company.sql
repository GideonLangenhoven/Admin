-- Invoicing: let a customer booking on behalf of a company supply their own
-- company name + VAT number at checkout, so it appears on the tax invoice they
-- receive after payment (the "Billed To" block). Optional — null for individuals.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_company_name text,
  ADD COLUMN IF NOT EXISTS customer_vat_number text;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS customer_company_name text,
  ADD COLUMN IF NOT EXISTS customer_vat_number text;
