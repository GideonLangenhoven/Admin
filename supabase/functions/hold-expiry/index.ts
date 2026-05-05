// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WA_TOKEN = Deno.env.get("WA_ACCESS_TOKEN")!;
const WA_PHONE_ID = Deno.env.get("WA_PHONE_NUMBER_ID")!;
const BUSINESS_ID = Deno.env.get("BUSINESS_ID")!;

async function sendText(to: any, t: any) {
  await fetch("https://graph.facebook.com/v19.0/" + WA_PHONE_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + WA_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to, type: "text", text: { body: t } }),
  });
}

Deno.serve(async () => {
  try {
    const r = await supabase.from("holds").select("id, booking_id, slot_id, bookings(id, phone, qty, status)").eq("status", "ACTIVE").lt("expires_at", new Date().toISOString());
    const holds = r.data || [];
    console.log("HOLD_EXPIRY: " + holds.length + " expired");
    for (let i = 0; i < holds.length; i++) {
      const hold = holds[i];
      const bk = (hold as any).bookings;
      if (!bk) continue;
      if (bk.status === "PAID" || bk.status === "COMPLETED") { await supabase.from("holds").update({ status: "CONVERTED" }).eq("id", hold.id); continue; }
      await supabase.from("holds").update({ status: "EXPIRED" }).eq("id", hold.id);
      await supabase.from("bookings").update({ status: "EXPIRED", cancellation_reason: "Hold expired", cancelled_at: new Date().toISOString() }).eq("id", hold.booking_id);
      if (hold.slot_id) {
        const sr = await supabase.from("slots").select("held").eq("id", hold.slot_id).single();
        if (sr.data) await supabase.from("slots").update({ held: Math.max(0, Number(sr.data.held || 0) - Number(bk.qty || 0)) }).eq("id", hold.slot_id);
      }
      await supabase.from("conversations").update({ current_state: "IDLE", state_data: {}, updated_at: new Date().toISOString() }).eq("phone", bk.phone).eq("business_id", BUSINESS_ID);
      if (bk.phone) await sendText(bk.phone, "\u23F0 Your booking hold has expired as payment was not received.\n\nNo worries \u2014 type *menu* to book again!");
      await supabase.from("logs").insert({ business_id: BUSINESS_ID, booking_id: hold.booking_id, event: "hold_expired", payload: { hold_id: hold.id } });
    }
    return new Response(JSON.stringify({ expired: holds.length }), { status: 200 });
  } catch (err) { console.error("ERR:", err); return new Response("Error", { status: 500 }); }
});
