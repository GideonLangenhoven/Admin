import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerAdmin } from "../../../lib/api-auth";
import { requireSensitiveMfa } from "../../../lib/mfa-sensitive";

const TARGET_ROLES = ["OPERATOR", "ADMIN", "MAIN_ADMIN"];

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function explicitTarget(req: NextRequest, bodyTarget?: string | null) {
  const header = req.headers.get("x-admin-business-id")?.trim() || "";
  const target = bodyTarget || req.nextUrl.searchParams.get("business_id") || "";
  return header && header === target ? target : "";
}

async function requireSuperAdmin(req: NextRequest, bodyTarget?: string | null) {
  const caller = await getCallerAdmin(req);
  const target = explicitTarget(req, bodyTarget);
  if (!caller || caller.role !== "SUPER_ADMIN") return { error: "SUPER_ADMIN required", status: 403 } as const;
  if (!target || caller.business_id !== target) return { error: "Select the target business again", status: 403 } as const;
  return { caller, target } as const;
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = adminClient();
  const { data: business, error: businessError } = await db.from("businesses")
    .select("id, business_name, subscription_status").eq("id", auth.target).maybeSingle();
  if (businessError) return NextResponse.json({ error: "Target business could not be verified" }, { status: 503 });
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const { data: admins, error } = await db.from("admin_users")
    .select("id, email, name, role, suspended, read_only, user_id")
    .eq("business_id", auth.target)
    .in("role", TARGET_ROLES)
    .order("name");
  if (error) return NextResponse.json({ error: "Administrators could not be loaded" }, { status: 503 });

  const ids = (admins || []).map((admin) => admin.id);
  let recoveryRows: Array<{ admin_id: string; status: string; updated_at: string }> = [];
  if (ids.length) {
    const { data: rows, error: recoveryError } = await db.from("mfa_recovery_state")
      .select("admin_id, status, updated_at")
      .in("admin_id", ids);
    if (recoveryError) return NextResponse.json({ error: "Recovery status could not be loaded" }, { status: 503 });
    recoveryRows = rows || [];
  }
  const recoveryByAdmin = new Map(recoveryRows.map((row) => [row.admin_id, row.status.toLowerCase()]));

  return NextResponse.json({
    business: { id: business.id, name: business.business_name, status: business.subscription_status },
    admins: (admins || []).map((admin) => ({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      suspended: admin.suspended,
      readOnly: admin.read_only,
      authLinked: Boolean(admin.user_id),
      recoveryState: recoveryByAdmin.get(admin.id) || "none",
    })),
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const auth = await requireSuperAdmin(req, body.business_id);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const mfa = await requireSensitiveMfa(req, { allowedRoles: ["SUPER_ADMIN"], expectedActorId: auth.caller.id });
  if (!mfa.ok) return NextResponse.json({ error: mfa.message, code: mfa.code }, { status: mfa.status });

  const targetAdminId = String(body.admin_id || "");
  const reference = String(body.verification_reference || "").trim();
  if (body.verification_acknowledged !== true) {
    return NextResponse.json({ error: "Confirm that the operator's identity was verified" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/#-]{4,119}$/.test(reference)) {
    return NextResponse.json({ error: "Enter a 5 to 120 character verification ticket or call reference without personal details" }, { status: 400 });
  }

  const db = adminClient();
  const { data: business, error: businessError } = await db.from("businesses")
    .select("id, subscription_status").eq("id", auth.target).maybeSingle();
  if (businessError) return NextResponse.json({ error: "Target business could not be verified" }, { status: 503 });
  if (!business || !["ACTIVE", "TRIAL", "PAST_DUE"].includes(String(business.subscription_status || "").toUpperCase())) {
    return NextResponse.json({ error: "MFA recovery requires an active target business" }, { status: 403 });
  }

  const { data: target, error: targetError } = await db.from("admin_users")
    .select("id, email, name, role, business_id, suspended, read_only, user_id")
    .eq("id", targetAdminId)
    .eq("business_id", auth.target)
    .maybeSingle();
  if (targetError) return NextResponse.json({ error: "Target administrator could not be verified" }, { status: 503 });
  if (!target || !TARGET_ROLES.includes(target.role) || target.suspended || target.read_only || !target.user_id) {
    return NextResponse.json({ error: "Select an active, Auth-linked operator administrator" }, { status: 403 });
  }
  if (target.id === auth.caller.id || target.user_id === mfa.actor.userId) {
    return NextResponse.json({ error: "Super Admins cannot reset their own MFA here" }, { status: 403 });
  }

  const { data: authUserData, error: authUserError } = await db.auth.admin.getUserById(target.user_id);
  const authUser = authUserData?.user;
  if (authUserError || !authUser || authUser.id !== target.user_id || String(authUser.email || "").toLowerCase() !== String(target.email || "").toLowerCase()) {
    return NextResponse.json({ error: "The administrator and Auth identity do not match" }, { status: 409 });
  }

  const listed = await db.auth.admin.mfa.listFactors({ userId: target.user_id });
  if (listed.error || !listed.data) return NextResponse.json({ error: "Target MFA factors could not be listed. Nothing was changed." }, { status: 503 });
  const factors = listed.data.factors || [];

  const { data: operationId, error: beginError } = await db.rpc("begin_mfa_recovery", {
    p_actor_id: auth.caller.id,
    p_admin_id: target.id,
    p_business_id: auth.target,
    p_verification_reference: reference,
    p_requested_factor_count: factors.length,
  });
  if (beginError || !operationId) {
    if (beginError?.code === "55P03") {
      return NextResponse.json({ error: "Another recovery is already processing this administrator. Wait briefly, then refresh." }, { status: 409 });
    }
    return NextResponse.json({ error: "Recovery audit could not be saved. No MFA factors were removed." }, { status: 503 });
  }

  let deletedCount = 0;
  let failedCount = 0;
  for (const factor of factors) {
    try {
      const removed = await db.auth.admin.mfa.deleteFactor({ userId: target.user_id, id: factor.id });
      if (removed.error) failedCount += 1;
      else deletedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  const remainingResult = await db.auth.admin.mfa.listFactors({ userId: target.user_id });
  const remainingCount = remainingResult.error || !remainingResult.data ? null : remainingResult.data.factors.length;
  const completed = failedCount === 0 && remainingCount === 0;
  const { error: outcomeAuditError } = await db.rpc("finish_mfa_recovery", {
    p_operation_id: operationId,
    p_actor_id: auth.caller.id,
    p_admin_id: target.id,
    p_business_id: auth.target,
    p_completed: completed,
    p_deleted_count: deletedCount,
    p_failed_count: failedCount,
    p_remaining_count: remainingCount,
  });

  if (outcomeAuditError) {
    return NextResponse.json({
      error: "MFA factors were processed, but the completion audit failed. Recovery remains pending; retry to finalize it.",
      deletedCount,
      failedCount,
      remainingCount,
      retryRequired: true,
    }, { status: 503 });
  }
  if (!completed) {
    return NextResponse.json({
      error: "Some MFA factors could not be removed. Recovery remains pending; retry after checking Auth availability.",
      deletedCount,
      failedCount,
      remainingCount,
      retryRequired: true,
    }, { status: 207 });
  }
  return NextResponse.json({
    ok: true,
    deletedCount,
    remainingCount: 0,
    retryRequired: false,
    message: "MFA recovery completed. The operator must sign in and enroll a new authenticator before protected settings can change.",
  });
}
