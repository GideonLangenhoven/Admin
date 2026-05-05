// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WA_ACCESS_TOKEN")!;
const WA_PHONE_ID = Deno.env.get("WA_PHONE_NUMBER_ID")!;
const BUSINESS_ID = Deno.env.get("BUSINESS_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sendText(to: any, text: any) {
  await fetch("https://graph.facebook.com/v19.0/" + WA_PHONE_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + WA_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to, type: "text", text: { body: text } }),
  });
}

function fmtTime(iso: any) {
  return new Date(iso).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
}

// TASK 1: Release expired holds
async function releaseExpiredHolds() {
  const now = new Date().toISOString();
  const r = await supabase.from("holds").select("id, booking_id, slot_id, status").eq("status", "ACTIVE").lt("expires_at", now);
  const holds = r.data || [];
  console.log("CRON: Found " + holds.length + " expired holds");

  for (let i = 0; i < holds.length; i++) {
    const h = holds[i];
    // Get booking info
    const br = await supabase.from("bookings").select("qty, phone, status, slot_id").eq("id", h.booking_id).single();
    if (!br.data) continue;
    const bk = br.data;

    // Only release if booking is still HELD or PENDING
    if (bk.status !== "HELD" && bk.status !== "PENDING") {
      await supabase.from("holds").update({ status: "RELEASED" }).eq("id", h.id);
      continue;
    }

    // Release hold
    await supabase.from("holds").update({ status: "RELEASED" }).eq("id", h.id);

    // Update booking to EXPIRED
    await supabase.from("bookings").update({ status: "EXPIRED", cancellation_reason: "Hold expired - payment not received" }).eq("id", h.booking_id);

    // Release held seats
    const slotId = h.slot_id || bk.slot_id;
    if (slotId) {
      const sr = await supabase.from("slots").select("held").eq("id", slotId).single();
      if (sr.data) {
        await supabase.from("slots").update({ held: Math.max(0, sr.data.held - bk.qty) }).eq("id", slotId);
      }
    }

    // Notify customer
    await sendText(bk.phone, "\u23F0 Your booking hold has expired as payment wasn\u2019t received within 15 minutes.\n\nNo worries \u2014 reply *menu* to book again!");

    await supabase.from("logs").insert({ business_id: BUSINESS_ID, booking_id: h.booking_id, event: "hold_expired", payload: { hold_id: h.id } });
    console.log("CRON: Released hold " + h.id + " for booking " + h.booking_id);
  }
  return holds.length;
}

// TASK 2: Send 24-hour reminders
async function sendReminders() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStart = new Date(tomorrow);
  tomorrowStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(23, 59, 59, 999);

  // Find PAID bookings for tomorrow that haven't been reminded
  const r = await supabase.from("bookings")
    .select("id, customer_name, phone, email, qty, slots(start_time)")
    .eq("status", "PAID")
    .eq("business_id", BUSINESS_ID);

  const bookings = (r.data || []).filter(function(b: any) {
    if (!b.slots || !b.slots.start_time) return false;
    const st = new Date(b.slots.start_time);
    return st >= tomorrowStart && st <= tomorrowEnd;
  });

  console.log("CRON: Found " + bookings.length + " bookings to remind");

  for (let i = 0; i < bookings.length; i++) {
    const b = bookings[i];
    // Check if already reminded
    const lr = await supabase.from("logs").select("id").eq("booking_id", b.id).eq("event", "reminder_sent").single();
    if (lr.data) continue;

    await sendText(b.phone,
      "\u{1F6F6} *Reminder: Kayak tour tomorrow!*\n\n" +
      "Hey " + (b.customer_name || "").split(" ")[0] + "!\n\n" +
      "\u{1F4C5} " + fmtTime(b.slots.start_time) + "\n" +
      "\u{1F465} " + b.qty + " people\n\n" +
      "\u{1F4CD} *Meeting Point:*\nThree Anchor Bay, Beach Road, Sea Point\n\u2192 Arrive 15 min early\n\n" +
      "\u{1F392} *Don\u2019t forget:*\nSunscreen, hat, towel, water\n\n" +
      "Need to change plans? Reply *reschedule* or *cancel*.\n\nSee you tomorrow! \u{1F30A}"
    );

    await supabase.from("logs").insert({ business_id: BUSINESS_ID, booking_id: b.id, event: "reminder_sent", payload: { phone: b.phone } });
    console.log("CRON: Reminded " + b.phone + " for booking " + b.id);
  }
  return bookings.length;
}

// TASK 3: Post-trip thank you
async function sendThankYous() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStart = new Date(yesterday);
  yesterdayStart.setHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterday);
  yesterdayEnd.setHours(23, 59, 59, 999);

  const r = await supabase.from("bookings")
    .select("id, customer_name, phone, qty, slots(start_time)")
    .eq("status", "PAID")
    .eq("business_id", BUSINESS_ID);

  const bookings = (r.data || []).filter(function(b: any) {
    if (!b.slots || !b.slots.start_time) return false;
    const st = new Date(b.slots.start_time);
    return st >= yesterdayStart && st <= yesterdayEnd;
  });

  console.log("CRON: Found " + bookings.length + " trips to thank");

  for (let i = 0; i < bookings.length; i++) {
    const b = bookings[i];
    const lr = await supabase.from("logs").select("id").eq("booking_id", b.id).eq("event", "thankyou_sent").single();
    if (lr.data) continue;

    // Mark as completed
    await supabase.from("bookings").update({ status: "COMPLETED" }).eq("id", b.id);

    await sendText(b.phone,
      "\u{1F6F6} *Thanks for paddling with us, " + (b.customer_name || "").split(" ")[0] + "!*\n\n" +
      "We hope you had an amazing time on the water! \u{1F30A}\n\n" +
      "\u2B50 *Loved it?* We\u2019d really appreciate a review:\nhttps://g.page/r/capekayakadventures/review\n\n" +
      "Book again anytime \u2014 reply *menu*!\n\nRemember: loyal paddlers get 10% off after 2 trips in a month! \u{1F31F}"
    );

    await supabase.from("logs").insert({ business_id: BUSINESS_ID, booking_id: b.id, event: "thankyou_sent", payload: { phone: b.phone } });
    console.log("CRON: Thanked " + b.phone);
  }
  return bookings.length;
}

Deno.serve(async (req: any) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  try {
    const body: any = {};
    try { body = await req.json(); } catch (e) {}
    const task = body.task || "all";

    console.log("CRON: Running task=" + task);

    const results: any = {};
    if (task === "all" || task === "holds") {
      results.holds_released = await releaseExpiredHolds();
    }
    if (task === "all" || task === "reminders") {
      results.reminders_sent = await sendReminders();
    }
    if (task === "all" || task === "thankyou") {
      results.thankyous_sent = await sendThankYous();
    }

    console.log("CRON: Done", JSON.stringify(results));
    return new Response(JSON.stringify(results), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("CRON_ERROR:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 200 });
  }
});
