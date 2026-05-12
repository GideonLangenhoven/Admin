// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function getCors(req: Request) {
  const allowed = getAdminAppOrigins();
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin, allowed) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    const body = await req.json();
    const { action, message, target_group, slot_ids, send_email, send_whatsapp, business_id } = body;

    if (!business_id) {
      return new Response(JSON.stringify({ error: "business_id is required" }), { status: 400, headers: getCors(req) });
    }

    if (action !== "broadcast_targeted" || !message) {
      return new Response(JSON.stringify({ error: "Invalid parameters" }), { status: 400, headers: getCors(req) });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Default limit
    const limit = 500;

    // Get bookings scoped to this business
    let query = supabase.from("bookings")
      .select("id, customer_name, email, phone, slot_id, status")
      .eq("business_id", business_id)
      .in("status", ["PAID", "CONFIRMED"]);

    if (target_group === "SLOT" && Array.isArray(slot_ids) && slot_ids.length > 0) {
      query = query.in("slot_id", slot_ids);
    }

    const { data: bookings, error: bErr } = await query.limit(limit);

    if (bErr || !bookings) {
      return new Response(JSON.stringify({ error: "Could not fetch bookings" }), { status: 500, headers: getCors(req) });
    }

    let waSent = 0;
    let emailSent = 0;
    let totalSent = 0;
    const errors: string[] = [];

    for (const b of bookings) {
      let sentToCustomer = false;
      const firstName = (b.customer_name || "Guest").split(" ")[0];
      const parsedMessage = message.replace(/\{name\}/gi, firstName);

      // WhatsApp
      if (send_whatsapp && b.phone) {
        try {
          const waRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ to: b.phone, message: parsedMessage, business_id })
          });
          if (waRes.ok) { waSent++; sentToCustomer = true; }
        } catch (e) {
          errors.push(`WA to ${b.phone}: ${e}`);
        }
      }

      // Email
      if (send_email && b.email) {
        try {
          const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              type: "BROADCAST",
              business_id,
              data: {
                email: b.email,
                customer_name: b.customer_name,
                message: parsedMessage
              }
            })
          });
          if (emailRes.ok) {
            emailSent++;
            sentToCustomer = true;
          } else {
            const errText = await emailRes.text();
            errors.push(`Email err [${emailRes.status}]: ${errText}`);
          }
        } catch (e) {
          errors.push(`Email to ${b.email}: ${e}`);
        }
      }

      if (sentToCustomer) totalSent++;
    }

    // Log broadcast
    if (totalSent > 0) {
      await supabase.from("broadcasts").insert({
        business_id,
        message: message,
        target_group: target_group || "CUSTOM",
        sent_count: totalSent
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      wa_sent: waSent,
      email_sent: emailSent,
      total_customers: totalSent,
      errors: errors.length > 0 ? errors : undefined
    }), { status: 200, headers: getCors(req) });

  } catch (err: any) {
    console.error("BROADCAST ERR:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: getCors(req) });
  }
});
