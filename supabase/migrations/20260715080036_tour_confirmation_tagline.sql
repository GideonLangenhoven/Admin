alter table public.tours
  add column if not exists confirmation_tagline text;

comment on column public.tours.confirmation_tagline is
  'Excitement line in the booking-confirmation email for this tour, after "Your spots are officially locked in." Overrides businesses.email_tagline. Blank falls back to the account tagline, then a tour-name-based guess.';;
