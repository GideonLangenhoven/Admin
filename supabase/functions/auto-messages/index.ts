import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, formatTenantDateTime, getBusinessDisplayName, getTenantByBusinessId, getTenantByBusinessId as getTenantContext, sendWhatsappTextForTenant } from "../_shared/tenant.ts";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
var SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
var db = createServiceClient();

function getHeaders(origin?: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function localDateKey(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}

function addDaysToToday(timezone: string, days: number) {
  var now = new Date();
  var currentLocal = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(now);
  var [year, month, day] = currentLocal.split("-").map(Number);
  var utcNoon = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12, 0, 0));
  utcNoon.setUTCDate(utcNoon.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(utcNoon);
}

async function alreadySent(bookingId: string, type: string) {
  var { data } = await db.from("auto_messages").select("id").eq("booking_id", bookingId).eq("type", type).limit(1);
  return (data || []).length > 0;
}

async function logSent(businessId: string, bookingId: string, phone: string, type: string) {
  await db.from("auto_messages").insert({ business_id: businessId, booking_id: bookingId, phone, type });
}

async function getBusinesses() {
  var { data, error } = await db.from("businesses").select("id");
  if (error) throw error;
  return data || [];
}

async function sendRemindersForBusiness(businessId: string) {
  var tenant = await getTenantContext(db, businessId);
  var timezone = tenant.business.timezone || "UTC";
  var tomorrowKey = addDaysToToday(timezone, 1);
  var brandName = getBusinessDisplayName(tenant.business);
  var meetingPoint = tenant.business.directions || brandName;

  var { data: bookings } = await db.from("bookings")
    .select("id, business_id, customer_name, phone, qty, tours(name), slots(start_time)")
    .eq("business_id", businessId)
    .in("status", ["PAID", "CONFIRMED"])
    .not("phone", "is", null);

  var sent = 0;
  for (var i = 0; i < (bookings || []).length; i++) {
    var booking: any = bookings?.[i];
    var startTime = booking?.slots?.start_time;
    if (!startTime || !booking.phone) continue;
    if (localDateKey(startTime, timezone) !== tomorrowKey) continue;
    if (await alreadySent(booking.id, "REMINDER")) continue;

    var firstName = String(booking.customer_name || "").split(" ")[0] || "there";
    var message =
      "Hi " + firstName + ", reminder for tomorrow.\n\n" +
      (booking?.tours?.name || "Your booking") + "\n" +
      formatTenantDateTime(tenant.business, startTime) + "\n" +
      booking.qty + " guest" + (Number(booking.qty || 0) === 1 ? "" : "s") + "\n\n" +
      "Meeting point: " + meetingPoint + "\n" +
      "Please arrive 15 minutes early.";

    try {
      await sendWhatsappTextForTenant(tenant, booking.phone, message);
      await logSent(businessId, booking.id, booking.phone, "REMINDER");
      sent++;
    } catch (error) {
      console.error("REMINDER_SEND_ERR", businessId, booking.id, error);
    }
  }

  return sent;
}

async function sendIndemnityEmailsForBusiness(businessId: string) {
  var tenant = await getTenantByBusinessId(db, businessId);
  var timezone = tenant.business.timezone || "UTC";
  var tomorrowKey = addDaysToToday(timezone, 1);

  var { data: bookings } = await db.from("bookings")
    .select("id, business_id, customer_name, phone, email, qty, waiver_status, waiver_token, tours(name), slots(start_time)")
    .eq("business_id", businessId)
    .in("status", ["PAID", "CONFIRMED"])
    .not("email", "is", null);

  var sent = 0;
  for (var i = 0; i < (bookings || []).length; i++) {
    var booking: any = bookings?.[i];
    var startTime = booking?.slots?.start_time;
    if (!startTime || !booking.email) continue;
    if (booking.waiver_status === "SIGNED") continue;
    if (localDateKey(startTime, timezone) !== tomorrowKey) continue;
    if (await alreadySent(booking.id, "INDEMNITY")) continue;

    var ref = String(booking.id || "").substring(0, 8).toUpperCase();
    try {
      await fetch(SUPABASE_URL + "/functions/v1/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY },
        body: JSON.stringify({
          type: "INDEMNITY",
          data: {
            booking_id: booking.id,
            business_id: booking.business_id,
            waiver_status: booking.waiver_status,
            waiver_token: booking.waiver_token,
            email: booking.email,
            customer_name: booking.customer_name || "Guest",
            ref,
            tour_name: booking?.tours?.name || "Experience",
            start_time: formatTenantDateTime(tenant.business, startTime),
            qty: booking.qty,
          },
        }),
      });
      await logSent(businessId, booking.id, booking.phone || "", "INDEMNITY");
      sent++;
    } catch (error) {
      console.error("INDEMNITY_EMAIL_ERR", businessId, booking.id, error);
    }
  }

  return sent;
}

