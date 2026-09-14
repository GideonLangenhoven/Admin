-- N-party settlement granularity: a combo with 3+ operators settles per pair
-- (collector ↔ each partner), so the settled marker moves to the leg level.
-- combo_bookings.settled stays as the "fully settled" rollup (and the only
-- marker for legacy 2-party rows with no items). Expand-only.
ALTER TABLE combo_booking_items
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;
