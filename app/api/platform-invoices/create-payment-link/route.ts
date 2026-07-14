import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

// Thin proxy: the Yoco secret key never touches /app. Checkout creation
// happens in the platform-invoice-checkout edge function, same as every
// other Yoco checkout in this codebase (create-checkout is also an edge
// function, never a Next.js route) — this route only enforces the
// SUPER_ADMIN gate and forwards the call server-to-server.
export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || caller.role !== "SUPER_ADMIN") return NextResponse.json({ error: "SUPER_ADMIN required" }, { status: 403 });

  let body: { platform_invoice_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const invoiceId = String(body.platform_invoice_id || "");
  if (!invoiceId) return NextResponse.json({ error: "platform_invoice_id is required" }, { status: 400 });

  const db = adminClient();
  const { data, error } = await db.functions.invoke("platform-invoice-checkout", {
    body: { platform_invoice_id: invoiceId },
  });

  if (error) return NextResponse.json({ error: error.message || "Failed to create payment link" }, { status: 500 });
  if (data?.error) return NextResponse.json({ error: data.error }, { status: 400 });

  return NextResponse.json({ ok: true, ...data });
}
