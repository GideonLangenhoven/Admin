-- List Cleaning: add 'inactive' status and last_email_at tracking

-- 1. Expand status CHECK to include 'inactive'
-- Need to drop and recreate the constraint
ALTER TABLE public.marketing_contacts DROP CONSTRAINT IF EXISTS marketing_contacts_status_check;
ALTER TABLE public.marketing_contacts ADD CONSTRAINT marketing_contacts_status_check
  CHECK (status IN ('active', 'unsubscribed', 'bounced', 'inactive'));

-- 2. Add last_email_at for tracking when we last sent to a contact
ALTER TABLE public.marketing_contacts ADD COLUMN IF NOT EXISTS last_email_at timestamptz;
