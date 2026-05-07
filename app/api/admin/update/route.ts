import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { getCallerAdmin, isPrivilegedRole } from "../../../lib/api-auth";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey || serviceKey.length < 40) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action || "");
  if (!["update_permissions", "reset_password", "change_password"].includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  let db;
  try {
    db = adminClient();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server misconfigured" }, { status: 500 });
  }

  // --- update_permissions: MAIN_ADMIN/SUPER_ADMIN sets another admin's settings_permissions ---
  if (action === "update_permissions") {
    const caller = await getCallerAdmin(req);
    if (!caller || !isPrivilegedRole(caller.role)) {
      return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
    }

    const targetId = String(body.admin_id || "");
    const perms = body.permissions;
    if (!targetId || typeof perms !== "object") {
      return NextResponse.json({ error: "admin_id and permissions are required" }, { status: 400 });
    }

    const { data: target } = await db.from("admin_users").select("id, business_id").eq("id", targetId).maybeSingle();
    if (!target) return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    if (caller.role !== "SUPER_ADMIN" && target.business_id !== caller.business_id) {
      return NextResponse.json({ error: "Cannot modify admins from another business" }, { status: 403 });
    }

    const { error: updErr } = await db.from("admin_users").update({ settings_permissions: perms }).eq("id", targetId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // --- reset_password: privileged admin resets another admin's password ---
  if (action === "reset_password") {
    const caller = await getCallerAdmin(req);
    if (!caller || !isPrivilegedRole(caller.role)) {
      return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
    }

    const targetId = String(body.admin_id || "");
    const newPassword = String(body.password || "");
    if (!targetId || !newPassword) {
      return NextResponse.json({ error: "admin_id and password are required" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const { data: target } = await db.from("admin_users").select("id, business_id, user_id").eq("id", targetId).maybeSingle();
    if (!target) return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    if (caller.role !== "SUPER_ADMIN" && target.business_id !== caller.business_id) {
      return NextResponse.json({ error: "Cannot modify admins from another business" }, { status: 403 });
    }

    const hashed = sha256(newPassword);
    const { error: updErr } = await db.from("admin_users").update({
      password_hash: hashed,
      must_set_password: false,
      password_set_at: new Date().toISOString(),
    }).eq("id", targetId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    if (target.user_id) {
      await db.auth.admin.updateUserById(target.user_id, { password: newPassword }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  }

  // --- change_password: self-service (auth via email + current_password) ---
  if (action === "change_password") {
    const email = String(body.email || "").trim().toLowerCase();
    const currentPassword = String(body.current_password || "");
    const newPassword = String(body.new_password || "");
    if (!email || !currentPassword || !newPassword) {
      return NextResponse.json({ error: "email, current_password, and new_password are required" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const currentHash = sha256(currentPassword);
    const { data: user } = await db
      .from("admin_users")
      .select("id, user_id")
      .eq("email", email)
      .eq("password_hash", currentHash)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ error: "Incorrect email or current password" }, { status: 401 });
    }

    const newHash = sha256(newPassword);
    const { error: updErr } = await db.from("admin_users").update({
      password_hash: newHash,
      password_set_at: new Date().toISOString(),
      must_set_password: false,
      setup_token_hash: null,
      setup_token_expires_at: null,
    }).eq("id", user.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    if (user.user_id) {
      await db.auth.admin.updateUserById(user.user_id, { password: newPassword }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
}
