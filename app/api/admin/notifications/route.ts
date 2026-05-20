import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

// AM3/AM5: admin-only list of outbox rows. Three tabs:
//   - failed   → status in (FAILED, EXPIRED), most-recent first
//   - waiting  → status = WAITING_WINDOW (queued behind 24h reopener)
//   - recent   → status = SENT, last 24h
// All scoped to the caller's business_id so super-admin only sees their own
// tenant's queue here (super-admin can pivot via /super-admin).

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  const tab = new URL(req.url).searchParams.get("tab") || "failed";
  const db = adminClient();
  let q = db.from("outbox")
    .select("id, phone, message_type, message_body, status, attempts, error, scheduled_for, sent_at, created_at, booking_id")
    .eq("business_id", caller.business_id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (tab === "waiting") q = q.eq("status", "WAITING_WINDOW");
  else if (tab === "recent") {
    q = q.eq("status", "SENT").gte("sent_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  } else {
    q = q.in("status", ["FAILED", "EXPIRED"]);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data || [] });
}
