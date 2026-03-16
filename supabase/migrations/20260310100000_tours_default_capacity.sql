-- Add default_capacity to tours.
-- This column is used by the slot generator in the admin settings page
-- to set capacity_total on each generated slot.
alter table public.tours
  add column if not exists default_capacity integer not null default 10;
