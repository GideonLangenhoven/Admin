-- Add unique constraint on vouchers.code to prevent code collisions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_code_unique'
  ) THEN
    ALTER TABLE vouchers
      ADD CONSTRAINT vouchers_code_unique UNIQUE (code);
  END IF;
END $$;
