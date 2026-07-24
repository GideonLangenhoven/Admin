-- Central operator directory (bare booking domain landing page).
--
-- businesses_anon_select deliberately blocks tenant enumeration, so the
-- directory reads through a dedicated owner-rights view that exposes ONLY
-- public marketing fields for operators that opted in (directory_visible,
-- default true — new operators appear automatically). Styling/copy lives in
-- platform_settings ('directory' row): anon-readable, super-admin-writable.
-- Expand-only.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS directory_visible boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_public_read ON platform_settings;
CREATE POLICY platform_settings_public_read ON platform_settings
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS platform_settings_super_admin_all ON platform_settings;
CREATE POLICY platform_settings_super_admin_all ON platform_settings
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM admin_users au
    WHERE au.user_id = (SELECT auth.uid())
      AND upper(COALESCE(au.role, '')) LIKE 'SUPER%'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM admin_users au
    WHERE au.user_id = (SELECT auth.uid())
      AND upper(COALESCE(au.role, '')) LIKE 'SUPER%'
  ));

INSERT INTO platform_settings (key, value) VALUES ('directory', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Owner-rights view: intentionally bypasses businesses RLS to expose only
-- these public marketing columns. hero_image_url falls back to the operator's
-- first active tour image so cards look good with zero configuration.
CREATE OR REPLACE VIEW operator_directory AS
  SELECT
    b.id,
    b.name,
    b.business_name,
    b.business_tagline,
    b.subdomain,
    b.logo_url,
    b.booking_site_url,
    b.location_phrase,
    (SELECT t.image_url FROM tours t
      WHERE t.business_id = b.id AND t.active = true AND t.image_url IS NOT NULL
      ORDER BY t.sort_order LIMIT 1) AS hero_image_url,
    (SELECT count(*) FROM tours t
      WHERE t.business_id = b.id AND t.active = true) AS tour_count
  FROM businesses b
  WHERE b.directory_visible = true
    AND b.subdomain IS NOT NULL;

GRANT SELECT ON operator_directory TO anon, authenticated;
