import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerAdmin, isPrivilegedRole } from "../../../lib/api-auth";

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) {
    return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetId = String(body.admin_id || "").trim();
  if (!targetId) {
    return NextResponse.json({ error: "admin_id is required" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey || serviceKey.length < 40) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: target } = await admin
    .from("admin_users")
    .select("id, role, business_id, user_id")
    .eq("id", targetId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  if (target.role === "MAIN_ADMIN" || target.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "Cannot remove a Main Admin or Super Admin" }, { status: 403 });
  }

  if (caller.role !== "SUPER_ADMIN" && target.business_id !== caller.business_id) {
    return NextResponse.json({ error: "Cannot remove admins from another business" }, { status: 403 });
  }

  const { error: delErr } = await admin.from("admin_users").delete().eq("id", targetId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  if (target.user_id) {
    await admin.auth.admin.deleteUser(target.user_id).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
