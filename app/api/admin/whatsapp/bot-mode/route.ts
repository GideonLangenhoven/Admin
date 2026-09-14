import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { isCompleteBusinessHours, normalizeBusinessHours } from "@/app/lib/business-hours";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

const VALID_MODES = ["OFF", "ALWAYS_ON", "OUTSIDE_HOURS"] as const;

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = adminClient();
  const { data: biz, error } = await db
    .from("businesses")
    .select("whatsapp_bot_mode, whatsapp_bot_mode_changed_at, whatsapp_bot_mode_changed_by, business_hours, timezone")
    .eq("id", caller.business_id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!biz) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  // Compute current live status
  let currentlyActive = false;
  if (biz.whatsapp_bot_mode === "ALWAYS_ON") {
    currentlyActive = true;
  } else if (biz.whatsapp_bot_mode === "OUTSIDE_HOURS") {
    const { data: insideHours } = await db.rpc("is_inside_business_hours", { p_business_id: caller.business_id });
    currentlyActive = !insideHours;
  }

  return NextResponse.json({
    mode: biz.whatsapp_bot_mode,
    changedAt: biz.whatsapp_bot_mode_changed_at,
    changedBy: biz.whatsapp_bot_mode_changed_by,
    currentlyActive,
    businessHours: biz.business_hours,
    timezone: biz.timezone,
  });
}

export async function PUT(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  let body: { mode?: string; businessHours?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const mode = body.mode;
  const updates: Record<string, unknown> = {};
  const hasBusinessHours = Object.prototype.hasOwnProperty.call(body, "businessHours");
  const businessHours = hasBusinessHours ? normalizeBusinessHours(body.businessHours) : null;

  if (mode !== undefined && !VALID_MODES.includes(mode as any)) {
    return NextResponse.json({ error: "mode must be OFF, ALWAYS_ON, or OUTSIDE_HOURS" }, { status: 400 });
  }
  if (hasBusinessHours && !isCompleteBusinessHours(businessHours)) {
    return NextResponse.json({ error: "Business hours must include valid open and close times for every open day." }, { status: 400 });
  }
  if (!mode && !hasBusinessHours) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = adminClient();
  let effectiveMode = mode;

  // If OUTSIDE_HOURS, validate business_hours is set
  if (mode === "OUTSIDE_HOURS") {
    const { data: biz, error } = await db.from("businesses").select("business_hours").eq("id", caller.business_id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const candidateHours = businessHours ?? biz?.business_hours;
    if (!isCompleteBusinessHours(candidateHours)) {
      return NextResponse.json({ error: "Business hours must be configured before using OUTSIDE_HOURS mode." }, { status: 422 });
    }
  }

  if (mode) {
    updates.whatsapp_bot_mode = mode;
    updates.whatsapp_bot_mode_changed_at = new Date().toISOString();
    updates.whatsapp_bot_mode_changed_by = caller.id;
  }
  if (businessHours) {
    updates.business_hours = businessHours;
  }

  const { data: updated, error } = await db
    .from("businesses")
    .update(updates)
    .eq("id", caller.business_id)
    .select("whatsapp_bot_mode, business_hours")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  effectiveMode = updated?.whatsapp_bot_mode ?? mode;

  // Switching the bot back on has to release conversations a human took over,
  // or the operator sees "bot on" while every one of those threads stays
  // silent: wa-webhook returns without replying whenever status is HUMAN
  // (index.ts ~1113), and nothing else clears it. Only the customer typing
  // "menu" or an admin clicking Return to bot did — so a customer saying "Hi"
  // got nothing, forever. Found live on Cape Kayak 2026-08-18: four inbound
  // messages after the bot was re-enabled, all with bot_skipped_reason NULL
  // (the mode gate passed) and zero replies.
  let resumedConversations = 0;
  if (effectiveMode === "ALWAYS_ON" || effectiveMode === "OUTSIDE_HOURS") {
    const { data: resumed, error: resumeErr } = await db
      .from("conversations")
      .update({ status: "BOT", current_state: "IDLE", updated_at: new Date().toISOString() })
      .eq("business_id", caller.business_id)
      .eq("status", "HUMAN")
      .select("id");
    // Non-fatal: the mode change itself already succeeded, and reporting it as
    // a failure would push the operator to toggle again to no effect.
    if (resumeErr) console.error("bot-mode: failed to release HUMAN conversations", resumeErr.message);
    resumedConversations = resumed?.length ?? 0;
  }

  // Write audit log.
  // This wrote to `admin_audit_log` with columns admin_id/action/details —
  // no such table or columns exist, so PostgREST rejected it and changing the
  // bot mode, a privileged setting, was never audited at all.
  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: caller.business_id,
    action_type: "WHATSAPP_BOT_SETTINGS_CHANGE",
    target_entity: "businesses",
    target_id: caller.business_id,
    after_state: { mode: effectiveMode, business_hours_updated: hasBusinessHours, resumed_conversations: resumedConversations },
    source: "admin/whatsapp/bot-mode",
  });

  // Return current live status
  let currentlyActive = false;
  if (effectiveMode === "ALWAYS_ON") currentlyActive = true;
  else if (effectiveMode === "OUTSIDE_HOURS") {
    const { data: insideHours } = await db.rpc("is_inside_business_hours", { p_business_id: caller.business_id });
    currentlyActive = !insideHours;
  }

  return NextResponse.json({ ok: true, mode: effectiveMode, currentlyActive, resumedConversations, businessHours: updated?.business_hours ?? null });
}
