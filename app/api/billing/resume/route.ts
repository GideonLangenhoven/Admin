import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  const db = adminClient();

  const { data: sub } = await db.from("subscriptions")
    .select("id, status")
    .eq("business_id", caller.business_id)
    .maybeSingle();

  if (!sub) return NextResponse.json({ error: "No subscription found" }, { status: 404 });
  if (sub.status !== "PAUSED") return NextResponse.json({ error: "Subscription is not paused" }, { status: 400 });

  const { error } = await db.from("subscriptions").update({
    status: "ACTIVE",
    resumed_at: new Date().toISOString(),
  }).eq("id", sub.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("businesses").update({ subscription_status: "ACTIVE" }).eq("id", caller.business_id);

  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: caller.business_id,
    action_type: "BILLING_RESUMED",
    target_entity: "subscriptions",
    target_id: sub.id,
  });

  return NextResponse.json({ ok: true });
}
