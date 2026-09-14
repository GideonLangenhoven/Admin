-- Operator-set excitement line for the booking-confirmation email. NULL =
-- keep the built-in activity-aware default (guessed from the tour name).
alter table businesses add column if not exists email_tagline text;
