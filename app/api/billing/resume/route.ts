import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req, { skipSubscriptionCheck: true });
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("platform_change_business_status", {
    p_business_id: caller.business_id, p_actor_id: caller.id, p_status: "ACTIVE", p_expected_status: "PAUSED",
  });
  return NextResponse.json(error ? { error: error.message } : data, { status: error ? 409 : 200 });
}
