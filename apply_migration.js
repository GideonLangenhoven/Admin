const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const sql = `
CREATE TABLE IF NOT EXISTS public.processed_wa_messages (
    id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.booking_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(booking_id, type)
);

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
`;

async function apply() {
    console.log("Applying SQL...");
    // Supabase JS doesn't have a direct 'query' or 'sql' method for raw SQL unless via RPC or similar.
    // So I will use the Postgres endpoint if possible, but since I don't have DB password, 
    // I'll suggest the user run this SQL.
    
    // Actually, I can use the Supabase CLI 'db execute' if it exists.
    console.log("Please run the following SQL in your Supabase Dashboard SQL Editor:");
    console.log(sql);
}

apply();
