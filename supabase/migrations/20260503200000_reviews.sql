-- Reviews table: native (customer-submitted) and Google reviews
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  tour_id uuid REFERENCES public.tours(id),
  booking_id uuid REFERENCES public.bookings(id),
  source text NOT NULL CHECK (source IN ('NATIVE', 'GOOGLE')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'HIDDEN', 'SPAM')),
  rating smallint CHECK (rating >= 1 AND rating <= 5),
  comment text,
  reviewer_name text,
  reviewer_avatar_url text,
  google_review_id text UNIQUE,
  submission_token text UNIQUE,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_business_id ON public.reviews(business_id);
CREATE INDEX idx_reviews_tour_id ON public.reviews(tour_id) WHERE tour_id IS NOT NULL;
CREATE INDEX idx_reviews_status ON public.reviews(status);
CREATE INDEX idx_reviews_submission_token ON public.reviews(submission_token) WHERE submission_token IS NOT NULL;
CREATE INDEX idx_reviews_google_review_id ON public.reviews(google_review_id) WHERE google_review_id IS NOT NULL;

-- Aggregated review stats per tour (Google reviews credit all tours for that business)
CREATE OR REPLACE VIEW public.tour_review_stats AS
SELECT
  t.id AS tour_id,
  t.business_id,
  ROUND(COALESCE(AVG(r.rating) FILTER (WHERE r.rating IS NOT NULL), 0)::numeric, 1) AS avg_rating,
  COUNT(*) FILTER (WHERE r.rating IS NOT NULL) AS review_count
FROM public.tours t
LEFT JOIN public.reviews r ON (
  (r.tour_id = t.id OR (r.source = 'GOOGLE' AND r.business_id = t.business_id))
  AND r.status = 'APPROVED'
)
GROUP BY t.id, t.business_id;

-- Google Places integration columns on businesses
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS google_place_id text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS google_reviews_last_synced_at timestamptz;

-- RLS
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY reviews_anon_read ON public.reviews
  FOR SELECT TO anon USING (status = 'APPROVED');

CREATE POLICY reviews_authenticated_read ON public.reviews
  FOR SELECT TO authenticated USING (true);

CREATE POLICY reviews_authenticated_update ON public.reviews
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY reviews_service_insert ON public.reviews
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY reviews_service_update ON public.reviews
  FOR UPDATE TO service_role USING (true);

GRANT SELECT ON public.reviews TO anon, authenticated;
GRANT INSERT, UPDATE ON public.reviews TO service_role;
GRANT UPDATE ON public.reviews TO authenticated;
GRANT SELECT ON public.tour_review_stats TO anon, authenticated;
