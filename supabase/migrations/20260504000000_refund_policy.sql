BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS refund_policy_tiers jsonb NOT NULL DEFAULT
    '[
      { "hours_before": 24, "refund_percent": 100 },
      { "hours_before":  2, "refund_percent":  50 },
      { "hours_before":  0, "refund_percent":   0 }
    ]'::jsonb,
  ADD COLUMN IF NOT EXISTS refund_policy_text text DEFAULT
    'Cancel free up to 24 hours before your tour for a full refund. Within 24 hours, 50% refund. Within 2 hours of tour start, no refund. Weather cancellations by the operator are fully refunded.';

CREATE OR REPLACE FUNCTION public.calculate_refund_percent(
  p_business_id uuid,
  p_tour_start  timestamptz,
  p_now         timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tiers       jsonb;
  v_hours_left  numeric;
  v_tier        jsonb;
  v_percent     integer := 0;
BEGIN
  SELECT refund_policy_tiers INTO v_tiers
    FROM public.businesses WHERE id = p_business_id;

  IF v_tiers IS NULL OR jsonb_typeof(v_tiers) <> 'array' THEN
    RETURN 0;
  END IF;

  v_hours_left := EXTRACT(EPOCH FROM (p_tour_start - p_now)) / 3600.0;

  FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) ORDER BY (value->>'hours_before')::numeric DESC LOOP
    IF v_hours_left >= (v_tier->>'hours_before')::numeric THEN
      v_percent := (v_tier->>'refund_percent')::integer;
      RETURN GREATEST(0, LEAST(100, v_percent));
    END IF;
  END LOOP;

  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_refund_percent(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_refund_percent(uuid, timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calculate_booking_refund(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_tour_start  timestamptz;
  v_total       numeric;
  v_percent     integer;
  v_amount      numeric;
BEGIN
  SELECT b.business_id, s.start_time, b.total_amount
    INTO v_business_id, v_tour_start, v_total
    FROM public.bookings b
    LEFT JOIN public.slots s ON s.id = b.slot_id
    WHERE b.id = p_booking_id;

  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('error', 'booking not found');
  END IF;

  v_percent := public.calculate_refund_percent(v_business_id, v_tour_start);
  v_amount  := round((COALESCE(v_total, 0) * v_percent) / 100.0, 2);

  RETURN jsonb_build_object(
    'percent', v_percent,
    'amount',  v_amount,
    'tour_start', v_tour_start,
    'now', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_booking_refund(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_booking_refund(uuid) TO authenticated, service_role;

ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS policy_percent integer;

COMMIT;
