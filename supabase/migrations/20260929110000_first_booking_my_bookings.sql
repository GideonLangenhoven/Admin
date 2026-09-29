-- Mark the first paid booking for each operator and record a separate opt-in
-- for booking-related WhatsApp messages. Existing bookings are not retroactively
-- opted in or messaged.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS whatsapp_booking_updates_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_operator_booking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_operator_booked_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_first_operator_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  email_key text := lower(btrim(coalesce(NEW.email, '')));
  phone_key text := regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g');
  email_lock bigint;
  phone_lock bigint;
BEGIN
  -- South African local and international forms identify the same booker.
  IF left(phone_key, 1) = '0' AND length(phone_key) = 10 THEN
    phone_key := '27' || substring(phone_key from 2);
  END IF;
  IF NEW.status NOT IN ('PAID', 'CONFIRMED', 'COMPLETED') THEN
    NEW.first_operator_booking := CASE WHEN TG_OP = 'UPDATE' THEN OLD.first_operator_booking ELSE false END;
    NEW.first_operator_booked_at := CASE WHEN TG_OP = 'UPDATE' THEN OLD.first_operator_booked_at ELSE NULL END;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('PAID', 'CONFIRMED', 'COMPLETED') THEN
    NEW.first_operator_booking := OLD.first_operator_booking;
    NEW.first_operator_booked_at := OLD.first_operator_booked_at;
    RETURN NEW;
  END IF;
  IF email_key = '' AND length(phone_key) < 8 THEN
    NEW.first_operator_booking := false;
    NEW.first_operator_booked_at := NULL;
    RETURN NEW;
  END IF;

  -- Take both contact locks in stable order so simultaneous payments with the
  -- same email or phone cannot each become the first booking.
  IF email_key <> '' THEN
    email_lock := hashtextextended(NEW.business_id::text || '/email/' || email_key, 0);
  END IF;
  IF length(phone_key) >= 8 THEN
    phone_lock := hashtextextended(NEW.business_id::text || '/phone/' || phone_key, 0);
  END IF;
  IF email_lock IS NOT NULL AND phone_lock IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(least(email_lock, phone_lock));
    IF email_lock <> phone_lock THEN PERFORM pg_advisory_xact_lock(greatest(email_lock, phone_lock)); END IF;
  ELSIF email_lock IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(email_lock);
  ELSE
    PERFORM pg_advisory_xact_lock(phone_lock);
  END IF;

  NEW.first_operator_booking := NOT EXISTS (
    SELECT 1 FROM public.bookings prior
    WHERE prior.business_id = NEW.business_id AND prior.id <> NEW.id
      AND (prior.status IN ('PAID', 'CONFIRMED', 'COMPLETED')
        OR prior.first_operator_booking
        OR (prior.status = 'CANCELLED' AND prior.payment_status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')))
      AND (
        (email_key <> '' AND lower(btrim(coalesce(prior.email, ''))) = email_key)
        OR (length(phone_key) >= 8 AND CASE
          WHEN regexp_replace(coalesce(prior.phone, ''), '\D', '', 'g') ~ '^0[0-9]{9}$'
          THEN '27' || substring(regexp_replace(prior.phone, '\D', '', 'g') from 2)
          ELSE regexp_replace(coalesce(prior.phone, ''), '\D', '', 'g')
        END = phone_key)
      )
  );
  NEW.first_operator_booked_at := CASE WHEN NEW.first_operator_booking THEN now() ELSE NULL END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_first_operator_booking() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mark_first_operator_booking ON public.bookings;
CREATE TRIGGER mark_first_operator_booking
BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.mark_first_operator_booking();

-- Meta sends digits-only phone numbers; stored booking numbers may include a
-- plus sign or spaces. STOP must revoke consent for every matching booking.
CREATE OR REPLACE FUNCTION public.stop_optional_whatsapp_messages(p_business_id uuid, p_phone text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  normalized text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  updated_count integer;
BEGIN
  IF left(normalized, 1) = '0' AND length(normalized) = 10 THEN
    normalized := '27' || substring(normalized from 2);
  END IF;
  IF length(normalized) < 8 THEN RETURN 0; END IF;
  UPDATE public.bookings b
  SET marketing_opt_in = false, whatsapp_booking_updates_opt_in = false
  WHERE b.business_id = p_business_id AND CASE
    WHEN regexp_replace(coalesce(b.phone, ''), '\D', '', 'g') ~ '^0[0-9]{9}$'
    THEN '27' || substring(regexp_replace(b.phone, '\D', '', 'g') from 2)
    ELSE regexp_replace(coalesce(b.phone, ''), '\D', '', 'g')
  END = normalized;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
REVOKE ALL ON FUNCTION public.stop_optional_whatsapp_messages(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_optional_whatsapp_messages(uuid, text) TO service_role;