async function sendReviewRequestsForBusiness(businessId: string) {
  var tenant = await getTenantByBusinessId(db, businessId);
  var brandName = getBusinessDisplayName(tenant.business);
  var now = Date.now();
  var twoHoursAgo = now - 2 * 60 * 60 * 1000;
  var sixHoursAgo = now - 6 * 60 * 60 * 1000;

  var { data: bookings } = await db.from("bookings")
    .select("id, business_id, customer_name, phone, tours(name, duration_minutes), slots(start_time)")
    .eq("business_id", businessId)
    .in("status", ["PAID", "CONFIRMED", "COMPLETED"])
    .not("phone", "is", null);

  var sent = 0;
  for (var i = 0; i < (bookings || []).length; i++) {
    var booking: any = bookings?.[i];
    var startTime = booking?.slots?.start_time;
    if (!startTime || !booking.phone) continue;
    var endTime = new Date(startTime).getTime() + Number(booking?.tours?.duration_minutes || 90) * 60 * 1000;
    if (endTime > twoHoursAgo || endTime < sixHoursAgo) continue;
    if (await alreadySent(booking.id, "REVIEW_REQUEST")) continue;

    await db.from("bookings").update({ status: "COMPLETED" }).eq("id", booking.id);

    var firstName = String(booking.customer_name || "").split(" ")[0] || "there";
    var message =
      "Hi " + firstName + ", thanks for joining " + brandName + " today.\n\n" +
      "We’d love a quick review if you have a moment. Your feedback helps our team a lot.";

    try {
      await sendWhatsappTextForTenant(tenant, booking.phone, message);
      await logSent(businessId, booking.id, booking.phone, "REVIEW_REQUEST");
      sent++;
    } catch (error) {
      console.error("REVIEW_REQUEST_ERR", businessId, booking.id, error);
    }
  }

  return sent;
}

async function sendReEngagementForBusiness(businessId: string) {
  var tenant = await getTenantByBusinessId(db, businessId);
  var brandName = getBusinessDisplayName(tenant.business);
  var now = new Date();
  var threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  var fourMonthsAgo = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

  var { data: oldBookings } = await db.from("bookings")
    .select("phone, customer_name")
    .eq("business_id", businessId)
    .in("status", ["COMPLETED", "PAID"])
    .lt("created_at", threeMonthsAgo.toISOString())
    .gt("created_at", fourMonthsAgo.toISOString())
    .not("phone", "is", null);

  var sent = 0;
  var seenPhones = new Set<string>();
  for (var i = 0; i < (oldBookings || []).length; i++) {
    var booking: any = oldBookings?.[i];
    if (!booking.phone || seenPhones.has(booking.phone)) continue;
    seenPhones.add(booking.phone);

    var { data: recent } = await db.from("bookings").select("id")
      .eq("phone", booking.phone)
      .eq("business_id", businessId)
      .gt("created_at", threeMonthsAgo.toISOString())
      .limit(1);
    if ((recent || []).length > 0) continue;

    var { data: alreadyEngaged } = await db.from("auto_messages").select("id")
      .eq("phone", booking.phone)
      .eq("business_id", businessId)
      .eq("type", "RE_ENGAGE")
      .gt("created_at", fourMonthsAgo.toISOString())
      .limit(1);
    if ((alreadyEngaged || []).length > 0) continue;

    var firstName = String(booking.customer_name || "").split(" ")[0] || "there";
    var message = "Hi " + firstName + ", it’s been a while since your last trip with " + brandName + ". We’d love to welcome you back.";

    try {
      await sendWhatsappTextForTenant(tenant, booking.phone, message);
      await db.from("auto_messages").insert({ business_id: businessId, phone: booking.phone, type: "RE_ENGAGE" });
      sent++;
    } catch (error) {
      console.error("RE_ENGAGE_ERR", businessId, booking.phone, error);
    }
  }

  return sent;
}

