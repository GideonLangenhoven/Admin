import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerAdmin, isPrivilegedRole, canManageAdmin } from "../../../lib/api-auth";
import { setAdminAuthPassword } from "../../../lib/admin-password";

function hasRecentPasswordVerification(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    return Array.isArray(payload.amr) && payload.amr.some((method: { method?: string; timestamp?: number }) => {
      const verifiedAt = Number(method.timestamp) * 1000;
      return method.method === "password" && Number.isFinite(verifiedAt)
        && verifiedAt <= Date.now() + 30_000 && verifiedAt >= Date.now() - 5 * 60 * 1000;
    });
  } catch {
    return false;
  }
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
  if (!["update_permissions", "update_role", "reset_password", "change_password", "set_suspended"].includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  let db;
  try {
    db = adminClient();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server misconfigured" }, { status: 500 });
  }

  if (action === "set_suspended") {
    const caller = await getCallerAdmin(req, { skipSubscriptionCheck: true });
    if (caller?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Super Admin required" }, { status: 403 });
    if (typeof body.suspended !== "boolean" || !body.admin_id) return NextResponse.json({ error: "Administrator and suspension state required" }, { status: 400 });
    const { data: target } = await db.from("admin_users").select("business_id").eq("id", body.admin_id).maybeSingle();
    if (!target || target.business_id !== caller.business_id) return NextResponse.json({ error: "Select this administrator's business first" }, { status: 403 });
    const { data, error } = await db.rpc("platform_suspend_admin", { p_admin_id: body.admin_id, p_actor_id: caller.id, p_suspended: body.suspended });
    return NextResponse.json(error ? { error: error.message } : data, { status: error ? 409 : 200 });
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

    const { data: target } = await db.from("admin_users").select("id, role, business_id").eq("id", targetId).maybeSingle();
    if (!target) return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    if (!canManageAdmin(caller, target)) {
      return NextResponse.json({ error: "Cannot modify this administrator" }, { status: 403 });
    }

    const { error: updErr } = await db.from("admin_users").update({ settings_permissions: perms }).eq("id", targetId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // --- update_role: privileged admin promotes/demotes another admin between
  //     regular admin ("ADMIN", what /api/admin/add creates) and MAIN_ADMIN.
  //     SUPER_ADMIN is platform-level and is never granted or removed here. ---
  if (action === "update_role") {
    const caller = await getCallerAdmin(req);
    if (!caller || !isPrivilegedRole(caller.role)) {
      return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
    }

    const targetId = String(body.admin_id || "");
    const newRole = String(body.role || "");
    if (!targetId || (newRole !== "ADMIN" && newRole !== "MAIN_ADMIN")) {
      return NextResponse.json({ error: "admin_id and role ('ADMIN' or 'MAIN_ADMIN') are required" }, { status: 400 });
    }
    if (targetId === caller.id) {
      return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
    }

    const { data: target } = await db.from("admin_users").select("id, role, business_id").eq("id", targetId).maybeSingle();
    if (!target) return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    if (!canManageAdmin(caller, target)) {
      return NextResponse.json({ error: "Cannot modify this administrator" }, { status: 403 });
    }
    if (target.role === "SUPER_ADMIN") {
      return NextResponse.json({ error: "Super Admin role cannot be changed here" }, { status: 403 });
    }
    if (target.role === newRole) return NextResponse.json({ ok: true }); // no-op

    // Lockout guard: a demotion must not leave the business with no full-access
    // admin (MAIN_ADMIN or SUPER_ADMIN). SUPER_ADMIN counts — a tenant owned
    // only by a platform Super Admin is still fully manageable.
    if (target.role === "MAIN_ADMIN" && newRole === "ADMIN") {
      const { count } = await db.from("admin_users")
        .select("*", { count: "exact", head: true })
        .eq("business_id", target.business_id)
        .eq("suspended", false)
        .eq("role", "MAIN_ADMIN")
        .neq("id", targetId);
      if ((count ?? 0) < 1) {
        return NextResponse.json({ error: "This is the last admin with full access. Promote another admin first." }, { status: 400 });
      }
    }

    const { error: updErr } = await db.from("admin_users").update({ role: newRole }).eq("id", targetId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    await db.from("audit_logs").insert({
      actor_id: caller.id,
      business_id: target.business_id,
      action_type: newRole === "MAIN_ADMIN" ? "ADMIN_ROLE_PROMOTED" : "ADMIN_ROLE_DEMOTED",
      target_entity: "admin_users",
      target_id: targetId,
      after_state: { from: target.role, to: newRole },
    });
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

    const { data: target } = await db.from("admin_users").select("id, email, role, business_id, user_id").eq("id", targetId).maybeSingle();
    if (!target) return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    if (!canManageAdmin(caller, target)) {
      return NextResponse.json({ error: "Cannot modify this administrator" }, { status: 403 });
    }

    let authUserId: string;
    try { authUserId = await setAdminAuthPassword(db, target, newPassword); }
    catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update the sign-in password. Please try again." }, { status: 502 });
    }
    const { error: updErr } = await db.from("admin_users").update({
      user_id: authUserId,
      password_hash: null,
      must_set_password: false,
      password_set_at: new Date().toISOString(),
    }).eq("id", targetId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  // --- change_password: the browser first reauthenticates with Supabase Auth,
  //     then sends that newly issued verified session here. ---
  if (action === "change_password") {
    const newPassword = String(body.new_password || "");
    if (!newPassword) return NextResponse.json({ error: "new_password is required" }, { status: 400 });
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    const caller = await getCallerAdmin(req, { skipSubscriptionCheck: true });
    if (!caller || !hasRecentPasswordVerification(req)) return NextResponse.json({ error: "Sign in with your current password again" }, { status: 401 });
    const { data: user } = await db.from("admin_users").select("id, email, user_id").eq("id", caller.id).maybeSingle();
    if (!user?.user_id) return NextResponse.json({ error: "Account setup is incomplete" }, { status: 409 });

    let authUserId: string;
    try { authUserId = await setAdminAuthPassword(db, user, newPassword); }
    catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update the sign-in password. Please try again." }, { status: 502 });
    }
    const { error: updErr } = await db.from("admin_users").update({
      user_id: authUserId,
      password_hash: null,
      password_set_at: new Date().toISOString(),
      must_set_password: false,
      setup_token_hash: null,
      setup_token_expires_at: null,
    }).eq("id", user.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
}
