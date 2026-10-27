BEGIN;

CREATE TABLE public.operator_dashboard_layouts (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  tile_order text[] NOT NULL,
  hidden_tiles text[] NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(tile_order) <= 50 AND cardinality(hidden_tiles) <= 50)
);

ALTER TABLE public.operator_dashboard_layouts ENABLE ROW LEVEL SECURITY;
-- Only the authenticated server route may write; its role and tenant checks
-- apply to layout changes even if someone bypasses the dashboard controls.
REVOKE ALL ON public.operator_dashboard_layouts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_dashboard_layouts TO service_role;

COMMIT;
