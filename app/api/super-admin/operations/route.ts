import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req, { skipSubscriptionCheck: true });
  if (caller?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Super Admin required" }, { status: 403 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("platform_operations_snapshot", { p_actor_id: caller.id });
  return NextResponse.json(error ? { error: "Could not load operations. Refresh or contact support." } : data, { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
