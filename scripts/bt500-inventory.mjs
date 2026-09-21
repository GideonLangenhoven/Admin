import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const counts = {};
const columns = {};
const includeColumns = !process.argv.includes("--counts");
for (const table of ["businesses", "admin_users", "tours", "bookings", "slots", "customers", "wa_messages"]) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  counts[table] = error ? { error: error.code || error.message } : count;
  if (includeColumns) {
    const sample = await db.from(table).select("*").limit(1).maybeSingle();
    columns[table] = sample.error ? { error: sample.error.code || sample.error.message } : Object.keys(sample.data || {}).sort();
  }
}

console.log(JSON.stringify({ target_host: new URL(url).host, counts, ...(includeColumns ? { columns } : {}) }, null, 2));
