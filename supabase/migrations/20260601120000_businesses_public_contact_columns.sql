-- Public contact details for the customer-facing "Contact Us" panel on /my-bookings.
-- These are intentionally public (anon-readable): a signed-in customer needs a way to
-- reach the operator by email, phone, or WhatsApp.
--
-- IMPORTANT: the AN3 column restriction (20260519110000) replaced anon's table-wide
-- SELECT on public.businesses with an explicit column-level grant. Column-level grants
-- do NOT automatically extend to columns added afterwards, so each new public column
-- must be granted to anon here or PostgREST will 401 when the booking site reads it.

alter table public.businesses
  add column if not exists public_email text,
  add column if not exists public_phone text,
  add column if not exists public_whatsapp text;

grant select (public_email, public_phone, public_whatsapp) on public.businesses to anon;

-- Seed the launch tenant (Aonyx) so the panel has data to render immediately.
update public.businesses
   set public_email    = 'aonyx@bookingtours.co.za',
       public_phone    = '+27716145061',
       public_whatsapp = '+27716145061'
 where subdomain = 'aonyx';
