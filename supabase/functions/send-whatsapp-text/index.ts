// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getTenantByBusinessId, sendWhatsappTextForTenant, getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";

function getCors(req?: any) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });
  try {
    const body = await req.json();
    const to = body.to;
    const message = body.message;
    let businessId = String(body.business_id || "");
    const bookingId = String(body.booking_id || "");
    if (!to || !message) return new Response(JSON.stringify({ error: "Missing to or message" }), { status: 400, headers: getCors(req) });

    const supabase = createServiceClient();

    if (!businessId && bookingId) {
      const bookingRes = await supabase.from("bookings").select("business_id").eq("id", bookingId).maybeSingle();
      businessId = String(bookingRes.data?.business_id || "");
    }
    if (!businessId) return new Response(JSON.stringify({ error: "business_id or booking_id is required" }), { status: 400, headers: getCors(req) });

    const tenant = await getTenantByBusinessId(supabase, businessId);
    // Support template fallback for outbound messages outside the 24h window
    const templateFallback = body.template_fallback
      ? { name: body.template_fallback.name, params: body.template_fallback.params || [], language: body.template_fallback.language }
      : undefined;
    await sendWhatsappTextForTenant(tenant, to, message, templateFallback);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: getCors(req) });
  } catch (err) {
    console.error("send-whatsapp-text error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: getCors(req) });
  }
});
