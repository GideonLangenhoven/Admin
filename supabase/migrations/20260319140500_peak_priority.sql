-- Peak periods table with priority for precedence when date ranges overlap
CREATE TABLE IF NOT EXISTS peak_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peak_periods_date_order CHECK (end_date >= start_date)
);

-- Per-tour peak prices within a peak period
CREATE TABLE IF NOT EXISTS peak_period_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peak_period_id uuid NOT NULL REFERENCES peak_periods(id) ON DELETE CASCADE,
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  price_per_person numeric NOT NULL,
  UNIQUE (peak_period_id, tour_id)
);

-- Enable RLS
ALTER TABLE peak_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE peak_period_prices ENABLE ROW LEVEL SECURITY;

-- RLS policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'peak_periods' AND policyname = 'peak_periods_tenant') THEN
    CREATE POLICY peak_periods_tenant ON peak_periods
      USING (business_id IN (SELECT business_id FROM admin_users WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'peak_period_prices' AND policyname = 'peak_period_prices_tenant') THEN
    CREATE POLICY peak_period_prices_tenant ON peak_period_prices
      USING (peak_period_id IN (SELECT id FROM peak_periods WHERE business_id IN (SELECT business_id FROM admin_users WHERE user_id = auth.uid())));
  END IF;
END $$;
