// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BUSINESS_ID = Deno.env.get("BUSINESS_ID")!;

async function sendReminderEmail(b: any, tourName: string, startTime: string) {
  try {
    await fetch(SUPABASE_URL + "/functions/v1/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
      body: JSON.stringify({
        type: "REMINDER",
        data: { email: b.email, customer_name: b.customer_name, tour_name: tourName, start_time: startTime, qty: b.qty },
      }),
    });
  } catch (e) { console.error("REM_EMAIL_ERR:", e); }
}

Deno.serve(async () => {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const ago2h = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const rem = await supabase.from("bookings")
      .select("id, phone, email, qty, customer_name, tour_id, slot_id, slots(start_time), tours(name, duration_minutes)")
      .eq("business_id", BUSINESS_ID).eq("status", "PAID").eq("reminder_queued", false)
      .lt("slots.start_time", in24h.toISOString()).gt("slots.start_time", now.toISOString());

    const reminders = (rem.data || []).filter(function(b: any) { return b.slots && b.slots.start_time; });
    console.log("REMINDER: " + reminders.length);

    for (let i = 0; i < reminders.length; i++) {
      const b = reminders[i];
      const bslot = (b as any).slots; const btour = (b as any).tours;
      const fmtStart = new Date(bslot.start_time).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
      const msg = "\u{1F6F6} *Reminder: You're paddling tomorrow!*\n\n\u{1F4CB} " + (btour?.name || "Tour") + "\n\u{1F4C5} " + fmtStart + "\n\u{1F465} " + b.qty + " people\n\n\u{1F4CD} *Meeting Point:* Three Anchor Bay, Beach Road, Sea Point\nArrive 15 min early.\n\n\u{1F392} *Bring:* Sunscreen, hat, towel, water bottle\n\nSee you on the water! \u{1F30A}";
      const reminderTime = new Date(new Date(bslot.start_time)); reminderTime.setDate(reminderTime.getDate() - 1); reminderTime.setHours(18, 0, 0, 0);
      if (reminderTime < now) reminderTime = now;
      await supabase.from("outbox").insert({ business_id: BUSINESS_ID, booking_id: b.id, phone: b.phone, message_type: "REMINDER_24H", message_body: msg, scheduled_for: reminderTime.toISOString() });
      await supabase.from("bookings").update({ reminder_queued: true }).eq("id", b.id);
      if (b.email) await sendReminderEmail(b, btour?.name || "Tour", fmtStart);
    }

    const ty = await supabase.from("bookings")
      .select("id, phone, email, customer_name, tour_id, slot_id, slots(start_time), tours(name, duration_minutes)")
      .eq("business_id", BUSINESS_ID).in("status", ["PAID", "COMPLETED"]).eq("thankyou_queued", false);

    const thanks = (ty.data || []).filter(function(b: any) {
      if (!b.slots || !b.slots.start_time) return false;
      const dur = (b as any).tours?.duration_minutes || 90;
      return new Date(new Date(b.slots.start_time).getTime() + dur * 60 * 1000) < ago2h;
    });
    console.log("THANKYOU: " + thanks.length);

    for (let j = 0; j < thanks.length; j++) {
      const tb = thanks[j]; const ttour = (tb as any).tours;
      const firstName = (tb.customer_name || "").split(" ")[0] || "there";
      const tyMsg = "\u{1F31F} *Thanks for paddling with us, " + firstName + "!*\n\nWe hope you loved the " + (ttour?.name || "tour") + "! \u{1F6F6}\n\n\u2B50 Leave a review: https://g.page/r/CWabH9a6u5DbEB0/review\n\nWant to paddle again? Type *menu* and hit *Book Again* \u{1F6F6}\n\nBook again anytime \u2014 type *menu* \u{1F30A}";
      await supabase.from("outbox").insert({ business_id: BUSINESS_ID, booking_id: tb.id, phone: tb.phone, message_type: "THANK_YOU", message_body: tyMsg, scheduled_for: now.toISOString() });
      await supabase.from("bookings").update({ thankyou_queued: true, status: "COMPLETED" }).eq("id", tb.id);
    }

    return new Response(JSON.stringify({ reminders: reminders.length, thanks: thanks.length }), { status: 200 });
  } catch (err) { console.error("ERR:", err); return new Response("Error", { status: 500 }); }
});
