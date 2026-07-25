-- Directory cards show an Intrepid-style "From R X" price row.
-- CREATE OR REPLACE VIEW may only append columns, so from_price goes last.
-- Grants/policies unchanged (same view, same grantees) — no baseline delta.
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
      WHERE t.business_id = b.id AND t.active = true) AS tour_count,
    (SELECT min(t.base_price_per_person) FROM tours t
      WHERE t.business_id = b.id AND t.active = true) AS from_price
  FROM businesses b
  WHERE b.directory_visible = true
    AND b.subdomain IS NOT NULL;
