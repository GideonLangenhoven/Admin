-- Every customer who books gets auto-added to marketing_contacts (email,
-- name, phone, DOB when known). A trigger on bookings is the one choke point
-- covering all booking paths: customer checkout, admin new-booking, payment
-- webhooks, OTA syncs, combo, external bookings.
--
-- Rules:
--  * skips rows with no usable email and POPIA-anonymized addresses
--    (%@anonymized.local)
--  * fill-missing-only on conflict — never overwrites operator-curated
--    names/DOB and never touches status (unsubscribed stays unsubscribed)
--  * DOB comes from the customers ledger or the signed waiver payload
--  * SECURITY DEFINER + exception-swallowing so a marketing sync failure can
--    never break a booking write

CREATE OR REPLACE FUNCTION public.ck_sync_marketing_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name  text;
  v_first text;
  v_last  text;
  v_dob   date;
  v_waiver_dob text;
BEGIN
  v_email := lower(btrim(coalesce(NEW.email, '')));
  IF v_email = '' OR position('@' in v_email) = 0 OR v_email LIKE '%@anonymized.local' THEN
    RETURN NEW;
  END IF;

  v_name  := btrim(coalesce(NEW.customer_name, ''));
  v_first := nullif(split_part(v_name, ' ', 1), '');
  v_last  := nullif(btrim(substring(v_name from length(split_part(v_name, ' ', 1)) + 1)), '');

  v_waiver_dob := NEW.waiver_payload->>'date_of_birth';
  IF v_waiver_dob !~ '^\d{4}-\d{2}-\d{2}$' THEN
    v_waiver_dob := NULL;
  END IF;

  SELECT c.date_of_birth INTO v_dob
  FROM customers c
  WHERE c.business_id = NEW.business_id
    AND lower(c.email) = v_email
    AND c.deleted_at IS NULL
    AND c.date_of_birth IS NOT NULL
  LIMIT 1;

  v_dob := coalesce(v_dob, v_waiver_dob::date);

  INSERT INTO marketing_contacts (business_id, email, first_name, last_name, phone, date_of_birth, source)
  VALUES (NEW.business_id, v_email, v_first, v_last, nullif(btrim(coalesce(NEW.phone, '')), ''), v_dob, 'booking')
  ON CONFLICT (business_id, email) DO UPDATE SET
    first_name    = coalesce(nullif(marketing_contacts.first_name, ''), excluded.first_name),
    last_name     = coalesce(nullif(marketing_contacts.last_name, ''), excluded.last_name),
    phone         = coalesce(nullif(marketing_contacts.phone, ''), excluded.phone),
    date_of_birth = coalesce(marketing_contacts.date_of_birth, excluded.date_of_birth),
    updated_at    = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ck_sync_marketing_contact failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ck_booking_sync_marketing_contact ON public.bookings;
CREATE TRIGGER ck_booking_sync_marketing_contact
AFTER INSERT OR UPDATE OF email, customer_name, phone, waiver_payload ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.ck_sync_marketing_contact();

-- ── Backfill ──
-- 1) customers ledger (deduped per business, carries DOB/phone)
INSERT INTO marketing_contacts (business_id, email, first_name, last_name, phone, date_of_birth, source)
SELECT c.business_id,
       lower(btrim(c.email)),
       nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), ''),
       nullif(btrim(substring(btrim(coalesce(c.name, '')) from length(split_part(btrim(coalesce(c.name, '')), ' ', 1)) + 1)), ''),
       nullif(btrim(coalesce(c.phone, '')), ''),
       c.date_of_birth,
       'booking-backfill'
FROM customers c
WHERE c.deleted_at IS NULL
  AND coalesce(c.email, '') <> ''
  AND position('@' in c.email) > 0
  AND lower(c.email) NOT LIKE '%@anonymized.local'
ON CONFLICT (business_id, email) DO UPDATE SET
  first_name    = coalesce(nullif(marketing_contacts.first_name, ''), excluded.first_name),
  last_name     = coalesce(nullif(marketing_contacts.last_name, ''), excluded.last_name),
  phone         = coalesce(nullif(marketing_contacts.phone, ''), excluded.phone),
  date_of_birth = coalesce(marketing_contacts.date_of_birth, excluded.date_of_birth),
  updated_at    = now();

-- 2) bookings not present in the customers ledger (belt and braces), newest
--    booking per (business, email) wins for name/phone; DOB from waiver payload
INSERT INTO marketing_contacts (business_id, email, first_name, last_name, phone, date_of_birth, source)
SELECT DISTINCT ON (b.business_id, lower(btrim(b.email)))
       b.business_id,
       lower(btrim(b.email)),
       nullif(split_part(btrim(coalesce(b.customer_name, '')), ' ', 1), ''),
       nullif(btrim(substring(btrim(coalesce(b.customer_name, '')) from length(split_part(btrim(coalesce(b.customer_name, '')), ' ', 1)) + 1)), ''),
       nullif(btrim(coalesce(b.phone, '')), ''),
       CASE WHEN b.waiver_payload->>'date_of_birth' ~ '^\d{4}-\d{2}-\d{2}$'
            THEN (b.waiver_payload->>'date_of_birth')::date END,
       'booking-backfill'
FROM bookings b
WHERE coalesce(b.email, '') <> ''
  AND position('@' in b.email) > 0
  AND lower(b.email) NOT LIKE '%@anonymized.local'
ORDER BY b.business_id, lower(btrim(b.email)), b.created_at DESC
ON CONFLICT (business_id, email) DO UPDATE SET
  first_name    = coalesce(nullif(marketing_contacts.first_name, ''), excluded.first_name),
  last_name     = coalesce(nullif(marketing_contacts.last_name, ''), excluded.last_name),
  phone         = coalesce(nullif(marketing_contacts.phone, ''), excluded.phone),
  date_of_birth = coalesce(marketing_contacts.date_of_birth, excluded.date_of_birth),
  updated_at    = now();

-- 3) DOB sweep: waiver-signed bookings whose contact still lacks DOB
UPDATE marketing_contacts mc
SET date_of_birth = w.dob, updated_at = now()
FROM (
  SELECT DISTINCT ON (b.business_id, lower(btrim(b.email)))
         b.business_id, lower(btrim(b.email)) AS email,
         (b.waiver_payload->>'date_of_birth')::date AS dob
  FROM bookings b
  WHERE b.waiver_payload->>'date_of_birth' ~ '^\d{4}-\d{2}-\d{2}$'
    AND coalesce(b.email, '') <> ''
  ORDER BY b.business_id, lower(btrim(b.email)), b.created_at DESC
) w
WHERE mc.business_id = w.business_id
  AND mc.email = w.email
  AND mc.date_of_birth IS NULL;