async function autoExpireBookingsForBusiness(businessId: string) {
  var tenant = await getTenantByBusinessId(db, businessId);
  var bookingSiteUrl = tenant.business.booking_site_url || "";
  var nowIso = new Date().toISOString();

  var { data: expiredBookings } = await db.from("bookings")
    .select("id, business_id, customer_name, phone, email, qty, total_amount, tours(name), slots(start_time)")
    .eq("business_id", businessId)
    .in("status", ["PENDING", "PENDING PAYMENT", "HELD"])
    .not("payment_deadline", "is", null)
    .lt("payment_deadline", nowIso);

  var cancelled = 0;
  for (var i = 0; i < (expiredBookings || []).length; i++) {
    var booking: any = expiredBookings?.[i];
    if (await alreadySent(booking.id, "AUTO_CANCEL")) continue;

    await db.from("bookings").update({
      status: "CANCELLED",
      cancellation_reason: "Auto-cancelled: payment deadline expired",
      cancelled_at: nowIso,
    }).eq("id", booking.id);

    if (booking.email) {
      try {
        await fetch(SUPABASE_URL + "/functions/v1/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY },
          body: JSON.stringify({
            type: "CANCELLATION",
            data: {
              business_id: businessId,
              email: booking.email,
              customer_name: booking.customer_name || "Guest",
              ref: String(booking.id || "").substring(0, 8).toUpperCase(),
              tour_name: booking?.tours?.name || "Experience",
              start_time: booking?.slots?.start_time ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "TBC",
              reason: "Payment deadline expired",
            },
          }),
        });
      } catch (error) {
        console.error("AUTO_CANCEL_EMAIL_ERR", businessId, booking.id, error);
      }
    }

    if (booking.phone) {
      try {
        await sendWhatsappTextForTenant(
          tenant,
          booking.phone,
          "Your booking " + String(booking.id || "").substring(0, 8).toUpperCase() + " was released because the payment deadline passed." +
            (bookingSiteUrl ? "\n\nYou can create a new booking here: " + bookingSiteUrl : ""),
        );
      } catch (error) {
        console.error("AUTO_CANCEL_WA_ERR", businessId, booking.id, error);
      }
    }

    await logSent(businessId, booking.id, booking.phone || "", "AUTO_CANCEL");
    cancelled++;
  }

  return cancelled;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getHeaders(req.headers.get("origin")) });

  try {
    var body = await req.json().catch(() => ({}));
    var action = String(body.action || "all");
    var businesses = await getBusinesses();
    var results: Record<string, number> = {
      reminders: 0,
      indemnity: 0,
      reviews: 0,
      re_engage: 0,
      auto_expire: 0,
    };

    for (var i = 0; i < businesses.length; i++) {
      var businessId = String(businesses[i].id || "");
      if (!businessId) continue;
      if (action === "all" || action === "reminders") results.reminders += await sendRemindersForBusiness(businessId);
      if (action === "all" || action === "indemnity") results.indemnity += await sendIndemnityEmailsForBusiness(businessId);
      if (action === "all" || action === "reviews") results.reviews += await sendReviewRequestsForBusiness(businessId);
      if (action === "all" || action === "re_engage") results.re_engage += await sendReEngagementForBusiness(businessId);
      if (action === "all" || action === "auto_expire") results.auto_expire += await autoExpireBookingsForBusiness(businessId);
    }

    return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: getHeaders(req.headers.get("origin")) });
  } catch (error) {
    console.error("AUTO_MESSAGES_ERR", error);
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: getHeaders(req.headers.get("origin")) });
  }
});
