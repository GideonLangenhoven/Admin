-- Prevent duplicate slots: same business, tour, and start_time
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'slots_business_tour_start_unique'
  ) THEN
    -- Remove any existing duplicates first (keep the earliest-created row)
    DELETE FROM slots a USING slots b
    WHERE a.business_id = b.business_id
      AND a.tour_id = b.tour_id
      AND a.start_time = b.start_time
      AND a.id > b.id;

    ALTER TABLE slots
      ADD CONSTRAINT slots_business_tour_start_unique
      UNIQUE (business_id, tour_id, start_time);
  END IF;
END $$;
