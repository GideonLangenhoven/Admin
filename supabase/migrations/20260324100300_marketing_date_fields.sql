-- Date fields for contacts: birthday/anniversary triggers + voucher generation support

-- 1. Add date fields to marketing_contacts
ALTER TABLE public.marketing_contacts ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.marketing_contacts ADD COLUMN IF NOT EXISTS anniversary_date date;

-- 2. Indexes for date-based trigger queries (month+day matching)
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_dob
  ON public.marketing_contacts (business_id, date_of_birth)
  WHERE date_of_birth IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_contacts_anniversary
  ON public.marketing_contacts (business_id, anniversary_date)
  WHERE anniversary_date IS NOT NULL;
