import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canManageAdmin, getCallerAdmin, isPrivilegedRole } from "../../../lib/api-auth";

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) {
    return NextResponse.json({ error: "Main Admin or Super Admin required" }, { status: 403 });
  }
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof body.admin_id !== "string"
    || typeof body.name !== "string" || typeof body.email !== "string"
    || typeof body.expected_email !== "string" || (body.phone != null && typeof body.phone !== "string")) {
    return NextResponse.json({ error: "Name, email and administrator are required" }, { status: 400 });
  }
  const name = body.name.trim(), email = body.email.trim().toLowerCase();
  const phone = body.phone?.trim() || null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.admin_id) || !name || name.length > 120
    || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || email.endsWith("@guides.bookingtours.co.za")
    || (phone && (phone.length > 40 || !/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, "").length < 5))) {
    return NextResponse.json({ error: "Enter a name, a valid email and an optional phone number" }, { status: 400 });
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const columns = "id, name, email, phone, role, business_id, user_id, must_set_password, invite_sent_at, setup_token_claim_id, setup_token_claimed_at";
  const { data: target, error: lookupError } = await db.from("admin_users").select(columns).eq("id", body.admin_id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Could not load this administrator" }, { status: 502 });
  if (!target) return NextResponse.json({ error: "Administrator not found" }, { status: 404 });
  if (!canManageAdmin(caller, target) || target.business_id !== caller.business_id) {
    return NextResponse.json({ error: "Cannot edit this administrator in the selected business" }, { status: 403 });
  }
  if (target.email !== body.expected_email) {
    return NextResponse.json({ error: "This email changed elsewhere. Refresh and try again." }, { status: 409 });
  }
  const emailChanged = email !== target.email;
  if (emailChanged && target.setup_token_claim_id && Date.parse(target.setup_token_claimed_at) > Date.now() - 300_000) {
    return NextResponse.json({ error: "Password setup is in progress. Try again in a few minutes." }, { status: 409 });
  }
  const { data: conflict, error: conflictError } = await db.from("admin_users").select("id")
    .ilike("email", email.replace(/[%_\\]/g, "\\$&")).neq("id", target.id).maybeSingle();
  if (conflictError) return NextResponse.json({ error: "Could not check this email. Try again." }, { status: 502 });
  if (conflict) return NextResponse.json({ error: "This email is already used by another administrator" }, { status: 409 });

  if (emailChanged && target.user_id) {
    const { error } = await db.auth.admin.updateUserById(target.user_id, { email, email_confirm: true });
    if (error) {
      const duplicate = error.code === "email_exists" || error.code === "user_already_exists";
      return NextResponse.json({ error: duplicate ? "This email is already used by another sign-in account" : "Could not change the sign-in email. Try again." }, { status: duplicate ? 409 : 502 });
    }
  }
  const { data: saved, error: saveError } = await db.from("admin_users")
    .update({ name, email, phone }).eq("id", target.id)
    .eq("email", emailChanged && target.user_id ? email : target.email)
    .select("id, name, email, phone, must_set_password, invite_sent_at").maybeSingle();
  if (saveError || !saved) {
    // The Auth transaction already synchronized email. Report that partial
    // result honestly; never roll it back over a concurrent administrator edit.
    const { data: current } = await db.from("admin_users").select("id, name, email, phone, must_set_password, invite_sent_at").eq("id", target.id).maybeSingle();
    return NextResponse.json({
      error: emailChanged && target.user_id
        ? "The sign-in email changed, but the remaining details could not be saved. Check the current email and try again."
        : saveError?.code === "23505" ? "This email is already used by another account"
        : "Contact details could not be saved. Refresh and try again.",
      admin: current,
      self: target.id === caller.id,
    }, { status: 409 });
  }
  const { error: auditError } = await db.from("audit_logs").insert({
    actor_id: caller.id, business_id: target.business_id, action_type: "ADMIN_CONTACT_UPDATED",
    target_entity: "admin_users", target_id: target.id,
    before_state: { name: target.name, email: target.email, phone: target.phone },
    after_state: { name, email, phone },
  });
  if (auditError) console.error("ADMIN_CONTACT_AUDIT_FAILED", target.id, auditError.code);
  return NextResponse.json({ ok: true, admin: saved, self: target.id === caller.id });
}
