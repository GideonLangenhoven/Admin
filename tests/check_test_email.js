import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load .env.local
const envContent = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8');
const env = envContent.split('\n').reduce((acc, line) => {
  const [key, value] = line.split('=');
  if (key && value) {
    acc[key.trim()] = value.trim();
  }
  return acc;
}, {});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
  const { data: camps } = await supabase.from('marketing_campaigns')
    .select('id, name, status, total_failed')
    .ilike('name', '[TEST]%')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log("Recent test campaigns:", camps);

  if (camps && camps.length > 0) {
    const { data: q } = await supabase.from('marketing_queue')
      .select('status, error_message, email')
      .in('campaign_id', camps.map(c => c.id));
    console.log("Queue items:", q);
  }
}
check();
