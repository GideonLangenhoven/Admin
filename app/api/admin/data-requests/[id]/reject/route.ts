import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

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
  let body: { reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.reason || body.reason.trim().length < 5) {
    return NextResponse.json({ error: "A rejection reason is required (min 5 chars)" }, { status: 400 });
  }

  const db = adminClient();

  const { data: request } = await db.from("data_subject_requests")
    .select("id, status, business_id, email, request_type")
    .eq("id", id)
    .eq("business_id", caller.business_id)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (!["CONFIRMED", "IN_REVIEW"].includes(request.status)) {
    return NextResponse.json({ error: "Request cannot be rejected in its current state" }, { status: 400 });
  }

  await db.from("data_subject_requests").update({
    status: "REJECTED",
    cancellation_reason: body.reason.trim(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: caller.business_id,
    action_type: "POPIA_REJECT",
    target_entity: "data_subject_requests",
    target_id: id,
    after_state: { reason: body.reason.trim() },
  });

  // Notify customer
  await fetch(supabaseUrl + "/functions/v1/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + serviceKey },
    body: JSON.stringify({
      type: "POPIA_REQUEST_REJECTED",
      data: {
        business_id: caller.business_id,
        email: request.email,
        request_type: request.request_type,
        reason: body.reason.trim(),
      },
    }),
  });

  return NextResponse.json({ ok: true });
}
