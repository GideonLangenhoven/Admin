import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (caller?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Super Admin required" }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.platform_invoice_id || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 1000) return NextResponse.json({ error: "Invoice and a reason of 5–1000 characters required" }, { status: 400 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("platform_void_invoice", { p_invoice_id: body.platform_invoice_id, p_actor_id: caller.id, p_reason: body.reason });
  return NextResponse.json(error ? { error: error.message } : data, { status: error ? 409 : 200 });
}
