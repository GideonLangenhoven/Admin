import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
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
  const { data: biz } = await db
    .from("businesses")
    .select("whatsapp_bot_mode, whatsapp_bot_mode_changed_at, whatsapp_bot_mode_changed_by, business_hours, timezone")
    .eq("id", caller.business_id)
    .single();

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

  let body: { mode?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const mode = body.mode;
  if (!mode || !VALID_MODES.includes(mode as any)) {
    return NextResponse.json({ error: "mode must be OFF, ALWAYS_ON, or OUTSIDE_HOURS" }, { status: 400 });
  }

  const db = adminClient();

  // If OUTSIDE_HOURS, validate business_hours is set
  if (mode === "OUTSIDE_HOURS") {
    const { data: biz } = await db.from("businesses").select("business_hours").eq("id", caller.business_id).single();
    if (!biz?.business_hours) {
      return NextResponse.json({ error: "Business hours must be configured before using OUTSIDE_HOURS mode. Set them in the General settings tab." }, { status: 422 });
    }
  }

  const { error } = await db.from("businesses").update({
    whatsapp_bot_mode: mode,
    whatsapp_bot_mode_changed_at: new Date().toISOString(),
    whatsapp_bot_mode_changed_by: caller.id,
  }).eq("id", caller.business_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Write audit log
  await db.from("admin_audit_log").insert({
    business_id: caller.business_id,
    admin_id: caller.id,
    action: "WHATSAPP_BOT_MODE_CHANGE",
    details: { mode, previous_mode: null },
  });

  // Return current live status
  let currentlyActive = false;
  if (mode === "ALWAYS_ON") currentlyActive = true;
  else if (mode === "OUTSIDE_HOURS") {
    const { data: insideHours } = await db.rpc("is_inside_business_hours", { p_business_id: caller.business_id });
    currentlyActive = !insideHours;
  }

  return NextResponse.json({ ok: true, mode, currentlyActive });
}
