import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

// Item 21: the Notifications tab is gone; operators shouldn't have to open a
// page to discover a failed WhatsApp send. A lightweight client watcher polls
// this route and pops an in-the-moment toast for any new failure. wa_messages
// is service-role-only (RLS, no client policies), so the read must happen
// here rather than from the browser. Scoped to the caller's own business.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only look at very recent failures — the watcher polls continuously, so a
  // narrow window keeps this cheap and avoids re-alerting old failures on load.
  const sinceParam = new URL(req.url).searchParams.get("since");
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam))
    ? new Date(sinceParam).toISOString()
    : new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await db.from("wa_messages")
    .select("id, to_phone, kind, status, error, created_at")
    .eq("business_id", caller.business_id)
    .eq("status", "FAILED")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ failures: data || [], now: new Date().toISOString() });
}
