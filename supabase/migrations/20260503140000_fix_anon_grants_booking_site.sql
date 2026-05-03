-- Fix: booking site broken — anon role missing SELECT grant on businesses and bookings.
-- The businesses table is needed for tenant/theme resolution (ThemeProvider).
-- The bookings table is needed for draft saves, booking status reads, my-bookings page.
-- RLS policies already restrict what anon can see.

GRANT SELECT ON public.businesses TO anon;
GRANT SELECT ON public.bookings TO anon;
