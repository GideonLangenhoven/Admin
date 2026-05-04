import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerAdmin, isPrivilegedRole } from "../../lib/api-auth";

var VALID_CHANNELS = ["VIATOR", "GETYOURGUIDE"];

function serviceClient() {
  var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  var key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey && serviceKey.length > 40 && !serviceKey.includes("your-")) key = serviceKey;
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  var caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) {
    return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
  }
  var businessId = req.nextUrl.searchParams.get("business_id");
  var channel = (req.nextUrl.searchParams.get("channel") || "VIATOR").toUpperCase();
  if (!businessId) return NextResponse.json({ error: "business_id required" }, { status: 400 });
  if (!VALID_CHANNELS.includes(channel)) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  if (caller.role !== "SUPER_ADMIN" && caller.business_id !== businessId) {
    return NextResponse.json({ error: "Not your business" }, { status: 403 });
  }

  var supabase = serviceClient();
  var { data } = await supabase
    .from("ota_integrations")
    .select("id, channel, enabled, test_mode, last_sync_at, last_sync_status, last_sync_error, api_key_encrypted, api_secret_encrypted, webhook_secret_encrypted")
    .eq("business_id", businessId)
    .eq("channel", channel)
    .maybeSingle();

  return NextResponse.json({
    channel,
    configured: !!data?.api_key_encrypted,
    secret_configured: !!data?.api_secret_encrypted,
    webhook_configured: !!data?.webhook_secret_encrypted,
    enabled: data?.enabled ?? false,
    test_mode: data?.test_mode ?? true,
    last_sync_at: data?.last_sync_at ?? null,
    last_sync_status: data?.last_sync_status ?? null,
    last_sync_error: data?.last_sync_error ?? null,
  });
}

export async function POST(req: NextRequest) {
  var caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) {
    return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
  }

  var encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!encryptionKey || encryptionKey.length < 32) {
    return NextResponse.json({ error: "SETTINGS_ENCRYPTION_KEY not configured" }, { status: 500 });
  }

  var body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  var { business_id, action, channel, api_key, api_secret, webhook_secret, test_mode, enabled } = body;
  channel = (channel || "VIATOR").toUpperCase();
  if (!business_id) return NextResponse.json({ error: "business_id required" }, { status: 400 });
  if (!VALID_CHANNELS.includes(channel)) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  if (caller.role !== "SUPER_ADMIN" && caller.business_id !== business_id) {
    return NextResponse.json({ error: "Not your business" }, { status: 403 });
  }

  var supabase = serviceClient();

  if (action === "save_credentials") {
    if (!api_key?.trim()) return NextResponse.json({ error: "API key / Client ID is required" }, { status: 400 });
    var { error: rpcErr } = await supabase.rpc("set_ota_credentials", {
      p_business_id: business_id,
      p_key: encryptionKey,
      p_channel: channel,
      p_api_key: api_key.trim(),
      p_api_secret: api_secret?.trim() || null,
      p_webhook_secret: webhook_secret?.trim() || null,
      p_test_mode: test_mode !== false,
    });
    if (rpcErr) return NextResponse.json({ error: "Failed to save: " + rpcErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle_enabled") {
    var { error } = await supabase
      .from("ota_integrations")
      .update({ enabled: enabled === true, updated_at: new Date().toISOString() })
      .eq("business_id", business_id)
      .eq("channel", channel);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle_test_mode") {
    var { error: tmErr } = await supabase
      .from("ota_integrations")
      .update({ test_mode: test_mode === true, updated_at: new Date().toISOString() })
      .eq("business_id", business_id)
      .eq("channel", channel);
    if (tmErr) return NextResponse.json({ error: tmErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
