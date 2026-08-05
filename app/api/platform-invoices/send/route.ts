import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { HIDDEN_SUPERADMIN_EMAILS } from "@/app/lib/hidden-superadmin-emails";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || caller.role !== "SUPER_ADMIN") return NextResponse.json({ error: "SUPER_ADMIN required" }, { status: 403 });

  let body: { platform_invoice_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const invoiceId = String(body.platform_invoice_id || "");
  if (!invoiceId) return NextResponse.json({ error: "platform_invoice_id is required" }, { status: 400 });

  const db = adminClient();

  const { data: invoice, error: invErr } = await db.from("platform_invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === "PAID" || invoice.status === "PAID_MANUALLY") {
    return NextResponse.json({ error: "This invoice is already paid, so there is nothing to send." }, { status: 400 });
  }

  const { data: business } = await db.from("businesses").select("business_name, billing_admin_user_id").eq("id", invoice.business_id).maybeSingle();

  // Billing goes to ONE person: the operator's chosen billing contact if set,
  // otherwise the first admin account ever created on the business (any role).
  let target: { email: string; name: string } | null = null;
  if (business?.billing_admin_user_id) {
    const { data: chosen } = await db.from("admin_users")
      .select("email, name")
      .eq("id", business.billing_admin_user_id)
      .eq("business_id", invoice.business_id)
      .maybeSingle();
    if (chosen && !HIDDEN_SUPERADMIN_EMAILS.includes(chosen.email)) target = chosen;
  }
  if (!target) {
    const { data: recipients, error: recErr } = await db.from("admin_users")
      .select("email, name")
      .eq("business_id", invoice.business_id)
      .order("created_at", { ascending: true });
    if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 });
    target = (recipients || []).find((a) => !HIDDEN_SUPERADMIN_EMAILS.includes(a.email)) || null;
  }
  if (!target) {
    return NextResponse.json({ error: "This business has no admins to email." }, { status: 400 });
  }

  // An outstanding-invoice email must always carry a Pay Now link — create the
  // Yoco checkout up front if the invoice doesn't have one yet.
  let payUrl = invoice.yoco_payment_link_url as string | null;
  if (!payUrl) {
    const { data: linkData, error: linkErr } = await db.functions.invoke("platform-invoice-checkout", {
      body: { platform_invoice_id: invoiceId },
    });
    if (linkErr || linkData?.error || !linkData?.yoco_payment_link_url) {
      return NextResponse.json({ error: "Couldn't create the Yoco payment link: " + (linkData?.error || linkErr?.message || "unknown error") + ". The invoice was not sent." }, { status: 502 });
    }
    payUrl = linkData.yoco_payment_link_url;
  }

  const emailData = {
    business_name: business?.business_name || "",
    platform_invoice_number: invoice.invoice_number,
    period_start: invoice.period_start,
    period_end: invoice.period_end,
    plan_name: invoice.plan_name,
    amount_zar: invoice.amount_zar,
    email_overage_count: invoice.email_overage_count,
    email_overage_zar: invoice.email_overage_zar,
    ai_overage_count: invoice.ai_overage_count,
    ai_overage_zar: invoice.ai_overage_zar,
    pro_rated: invoice.pro_rated,
    pause_note: invoice.pause_note,
    yoco_payment_link_url: payUrl,
  };

  const { error: sendErr } = await db.functions.invoke("send-email", {
    body: { type: "PLATFORM_INVOICE_OUTSTANDING", data: { ...emailData, email: target.email, name: target.name } },
  });
  if (sendErr) {
    console.error("PLATFORM_INVOICE_SEND_ERR invoice=" + invoiceId + " to=" + target.email + ": " + sendErr.message);
    return NextResponse.json({ error: "Email send failed: " + sendErr.message }, { status: 502 });
  }

  const { error: updateErr } = await db.from("platform_invoices").update({
    sent_at: new Date().toISOString(),
    status: invoice.status === "DRAFT" ? "SENT" : invoice.status,
  }).eq("id", invoiceId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, sent_to: [target.email] });
}
