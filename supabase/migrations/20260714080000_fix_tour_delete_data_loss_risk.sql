-- Launch-day P0: deleting a tour with real bookings would have silently
-- cascade-deleted those bookings (and everything hanging off them —
-- auto_messages, add-ons, holds, outbox, paid_booking_events,
-- referral_uses, slot_check_ins) because bookings_tour_id_fkey was
-- ON DELETE CASCADE. reviews_tour_id_fkey had no cascade rule at all,
-- which is what actually surfaced as "Delete failed" — that FK violation
-- was accidentally the only thing preventing the CASCADE from running.
--
-- Fix: bookings must never disappear because a tour was deleted — a tour
-- with any booking history now blocks deletion at the DB level (defaults
-- to NO ACTION/RESTRICT once CASCADE is dropped), matching how the admin
-- UI already blocks deletion for tours with active vouchers. Reviews are
-- real customer feedback, not disposable — they now survive tour deletion
-- with tour_id set to null instead of throwing or cascading.

alter table public.bookings drop constraint bookings_tour_id_fkey;
alter table public.bookings add constraint bookings_tour_id_fkey
  foreign key (tour_id) references public.tours(id);

alter table public.reviews drop constraint reviews_tour_id_fkey;
alter table public.reviews add constraint reviews_tour_id_fkey
  foreign key (tour_id) references public.tours(id) on delete set null;
