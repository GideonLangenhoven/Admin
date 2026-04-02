-- Update defaults: 20 free marketing emails, R0.10 per overage email
ALTER TABLE public.businesses
  ALTER COLUMN marketing_included_emails SET DEFAULT 20;
ALTER TABLE public.businesses
  ALTER COLUMN marketing_overage_rate_zar SET DEFAULT 0.10;

-- Update all existing businesses to the new defaults
UPDATE public.businesses
SET marketing_included_emails = 20,
    marketing_overage_rate_zar = 0.10
WHERE marketing_included_emails = 500
   OR marketing_overage_rate_zar = 0.15;
