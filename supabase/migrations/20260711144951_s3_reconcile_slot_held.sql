WITH correct AS (
  SELECT s.id,
         COALESCE((SELECT SUM(h.qty) FROM public.holds h
                   WHERE h.slot_id = s.id AND h.status = 'ACTIVE'), 0) AS correct_held
  FROM public.slots s
)
UPDATE public.slots s
SET held = correct.correct_held
FROM correct
WHERE s.id = correct.id AND COALESCE(s.held, 0) <> correct.correct_held;;
