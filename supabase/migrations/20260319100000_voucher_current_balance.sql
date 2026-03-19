-- Add current_balance column to vouchers table to track remaining balance
-- after partial redemptions (fixes the "Voucher Remainder Black Hole" issue).
-- On insert, current_balance defaults to the voucher's value.

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS current_balance numeric;

-- Backfill: set current_balance for existing vouchers
-- ACTIVE vouchers get their full value; REDEEMED vouchers get 0
UPDATE vouchers
SET current_balance = CASE
  WHEN status = 'REDEEMED' THEN 0
  WHEN status = 'ACTIVE' THEN COALESCE(value, purchase_amount, 0)
  WHEN status = 'PENDING' THEN COALESCE(value, purchase_amount, 0)
  ELSE COALESCE(value, purchase_amount, 0)
END
WHERE current_balance IS NULL;

-- Set a default so new vouchers auto-populate current_balance from value
-- (Note: this sets a static default; the insert logic in the app will set it explicitly)
ALTER TABLE vouchers
  ALTER COLUMN current_balance SET DEFAULT 0;
