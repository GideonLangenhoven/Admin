// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WA_ACCESS_TOKEN")!;
const WA_PHONE_ID = Deno.env.get("WA_PHONE_NUMBER_ID")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sendText(to: any, t: any) {
  await fetch("https://graph.facebook.com/v19.0/" + WA_PHONE_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + WA_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to, type: "text", text: { body: t } }),
  });
}

async function sendImage(to: any, url: any, caption: any) {
  await fetch("https://graph.facebook.com/v19.0/" + WA_PHONE_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + WA_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to, type: "image", image: { link: url, caption: caption } }),
  });
}


const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("OK", { status: 200, headers: CORS_HEADERS });
  try {
    const body = await req.json();
    const slotId = body.slot_id;
    const photoUrl = body.photo_url;
    const caption = body.caption || "Here are your photos from today's adventure!";

    const businessId = body.business_id;
    if (!slotId || !photoUrl) return new Response("Need slot_id and photo_url", { status: 400, headers: CORS_HEADERS });
    if (!businessId) return new Response(JSON.stringify({ error: "business_id required" }), { status: 400, headers: CORS_HEADERS });

    const bookings = await supabase.from("bookings").select("phone, customer_name, email")
      .eq("slot_id", slotId).eq("business_id", businessId).in("status", ["PAID", "COMPLETED"]);

    const customers = bookings.data || [];
    let sent = 0;

    for (let i = 0; i < customers.length; i++) {
      const c = customers[i];
      const firstName = (c.customer_name || "").split(" ")[0] || "there";

      if (photoUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        await sendImage(c.phone, photoUrl, "Hey " + firstName + "! " + caption);
      } else {
        await sendText(c.phone,
          "*Your trip photos are ready, " + firstName + "!*\n\n" +
          caption + "\n\n" + photoUrl + "\n\n" +
          "Loved it? Leave us a review: https://g.page/r/CWabH9a6u5DbEB0/review\n\n" +
          "Thanks for paddling with us!"
        );
      }
      sent++;
    }

    await supabase.from("trip_photos").insert({
      business_id: body.business_id, slot_id: slotId, photo_url: photoUrl, caption: caption, sent: true
    });

    return new Response(JSON.stringify({ sent: sent, customers: customers.length }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    console.error("PHOTO_ERR:", err);
    return new Response("Error", { status: 500, headers: CORS_HEADERS });
  }
});
