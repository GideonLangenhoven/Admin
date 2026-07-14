// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Creates a Yoco checkout for a platform_invoices row using BookingTours'
// OWN Yoco merchant account (PLATFORM_YOCO_SECRET_KEY) — a completely
// different merchant context from any tenant's own Yoco keys used in
// create-checkout. Invoked only by the SUPER_ADMIN-gated Next.js route
// app/api/platform-invoices/create-payment-link (server-to-server with the
// service-role key), never directly by a browser, so there's no separate
// caller-auth check here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!;
const PLATFORM_YOCO_SECRET_KEY = Deno.env.get("PLATFORM_YOCO_SECRET_KEY") || "";
const ADMIN_APP_URL = Deno.env.get("ADMIN_APP_URL") || "https://admin.bookingtours.co.za";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function ok(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}

function fail(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (!PLATFORM_YOCO_SECRET_KEY) return fail("PLATFORM_YOCO_SECRET_KEY not configured", 503);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON");
  }

  const platformInvoiceId = String(body.platform_invoice_id || "");
  if (!platformInvoiceId) return fail("platform_invoice_id required");

  const { data: invoice, error: invErr } = await db.from("platform_invoices")
    .select("id, business_id, amount_zar, status")
    .eq("id", platformInvoiceId)
    .maybeSingle();
  if (invErr) return fail(invErr.message, 500);
  if (!invoice) return fail("Invoice not found", 404);
  if (invoice.status === "PAID" || invoice.status === "PAID_MANUALLY") return fail("Invoice is already paid");
  if (Number(invoice.amount_zar) <= 0) return fail("Invoice amount must be greater than zero");

  const redirectUrl = ADMIN_APP_URL + "/super-admin";

  const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
    method: "POST",
    headers: { Authorization: "Bearer " + PLATFORM_YOCO_SECRET_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: Math.round(Number(invoice.amount_zar) * 100),
      currency: "ZAR",
      successUrl: redirectUrl,
      cancelUrl: redirectUrl,
      failureUrl: redirectUrl,
      metadata: { type: "PLATFORM_INVOICE", platform_invoice_id: invoice.id, business_id: invoice.business_id },
    }),
  });

  const yocoData = await yocoRes.json().catch(() => ({}));
  if (!yocoRes.ok || !yocoData?.id || !yocoData?.redirectUrl) {
    return fail("YOCO_CHECKOUT_FAILED: " + (yocoData?.message || yocoData?.error?.message || "Unable to create checkout"), 502);
  }

  await db.from("platform_invoices").update({
    yoco_checkout_id: yocoData.id,
    yoco_payment_link_url: yocoData.redirectUrl,
  }).eq("id", invoice.id);

  return ok({ yoco_checkout_id: yocoData.id, yoco_payment_link_url: yocoData.redirectUrl });
});
