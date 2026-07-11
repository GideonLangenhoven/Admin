-- S3 (stress-test finding): historical slots.held drift. Increments were atomic
-- (create_hold_with_capacity_check uses SELECT FOR UPDATE) but decrements were
-- non-atomic read-modify-writes across ~15 edge-function call sites, so concurrent
-- expiries/cancels lost updates -> phantom-reserved seats. All decrement sites are
-- now routed through the atomic adjust_slot_capacity RPC (edge code, same release).
--
-- This one-off reconcile recomputes held from live ACTIVE holds (authoritative) for
-- any slot whose stored held disagrees. Fixes the 7 known drifted slots. Safe:
-- create_hold_with_capacity_check inserts the hold and increments held in one
-- transaction, so this never races a half-applied hold.

BEGIN;

WITH correct AS (
  SELECT s.id,
         COALESCE((SELECT SUM(h.qty) FROM public.holds h
                   WHERE h.slot_id = s.id AND h.status = 'ACTIVE'), 0) AS correct_held
  FROM public.slots s
)
UPDATE public.slots s
SET held = correct.correct_held
FROM correct
WHERE s.id = correct.id
  AND COALESCE(s.held, 0) <> correct.correct_held;

COMMIT;
