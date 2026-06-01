-- J4: PAID/CONFIRMED -> COMPLETED transition needs a timestamp.
-- completed_at records when a tour was completed; used by review auto-messages
-- to fire review requests/reminders relative to tour end.
alter table public.bookings
  add column if not exists completed_at timestamptz;
