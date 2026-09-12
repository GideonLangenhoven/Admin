ALTER POLICY holds_authenticated_update ON public.holds
  USING (
    booking_id IN (SELECT b.id FROM public.bookings b WHERE b.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
    OR slot_id IN (SELECT s.id FROM public.slots s WHERE s.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
  )
  WITH CHECK (
    booking_id IN (SELECT b.id FROM public.bookings b WHERE b.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
    OR slot_id IN (SELECT s.id FROM public.slots s WHERE s.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
  );;
