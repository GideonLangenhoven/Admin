BEGIN;

-- A booking keeps one authoritative guest-arrival count. checked_in remains a
-- compatibility flag and is true only when the booking's whole current group
-- has arrived.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS arrived_count integer;

UPDATE public.bookings
SET arrived_count = CASE WHEN checked_in THEN qty ELSE 0 END
WHERE arrived_count IS NULL;

ALTER TABLE public.bookings
  ALTER COLUMN arrived_count SET DEFAULT 0,
  ALTER COLUMN arrived_count SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_arrived_count_bounds'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_arrived_count_bounds
      CHECK (arrived_count >= 0 AND arrived_count <= qty) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.bookings VALIDATE CONSTRAINT bookings_arrived_count_bounds;

-- Some disposable schemas predate the Guide migration. Keeping this creation
-- here makes the arrival migration independently testable while remaining a
-- no-op on deployed databases.
CREATE TABLE IF NOT EXISTS public.slot_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  slot_id uuid REFERENCES public.slots(id) ON DELETE SET NULL,
  actor_admin_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  client_event_id text,
  source text DEFAULT 'guide-pwa',
  notes text
);

ALTER TABLE public.slot_check_ins
  ADD COLUMN IF NOT EXISTS arrived_count_before integer,
  ADD COLUMN IF NOT EXISTS arrived_count_after integer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_check_in_client_event
  ON public.slot_check_ins (booking_id, client_event_id)
  WHERE client_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_check_in_slot
  ON public.slot_check_ins (slot_id, checked_in_at DESC);

ALTER TABLE public.slot_check_ins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS check_ins_admin ON public.slot_check_ins;
CREATE POLICY check_ins_admin ON public.slot_check_ins FOR ALL TO authenticated
  USING (business_id = ANY(public.current_business_ids()))
  WITH CHECK (business_id = ANY(public.current_business_ids()));
DROP POLICY IF EXISTS check_ins_service ON public.slot_check_ins;
CREATE POLICY check_ins_service ON public.slot_check_ins FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.slot_check_ins FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slot_check_ins TO authenticated;
GRANT ALL ON public.slot_check_ins TO service_role;

CREATE OR REPLACE FUNCTION public.sync_booking_arrival_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  was_complete boolean := false;
  is_complete boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.arrived_count := CASE
      WHEN COALESCE(NEW.checked_in, false) THEN NEW.qty
      ELSE COALESCE(NEW.arrived_count, 0)
    END;
  ELSE
    was_complete := OLD.qty > 0 AND OLD.arrived_count = OLD.qty;

    -- Attendance belongs to a departure. It never follows a booking move.
    IF NEW.slot_id IS DISTINCT FROM OLD.slot_id THEN
      NEW.arrived_count := 0;
    ELSIF NEW.arrived_count IS DISTINCT FROM OLD.arrived_count THEN
      -- arrived_count is authoritative for new writers.
      NULL;
    ELSIF NEW.checked_in IS DISTINCT FROM OLD.checked_in THEN
      -- Keep old boolean-only writers coherent during rollout.
      NEW.arrived_count := CASE WHEN NEW.checked_in THEN NEW.qty ELSE 0 END;
    ELSIF NEW.qty IS DISTINCT FROM OLD.qty THEN
      IF NEW.qty < OLD.arrived_count THEN
        RAISE EXCEPTION 'Guest quantity cannot be below the recorded arrived count (%)', OLD.arrived_count
          USING ERRCODE = '23514';
      END IF;
      -- A larger group does not manufacture new arrivals.
      NEW.arrived_count := OLD.arrived_count;
    END IF;
  END IF;

  IF NEW.arrived_count IS NULL
      OR NEW.arrived_count < 0
      OR NEW.arrived_count > NEW.qty THEN
    RAISE EXCEPTION 'Arrived count must be between 0 and booking quantity'
      USING ERRCODE = '23514';
  END IF;

  is_complete := NEW.qty > 0 AND NEW.arrived_count = NEW.qty;
  NEW.checked_in := is_complete;
  IF is_complete THEN
    IF TG_OP = 'INSERT' OR NOT was_complete OR NEW.checked_in_at IS NULL THEN
      NEW.checked_in_at := COALESCE(NEW.checked_in_at, now());
    END IF;
  ELSE
    NEW.checked_in_at := NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_booking_arrival_state ON public.bookings;
