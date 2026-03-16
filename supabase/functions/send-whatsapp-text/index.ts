import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getTenantByBusinessId, sendWhatsappTextForTenant } from "../_shared/tenant.ts";

var ALLOWED_ORIGINS = ["https://admin.capekayak.co.za", "https://caepweb-admin.vercel.app", "https://book.capekayak.co.za", "https://capekayak.co.za", "https://bookingtours.co.za", "https://www.bookingtours.co.za", "http://localhost:3000", "http://localhost:3001"];

function getCors(req?: any) {
  var origin = req?.headers?.get("origin") || "";
  var allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });
  try {
    var body = await req.json();
    var to = body.to;
    var message = body.message;
    var businessId = String(body.business_id || "");
    var bookingId = String(body.booking_id || "");
    if (!to || !message) return new Response(JSON.stringify({ error: "Missing to or message" }), { status: 400, headers: getCors(req) });

    var supabase = createServiceClient();

    if (!businessId && bookingId) {
      var bookingRes = await supabase.from("bookings").select("business_id").eq("id", bookingId).maybeSingle();
      businessId = String(bookingRes.data?.business_id || "");
    }
    if (!businessId) return new Response(JSON.stringify({ error: "business_id or booking_id is required" }), { status: 400, headers: getCors(req) });

    var tenant = await getTenantByBusinessId(supabase, businessId);
    await sendWhatsappTextForTenant(tenant, to, message);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: getCors(req) });
  } catch (err) {
    console.error("send-whatsapp-text error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: getCors(req) });
  }
});
