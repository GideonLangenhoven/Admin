-- Add Paysafe credential columns to businesses table
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS paysafe_api_key_encrypted bytea,
  ADD COLUMN IF NOT EXISTS paysafe_api_secret_encrypted bytea,
  ADD COLUMN IF NOT EXISTS paysafe_account_id text,
  ADD COLUMN IF NOT EXISTS paysafe_linked_account_id text;
