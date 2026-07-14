import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

// Bank-detail encrypt/decrypt happens only in the platform-bank-details edge
// function (SETTINGS_ENCRYPTION_KEY stays out of /app entirely) — this route
// is a SUPER_ADMIN-gated proxy plus the plain (non-sensitive) logo_url field.
export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || caller.role !== "SUPER_ADMIN") return NextResponse.json({ error: "SUPER_ADMIN required" }, { status: 403 });

  const db = adminClient();
  const { data: settings, error } = await db.from("platform_settings").select("logo_url").eq("id", true).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: bank, error: bankErr } = await db.functions.invoke("platform-bank-details", { body: { action: "get" } });
  if (bankErr) return NextResponse.json({ error: bankErr.message || "Failed to load bank details" }, { status: 500 });

  return NextResponse.json({ logo_url: settings?.logo_url || null, bank: bank || {} });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || caller.role !== "SUPER_ADMIN") return NextResponse.json({ error: "SUPER_ADMIN required" }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const db = adminClient();

  if ("logo_url" in body) {
    const { error } = await db.from("platform_settings").update({ logo_url: body.logo_url || null, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.bank) {
    const { account_owner, account_number, account_type, bank_name, branch_code } = body.bank;
    const { data, error } = await db.functions.invoke("platform-bank-details", {
      body: { action: "set", account_owner, account_number, account_type, bank_name, branch_code },
    });
    if (error) return NextResponse.json({ error: error.message || "Failed to save bank details" }, { status: 500 });
    if (data?.error) return NextResponse.json({ error: data.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
