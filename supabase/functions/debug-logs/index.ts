import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
Deno.serve(async (req) => {
  const { data: logs } = await supabase.from('logs').select('*').order('created_at', { ascending: false }).limit(5);
  const { data: bookings } = await supabase.from('bookings').select('id,customer_name,email,created_at,status').order('created_at', { ascending: false }).limit(5);
  return new Response(JSON.stringify({ logs, bookings }), { headers: { "Content-Type": "application/json" } });
});
