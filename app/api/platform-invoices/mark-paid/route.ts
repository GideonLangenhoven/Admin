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

  const { data: invoice, error: lookupErr } = await db.from("platform_invoices").select("id, status, business_id").eq("id", invoiceId).maybeSingle();
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === "PAID" || invoice.status === "PAID_MANUALLY") {
    return NextResponse.json({ error: "This invoice is already marked paid." }, { status: 400 });
  }

  const { error: updateErr } = await db.from("platform_invoices").update({
    status: "PAID_MANUALLY",
    paid_at: new Date().toISOString(),
    paid_method: method,
    paid_notes: body.notes ? String(body.notes) : null,
  }).eq("id", invoiceId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: invoice.business_id,
    action_type: "PLATFORM_INVOICE_MARKED_PAID_MANUALLY",
    target_entity: "platform_invoices",
    target_id: invoiceId,
    after_state: { method, notes: body.notes || null },
  });

  return NextResponse.json({ ok: true });
}
