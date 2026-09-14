import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

const VALID_METHODS = ["MANUAL", "EFT", "OTHER"];

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || caller.role !== "SUPER_ADMIN") return NextResponse.json({ error: "SUPER_ADMIN required" }, { status: 403 });

  let body: { platform_invoice_id?: string; method?: string; notes?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const invoiceId = String(body.platform_invoice_id || "");
  const method = String(body.method || "MANUAL").toUpperCase();
  if (!invoiceId) return NextResponse.json({ error: "platform_invoice_id is required" }, { status: 400 });
  if (!VALID_METHODS.includes(method)) return NextResponse.json({ error: "method must be one of " + VALID_METHODS.join(", ") }, { status: 400 });

  const db = adminClient();

  const { data, error } = await db.rpc("platform_record_invoice_payment", {
    p_invoice_id: invoiceId, p_actor_id: caller.id, p_method: method, p_notes: body.notes ? String(body.notes).slice(0,1000) : null,
  });
  return NextResponse.json(error ? { error: error.message } : data, { status: error ? 409 : 200 });
}