CREATE TRIGGER trg_sync_booking_arrival_state
BEFORE INSERT OR UPDATE OF arrived_count, checked_in, qty, slot_id
ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_booking_arrival_state();

-- Conflict-checked absolute updates are easy for a reception device to retry:
-- the client sends the count it read plus an event id, and receives canonical
-- state. The booking lock, mutation and audit row share one transaction.
CREATE OR REPLACE FUNCTION public.record_booking_arrival(
  p_booking_id uuid,
  p_business_id uuid,
  p_actor_admin_id uuid,
  p_arrived_count integer,
  p_expected_arrived_count integer,
  p_client_event_id text,
  p_source text,
  p_notes text,
  p_slot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  target_count integer;
  previous_count integer;
  existing_event public.slot_check_ins%ROWTYPE;
BEGIN
  SELECT * INTO b
  FROM public.bookings
  WHERE id = p_booking_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', 'Booking not found');
  END IF;

  IF p_slot_id IS NOT NULL AND p_slot_id IS DISTINCT FROM b.slot_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'STALE_SLOT',
      'error', 'This booking moved to another departure. Refresh and try again.',
      'arrived_count', b.arrived_count, 'qty', b.qty, 'slot_id', b.slot_id
    );
  END IF;

  IF p_client_event_id IS NOT NULL THEN
    SELECT * INTO existing_event
    FROM public.slot_check_ins
    WHERE booking_id = b.id AND client_event_id = p_client_event_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true, 'replay', true,
        'arrived_count', b.arrived_count, 'qty', b.qty,
        'checked_in', b.checked_in, 'checked_in_at', b.checked_in_at,
        'slot_id', b.slot_id
      );
    END IF;
  END IF;

  target_count := COALESCE(p_arrived_count, b.qty);
  previous_count := b.arrived_count;
  IF target_count < 0 OR target_count > b.qty THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'OUT_OF_RANGE',
      'error', format('Arrived count must be between 0 and %s.', b.qty),
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  IF p_expected_arrived_count IS NOT NULL
      AND p_expected_arrived_count IS DISTINCT FROM b.arrived_count THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'STALE',
      'error', 'Arrival count changed on another device. Review the latest count and try again.',
      'arrived_count', b.arrived_count, 'qty', b.qty,
      'checked_in', b.checked_in, 'checked_in_at', b.checked_in_at,
      'slot_id', b.slot_id
    );
  END IF;

  -- Resetting/correcting to zero is always possible. Recording arrivals keeps
  -- the established settled-booking and signed-waiver guard.
  IF target_count > 0 AND b.status NOT IN ('PAID', 'CONFIRMED', 'COMPLETED') THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'PAYMENT_REQUIRED',
      'error', 'Record payment before checking in this booking.',
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  IF target_count > 0 AND COALESCE(b.waiver_status, '') <> 'SIGNED' THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'WAIVER_REQUIRED',
      'error', 'A signed waiver is required before check-in.',
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  UPDATE public.bookings
  SET arrived_count = target_count
  WHERE id = b.id
  RETURNING * INTO b;

  INSERT INTO public.slot_check_ins (
    business_id, booking_id, slot_id, actor_admin_id, checked_in_at,
    client_event_id, source, notes, arrived_count_before, arrived_count_after
  ) VALUES (
    b.business_id, b.id, b.slot_id, p_actor_admin_id, now(),
    NULLIF(left(COALESCE(p_client_event_id, ''), 160), ''),
    left(COALESCE(NULLIF(p_source, ''), 'admin'), 80),
    NULLIF(left(COALESCE(p_notes, ''), 500), ''),
    previous_count, target_count
  );

  RETURN jsonb_build_object(
    'ok', true, 'replay', false,
    'arrived_count', b.arrived_count, 'qty', b.qty,
    'checked_in', b.checked_in, 'checked_in_at', b.checked_in_at,
    'slot_id', b.slot_id
  );
END $$;

REVOKE ALL ON FUNCTION public.record_booking_arrival(uuid, uuid, uuid, integer, integer, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_booking_arrival(uuid, uuid, uuid, integer, integer, text, text, text, uuid)
  TO service_role;

COMMIT;
