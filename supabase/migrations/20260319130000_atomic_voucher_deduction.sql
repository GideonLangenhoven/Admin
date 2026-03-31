-- Atomic voucher balance deduction with row-level locking to prevent double-spend.
-- Also adds pax_limit column for FREE_TRIP vouchers.

-- 1. Add pax_limit column (defaults to 1 for FREE_TRIP vouchers)
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS pax_limit integer DEFAULT 1;

-- 2. Add purchase_value column to track what was paid for FREE_TRIP vouchers
--    (may already exist as purchase_amount; alias for clarity)
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS purchase_value numeric;

-- Backfill purchase_value from purchase_amount where not set
UPDATE vouchers
SET purchase_value = COALESCE(purchase_amount, value, 0)
WHERE purchase_value IS NULL;

-- 3. Create atomic deduction function
CREATE OR REPLACE FUNCTION deduct_voucher_balance(
  p_voucher_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row vouchers%ROWTYPE;
  v_new_balance numeric;
  v_deducted numeric;
BEGIN
  -- Lock the row to prevent concurrent reads
  SELECT * INTO v_row
  FROM vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Voucher not found',
      'deducted', 0,
      'remaining', 0
    );
  END IF;

  -- Check voucher is active
  IF v_row.status NOT IN ('ACTIVE') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Voucher is not active (status: ' || v_row.status || ')',
      'deducted', 0,
      'remaining', COALESCE(v_row.current_balance, 0)
    );
  END IF;

  -- Get current balance
  v_new_balance := COALESCE(v_row.current_balance, v_row.value, v_row.purchase_amount, 0);

  IF v_new_balance <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No balance remaining',
      'deducted', 0,
      'remaining', 0
    );
  END IF;

  -- Calculate actual deduction (cannot exceed balance)
  v_deducted := LEAST(p_amount, v_new_balance);
  v_new_balance := v_new_balance - v_deducted;

  -- Update the voucher
  IF v_new_balance <= 0 THEN
    UPDATE vouchers
    SET current_balance = 0,
        status = 'REDEEMED',
        redeemed_at = NOW()
    WHERE id = p_voucher_id;
  ELSE
    UPDATE vouchers
    SET current_balance = v_new_balance
    WHERE id = p_voucher_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deducted', v_deducted,
    'remaining', v_new_balance
  );
END;
$$;
