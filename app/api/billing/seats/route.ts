import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req, { skipSubscriptionCheck: true });
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Number.isInteger(body.delta) || body.delta === 0 || Math.abs(body.delta) > 50) {
    return NextResponse.json({ error: "delta must be a non-zero integer (max ±50)" }, { status: 400 });
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // One transaction validates seats and records the fractional-rand adjustment
  // and audit entry. A concurrent request cannot leave a partial update.
  const { data, error } = await db.rpc("platform_change_seats", {
    p_business_id: caller.business_id, p_actor_id: caller.id, p_delta: body.delta,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  return NextResponse.json(data);
}
