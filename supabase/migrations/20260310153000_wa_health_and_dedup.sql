-- Create table for tracking processed WhatsApp messages to prevent duplicates
CREATE TABLE IF NOT EXISTS public.processed_wa_messages (
    id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create table for tracking sent booking reminders
CREATE TABLE IF NOT EXISTS public.booking_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- '24H' or '2H'
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(booking_id, type)
);

-- Add last_activity_at to conversations to help with health monitoring
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
