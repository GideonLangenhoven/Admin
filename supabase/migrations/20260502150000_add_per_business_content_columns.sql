-- Prompt 23: Add per-business content columns for multi-tenant email/chat.
-- Pre-flight confirmed: what_to_bring, activity_verb_past, location_phrase,
-- footer_line_one, footer_line_two, social_google_reviews ALREADY EXIST.
-- Only adding: meeting_point_address, arrival_instructions, business_address.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS meeting_point_address text,
  ADD COLUMN IF NOT EXISTS arrival_instructions  text,
  ADD COLUMN IF NOT EXISTS business_address      text;

-- Grant anon SELECT on the 3 new columns (mirrors column-grant pattern from Prompts 10/15).
GRANT SELECT (meeting_point_address, arrival_instructions, business_address)
  ON public.businesses TO anon;

-- Seed Cape Kayak (MarineTours) with the values currently hardcoded in edge functions.
-- COALESCE preserves existing values (what_to_bring already populated).
UPDATE public.businesses
SET
  social_google_reviews = COALESCE(social_google_reviews, 'https://search.google.com/local/writereview?placeid=ChIJ9a9I09RHzB0Rh9R8O4pM7aQ'),
  meeting_point_address = '180 Beach Rd, Three Anchor Bay',
  arrival_instructions  = 'Please arrive 15 minutes before launch.',
  business_address      = 'Three Anchor Bay, Sea Point, Cape Town',
  what_to_bring         = COALESCE(what_to_bring, 'Sunscreen, hat, towel, water bottle'),
  activity_verb_past    = COALESCE(activity_verb_past, 'paddling'),
  location_phrase       = COALESCE(location_phrase, 'in Sea Point'),
  footer_line_one       = COALESCE(footer_line_one, 'Cape Kayak Adventures'),
  footer_line_two       = COALESCE(footer_line_two, 'Three Anchor Bay, Sea Point, Cape Town')
WHERE business_name ILIKE '%marine%';

NOTIFY pgrst, 'reload schema';
