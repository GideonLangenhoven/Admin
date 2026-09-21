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

  let emailJobs = db.from("notification_jobs")
    .select("id, recipient, template_type, status, attempts, last_error, next_attempt_at, accepted_at, created_at, booking_id")
    .eq("business_id", caller.business_id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (tab === "waiting") emailJobs = emailJobs.in("status", ["QUEUED", "PROCESSING"]);
  else if (tab === "recent") {
    emailJobs = emailJobs.eq("status", "ACCEPTED").gte("accepted_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  } else emailJobs = emailJobs.in("status", ["FAILED", "CANCELLED"]);

  const [{ data, error }, { data: emailData, error: emailError }] = await Promise.all([q, emailJobs]);
  if (error || emailError) return NextResponse.json({ error: error?.message || emailError?.message }, { status: 500 });
  const rows = [
    ...(data || []).map(row => ({ ...row, channel: "WHATSAPP", destination: row.phone })),
    ...(emailData || []).map(row => ({
      id: row.id,
      phone: "",
      destination: row.recipient,
      channel: "EMAIL",
      message_type: row.template_type,
      message_body: null,
      status: row.status,
      attempts: row.attempts,
      error: row.last_error,
      scheduled_for: row.next_attempt_at,
      sent_at: row.accepted_at,
      created_at: row.created_at,
      booking_id: row.booking_id,
    })),
  ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 100);
  return NextResponse.json({ rows });
}
