-- Add seat pricing became necessary to fix the "add seat" endpoint (which read
-- a hardcoded fallback of R750/seat that lived only in application code, never
-- the database). Seat-add has never successfully billed anyone before (the
-- endpoint 404'd on every call — see app/api/billing/seats/route.ts), so a
-- NOT NULL DEFAULT here (which Postgres auto-backfills onto existing plan
-- rows) does not change any price a customer has actually been charged.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS extra_seat_price_zar integer NOT NULL DEFAULT 500;
