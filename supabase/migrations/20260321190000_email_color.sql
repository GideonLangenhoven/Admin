-- Add customisable email brand color (header/footer/buttons)
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS email_color text NOT NULL DEFAULT '#1b3b36';
