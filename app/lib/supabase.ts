import { createClient } from '@supabase/supabase-js'
import { guideSession } from './browser-session'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in admin app environment.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: guideSession ? { storageKey: `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-guide-auth-token` } : {},
})
