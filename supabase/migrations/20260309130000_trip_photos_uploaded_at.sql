-- Add uploaded_at column to trip_photos if it doesn't exist, defaulting to created_at value
alter table public.trip_photos
  add column if not exists uploaded_at timestamptz;

-- Backfill from created_at for existing rows
update public.trip_photos
  set uploaded_at = created_at
  where uploaded_at is null;

-- Set default so new rows auto-populate
alter table public.trip_photos
  alter column uploaded_at set default now();
