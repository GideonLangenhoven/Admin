-- Payment-link settlements: operator B (owed party) generates a Yoco payment
-- link for the amount operator A (collector) owes them. The link is created on
-- B's own Yoco account; yoco-webhook flips the settlement row to PAID and
-- settles the underlying combo bookings. Expand-only.
ALTER TABLE combo_settlements
  ADD COLUMN IF NOT EXISTS yoco_checkout_id text,
  ADD COLUMN IF NOT EXISTS payment_url text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS combo_booking_ids uuid[],
  ADD COLUMN IF NOT EXISTS requested_by uuid;

CREATE INDEX IF NOT EXISTS idx_combo_settlements_yoco_checkout
  ON combo_settlements (yoco_checkout_id)
  WHERE yoco_checkout_id IS NOT NULL;
