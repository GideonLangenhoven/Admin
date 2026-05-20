import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

// AM3: retry a failed outbox message. Resets status to PENDING and reschedules
// for immediate delivery. The outbox-send cron picks it up on the next tick.
// Per-business scoping is enforced — admin can only retry rows in their own
// tenant.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  const { id } = await params;
  const db = adminClient();

  const { data: row } = await db.from("outbox")
    .select("id, status, business_id")
    .eq("id", id)
    .eq("business_id", caller.business_id)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  if (!["FAILED", "EXPIRED"].includes(row.status)) {
    return NextResponse.json({ error: "Only FAILED or EXPIRED rows can be retried" }, { status: 400 });
  }

  const { error } = await db.from("outbox").update({
    status: "PENDING",
    scheduled_for: new Date().toISOString(),
    error: null,
  }).eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: caller.business_id,
    action_type: "OUTBOX_RETRY",
    target_entity: "outbox",
    target_id: id,
  });

  return NextResponse.json({ ok: true });
}
