import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerAdmin } from "@/app/lib/api-auth";

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || caller.role !== "SUPER_ADMIN") return NextResponse.json({ error: "SUPER_ADMIN required" }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const businessId = body.business_id;
  if (typeof businessId !== "string" || businessId !== caller.business_id) return NextResponse.json({ error: "Select this business before changing it" }, { status: 400 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  let result;
  if (body.action === "status") {
    if (!["ACTIVE", "SUSPENDED", "PAUSED"].includes(body.status) || typeof body.expected_status !== "string") return NextResponse.json({ error: "Valid status and previous status required" }, { status: 400 });
    if (typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 1000) return NextResponse.json({ error: "Record a reason (5–1000 characters)" }, { status: 400 });
    result = await db.rpc("platform_change_business_status", { p_business_id: businessId, p_actor_id: caller.id, p_status: body.status, p_expected_status: body.expected_status, p_reason: body.reason.trim() });
  } else if (body.action === "complete_setup") {
    result = await db.rpc("platform_complete_business_setup", { p_business_id: businessId, p_actor_id: caller.id });
  } else if (body.action === "release_check") {
    if (typeof body.check !== "string" || typeof body.complete !== "boolean") return NextResponse.json({ error: "Check and confirmation required" }, { status: 400 });
    result = await db.rpc("platform_record_release_check", { p_business_id: businessId, p_actor_id: caller.id, p_check: body.check, p_complete: body.complete });
  } else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 });
  return NextResponse.json(result.data);
}
