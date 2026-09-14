import { withSentry } from "../_shared/sentry.ts";
// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getTenantByBusinessId, sendWhatsappTextForTenant, getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";
import { requireAuth, canAccessBusiness } from "../_shared/auth.ts";

function getCors(req?: any) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

Deno.serve(withSentry("send-whatsapp-text", async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: getCors(req) });
  let auth;
  try { auth = await requireAuth(req); }
  catch { return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: getCors(req) }); }
  try {
    const body = await req.json();
    const to = body.to;
    const message = body.message;
    let businessId = String(body.business_id || "");
    const bookingId = String(body.booking_id || "");
    if (!to || !message) return new Response(JSON.stringify({ error: "Missing to or message" }), { status: 400, headers: getCors(req) });

    const supabase = createServiceClient();

    if (bookingId) {
      let query = supabase.from("bookings").select("business_id").eq("id", bookingId);
      if (!auth.isServiceRole && auth.role !== "SUPER_ADMIN") query = query.eq("business_id", auth.businessId);
      const bookingRes = await query.maybeSingle();
      if (!bookingRes.data || (businessId && businessId !== bookingRes.data.business_id)) {
        return new Response(JSON.stringify({ error: "Booking not accessible" }), { status: 403, headers: getCors(req) });
      }
      businessId = String(bookingRes.data.business_id);
    }
    if (!businessId) return new Response(JSON.stringify({ error: "business_id or booking_id is required" }), { status: 400, headers: getCors(req) });
    if (!canAccessBusiness(auth, businessId)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: getCors(req) });
    }

    const tenant = await getTenantByBusinessId(supabase, businessId);
    // Support template fallback for outbound messages outside the 24h window
    const templateFallback = body.template_fallback
      ? { name: body.template_fallback.name, params: body.template_fallback.params || [], language: body.template_fallback.language }
      : undefined;
    const result = await sendWhatsappTextForTenant(tenant, to, message, templateFallback);
    // Surface which channel actually delivered (free-form text vs the approved
    // template used when the 24h window was closed) so callers can log routing.
    const channel = (result && typeof result === "object" && "channel" in result) ? (result as { channel: string }).channel : "text";
    return new Response(JSON.stringify({ ok: true, channel, via_template: channel === "template" }), { status: 200, headers: getCors(req) });
  } catch (err) {
    // Return 200 with ok:false (not 500) so callers can read the outcome and
    // route to an alternative channel (e.g. email) rather than treating a
    // failed WhatsApp send as a transport error.
    console.error("send-whatsapp-text error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }), { status: 200, headers: getCors(req) });
  }
}));
