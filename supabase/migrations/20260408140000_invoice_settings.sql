-- Add invoice company details and banking details to businesses table
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS invoice_company_name text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS invoice_address_line1 text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS invoice_address_line2 text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS invoice_address_line3 text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS invoice_reg_number text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS invoice_vat_number text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS bank_account_owner text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS bank_account_number text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS bank_account_type text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS bank_branch_code text;
