import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  let body: { request_id?: string; email?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { request_id, email } = body;
  if (!request_id || !email) return NextResponse.json({ error: "request_id and email required" }, { status: 400 });

  const db = adminClient();

  const { data: request } = await db.from("data_subject_requests")
    .select("id, status, email")
    .eq("id", request_id)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  if (request.email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Email does not match request" }, { status: 403 });
  }

  if (!["PENDING_CONFIRMATION", "CONFIRMED"].includes(request.status)) {
    return NextResponse.json({ error: "Request cannot be cancelled in its current state" }, { status: 400 });
  }

  await db.from("data_subject_requests").update({
    status: "CANCELLED",
    cancelled_at: new Date().toISOString(),
    cancellation_reason: "Cancelled by customer",
    updated_at: new Date().toISOString(),
  }).eq("id", request_id);

  return NextResponse.json({ ok: true });
}
