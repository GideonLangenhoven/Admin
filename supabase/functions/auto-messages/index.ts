// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, formatTenantDateTime, getBusinessDisplayName, getTenantByBusinessId, getTenantByBusinessId as getTenantContext, resolveManageBookingsUrl, sendWhatsappTextForTenant } from "../_shared/tenant.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createServiceClient();

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
  const now = new Date();
  const currentLocal = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(now);
  const [year, month, day] = currentLocal.split("-").map(Number);
  const utcNoon = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12, 0, 0));
  utcNoon.setUTCDate(utcNoon.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(utcNoon);
}

async function alreadySent(bookingId: string, type: string) {
  const { data } = await db.from("auto_messages").select("id").eq("booking_id", bookingId).eq("type", type).limit(1);
  return (data || []).length > 0;
}

async function logSent(businessId: string, bookingId: string, phone: string, type: string): Promise<boolean> {
  // Use upsert with onConflict to atomically prevent duplicate sends.
  // If the row already exists (same booking_id + type), this is a no-op and returns false.
  const { data, error } = await db.from("auto_messages")
    .upsert({ business_id: businessId, booking_id: bookingId, phone, type }, { onConflict: "booking_id,type", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("LOG_SENT_ERR", bookingId, type, error.message);
    return false;
  }
  // If ignoreDuplicates took effect, data will be empty (row already existed)
  return (data || []).length > 0;
}

async function getBusinesses() {
  const { data, error } = await db.from("businesses").select("id");
  if (error) throw error;
  return data || [];
}

async function sendRemindersForBusiness(businessId: string) {
  const tenant = await getTenantContext(db, businessId);
  const timezone = tenant.business.timezone || "UTC";
  const tomorrowKey = addDaysToToday(timezone, 1);
  const brandName = getBusinessDisplayName(tenant.business);
  const meetingPoint = tenant.business.directions || "";
  const whatToBring = (tenant.business as any).what_to_bring || "";
  const activityVerbPast = (tenant.business as any).activity_verb_past || "joining us";
  const locationPhrase = (tenant.business as any).location_phrase || "";

  const { data: bookings } = await db.from("bookings")
    .select("id, business_id, customer_name, phone, qty, tours(name), slots(start_time)")
    .eq("business_id", businessId)
    .in("status", ["PAID", "CONFIRMED"])
    .not("phone", "is", null);

  let sent = 0;
  for (let i = 0; i < (bookings || []).length; i++) {
    const booking: any = bookings?.[i];
    const startTime = booking?.slots?.start_time;
    if (!startTime || !booking.phone) continue;
    if (localDateKey(startTime, timezone) !== tomorrowKey) continue;
    if (await alreadySent(booking.id, "REMINDER")) continue;

    const firstName = String(booking.customer_name || "").split(" ")[0] || "there";
    const myBookingsUrl = resolveManageBookingsUrl(tenant.business);
    const tourNameR = booking?.tours?.name || "Your booking";
    const timeStr = formatTenantDateTime(tenant.business, startTime);
    const qtyStr = String(booking.qty);
    const message =
      "Reminder \u{1F4C5}\n\n" +
      "Hi " + firstName + ", your trip is tomorrow!\n\n" +
      tourNameR + "\n" +
      timeStr + "\n" +
      qtyStr + " guest" + (Number(booking.qty || 0) === 1 ? "" : "s") + "\n\n" +
      (meetingPoint ? "\u{1F4CD} Meeting point: " + meetingPoint + "\n" + "Please arrive 15 minutes early.\n\n" : "") +
      (whatToBring ? "\u{1F392} Bring: " + whatToBring + "\n\n" : "") +
      "Need to make changes? " + myBookingsUrl;

    try {
      await sendWhatsappTextForTenant(tenant, booking.phone, message, {
        name: "booking_reminder",
        params: [
          firstName,
          tourNameR,
          timeStr,
          qtyStr,
          meetingPoint,
        ],
      });
      await logSent(businessId, booking.id, booking.phone, "REMINDER");
      sent++;
    } catch (error) {
      console.error("REMINDER_SEND_ERR", businessId, booking.id, error);
    }
  }

  return sent;
}

async function sendIndemnityEmailsForBusiness(businessId: string) {
  const tenant = await getTenantByBusinessId(db, businessId);
  const timezone = tenant.business.timezone || "UTC";
  const tomorrowKey = addDaysToToday(timezone, 1);

  const { data: bookings } = await db.from("bookings")
    .select("id, business_id, customer_name, phone, email, qty, waiver_status, waiver_token, tours(name), slots(start_time)")
    .eq("business_id", businessId)
    .in("status", ["PAID", "CONFIRMED"])
    .not("email", "is", null);

  let sent = 0;
  for (let i = 0; i < (bookings || []).length; i++) {
    const booking: any = bookings?.[i];
    const startTime = booking?.slots?.start_time;
    if (!startTime || !booking.email) continue;
    if (booking.waiver_status === "SIGNED") continue;
    if (localDateKey(startTime, timezone) !== tomorrowKey) continue;
    if (await alreadySent(booking.id, "INDEMNITY")) continue;

    const ref = String(booking.id || "").substring(0, 8).toUpperCase();
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
  const tenant = await getTenantByBusinessId(db, businessId);
  const brandName = getBusinessDisplayName(tenant.business);
  const now = Date.now();
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  const sixHoursAgo = now - 6 * 60 * 60 * 1000;

  const { data: bookings } = await db.from("bookings")
    .select("id, business_id, tour_id, customer_name, phone, tours(name, duration_minutes), slots(start_time)")
    .eq("business_id", businessId)
    .in("status", ["PAID", "CONFIRMED", "COMPLETED"])
    .not("phone", "is", null);

  let sent = 0;
  for (let i = 0; i < (bookings || []).length; i++) {
    const booking: any = bookings?.[i];
    const startTime = booking?.slots?.start_time;
    if (!startTime || !booking.phone) continue;
    const endTime = new Date(startTime).getTime() + Number(booking?.tours?.duration_minutes || 90) * 60 * 1000;
    if (endTime > twoHoursAgo || endTime < sixHoursAgo) continue;
    if (await alreadySent(booking.id, "REVIEW_REQUEST")) continue;

    await db.from("bookings").update({ status: "COMPLETED" }).eq("id", booking.id).in("status", ["PAID", "CONFIRMED"]);

    const firstName = String(booking.customer_name || "").split(" ")[0] || "there";
    const customerName = String(booking.customer_name || "").trim() || null;

    // Create a PENDING review row with a unique submission token
    const submissionToken = crypto.randomUUID();
    const tourId = booking.tour_id || null;
    await db.from("reviews").insert({
      business_id: businessId,
      tour_id: tourId,
      booking_id: booking.id,
      source: "NATIVE",
      status: "PENDING",
      submission_token: submissionToken,
      reviewer_name: customerName,
    });

    const bookingSiteUrl = tenant.business.booking_site_url || resolveManageBookingsUrl(tenant.business).replace("/my-bookings", "");
    const reviewUrl = bookingSiteUrl + "/review/" + submissionToken;
    const message =
      "Hi " + firstName + ", thanks for joining " + brandName + " today! \u{1F30A}\n\n" +
      "We\u2019d love a quick review if you have a moment \u2014 it really helps others find us and means the world to our small team.\n\n" +
      "\u{2B50} Leave a review: " + reviewUrl;

    try {
      await sendWhatsappTextForTenant(tenant, booking.phone, message, {
        name: "review_request",
        params: [firstName],
      });
      await logSent(businessId, booking.id, booking.phone, "REVIEW_REQUEST");
      sent++;
    } catch (error) {
      console.error("REVIEW_REQUEST_ERR", businessId, booking.id, error);
    }
  }

  return sent;
}

async function sendReviewRemindersForBusiness(businessId: string) {
  const tenant = await getTenantByBusinessId(db, businessId);
  const brandName = getBusinessDisplayName(tenant.business);
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reviews } = await db.from("reviews")
    .select("id, booking_id, submission_token, reviewer_name, bookings(phone, customer_name)")
    .eq("business_id", businessId)
    .eq("status", "PENDING")
    .eq("source", "NATIVE")
    .is("reminder_sent_at", null)
    .not("submission_token", "is", null)
    .lt("created_at", sevenDaysAgo)
    .gt("created_at", fourteenDaysAgo);

  let sent = 0;
  for (let i = 0; i < (reviews || []).length; i++) {
    const review: any = reviews?.[i];
    const phone = review?.bookings?.phone;
    if (!phone || !review.submission_token) continue;

    const firstName = String(review?.bookings?.customer_name || review?.reviewer_name || "").split(" ")[0] || "there";
    const bookingSiteUrl = tenant.business.booking_site_url || resolveManageBookingsUrl(tenant.business).replace("/my-bookings", "");
    const reviewUrl = bookingSiteUrl + "/review/" + review.submission_token;

    const message =
      "Hi " + firstName + ", just a gentle reminder \u2014 we\u2019d love to hear how your " + brandName + " experience was! \u{1F30A}\n\n" +
      "It only takes a minute and really helps us out.\n\n" +
      "\u{2B50} Leave a review: " + reviewUrl;

    // Mark sent BEFORE attempting send (one-shot: no retry storms)
    await db.from("reviews").update({ reminder_sent_at: now.toISOString() }).eq("id", review.id);

    try {
      await sendWhatsappTextForTenant(tenant, phone, message, {
        name: "review_reminder",
        params: [firstName],
      });
      sent++;
    } catch (error) {
      console.error("REVIEW_REMINDER_ERR", businessId, review.id, error);
    }
  }

  return sent;
}

async function sendReEngagementForBusiness(businessId: string) {
  const tenant = await getTenantByBusinessId(db, businessId);
  const brandName = getBusinessDisplayName(tenant.business);
  const now = new Date();
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fourMonthsAgo = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

  const { data: oldBookings } = await db.from("bookings")
    .select("phone, customer_name")
    .eq("business_id", businessId)
    .in("status", ["COMPLETED", "PAID"])
    .lt("created_at", threeMonthsAgo.toISOString())
    .gt("created_at", fourMonthsAgo.toISOString())
    .not("phone", "is", null)
    .not("marketing_opt_in", "eq", false);

  let sent = 0;
  const seenPhones = new Set<string>();
  for (let i = 0; i < (oldBookings || []).length; i++) {
    const booking: any = oldBookings?.[i];
    if (!booking.phone || seenPhones.has(booking.phone)) continue;
    seenPhones.add(booking.phone);

    const { data: recent } = await db.from("bookings").select("id")
      .eq("phone", booking.phone)
      .eq("business_id", businessId)
      .gt("created_at", threeMonthsAgo.toISOString())
      .limit(1);
    if ((recent || []).length > 0) continue;

    // Skip customers who have future bookings (paid or confirmed)
    const { data: futureBookings } = await db.from("bookings")
      .select("id, slots!inner(start_time)")
      .eq("phone", booking.phone)
      .eq("business_id", businessId)
      .in("status", ["PAID", "CONFIRMED"])
      .gt("slots.start_time", new Date().toISOString())
      .limit(1);
    if ((futureBookings || []).length > 0) continue;

    const { data: alreadyEngaged } = await db.from("auto_messages").select("id")
      .eq("phone", booking.phone)
      .eq("business_id", businessId)
      .eq("type", "RE_ENGAGE")
      .gt("created_at", fourMonthsAgo.toISOString())
      .limit(1);
    if ((alreadyEngaged || []).length > 0) continue;

    const firstName = String(booking.customer_name || "").split(" ")[0] || "there";
    const bookingSiteUrl = tenant.business.booking_site_url || resolveManageBookingsUrl(tenant.business).replace("/my-bookings", "");
    const reLocationPhrase = (tenant.business as any).location_phrase;
    const message = "Hi " + firstName + ", it\u2019s been a while since your last trip with " + brandName + "!\n\nWe\u2019d love to welcome you back" + (reLocationPhrase ? " " + reLocationPhrase : "") + ". Browse our latest trips and availability:\n" + bookingSiteUrl;

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

async function autoTimeoutHumanChatsForBusiness(businessId: string) {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Find conversations stuck in HUMAN state with no recent messages
  const { data: staleConvos } = await db.from("conversations")
    .select("id, phone, last_message_at, updated_at")
    .eq("business_id", businessId)
    .eq("status", "HUMAN")
    .lt("updated_at", fortyEightHoursAgo);

  let reverted = 0;
  for (let i = 0; i < (staleConvos || []).length; i++) {
    const convo: any = staleConvos?.[i];
    // Double-check last_message_at if available
    if (convo.last_message_at && convo.last_message_at > fortyEightHoursAgo) continue;

    await db.from("conversations").update({ status: "BOT", current_state: "IDLE" }).eq("id", convo.id);
    console.log("HUMAN_TIMEOUT_REVERTED convo=" + convo.id + " phone=" + convo.phone);
    reverted++;
  }

  return reverted;
}

async function autoExpireBookingsForBusiness(businessId: string) {
  const tenant = await getTenantByBusinessId(db, businessId);
  const bookingSiteUrl = tenant.business.booking_site_url || "";
  const nowIso = new Date().toISOString();

  const { data: expiredBookings } = await db.from("bookings")
    .select("id, business_id, customer_name, phone, email, qty, total_amount, tours(name), slots(start_time)")
    .eq("business_id", businessId)
    .in("status", ["PENDING", "PENDING PAYMENT", "HELD"])
    .not("payment_deadline", "is", null)
    .lt("payment_deadline", nowIso);

  let cancelled = 0;
  for (let i = 0; i < (expiredBookings || []).length; i++) {
    const booking: any = expiredBookings?.[i];
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
        const cancelRef = String(booking.id || "").substring(0, 8).toUpperCase();
        const cancelTourName = booking?.tours?.name || "Experience";
        const cancelDate = booking?.slots?.start_time ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "TBC";
        await sendWhatsappTextForTenant(
          tenant,
          booking.phone,
          "Your booking " + cancelRef + " was released because the payment deadline passed." +
            (bookingSiteUrl ? "\n\nYou can create a new booking here: " + bookingSiteUrl : ""),
          {
            name: "booking_cancelled",
            params: [cancelRef, cancelTourName, cancelDate, "Payment deadline expired"],
          },
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

Deno.serve(withSentry("auto-messages", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getHeaders(req.headers.get("origin")) });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "all");
    const businesses = await getBusinesses();
    const results: Record<string, number> = {
      reminders: 0,
      indemnity: 0,
      reviews: 0,
      review_reminders: 0,
      re_engage: 0,
      auto_expire: 0,
      human_timeout: 0,
    };

    for (let i = 0; i < businesses.length; i++) {
      const businessId = String(businesses[i].id || "");
      if (!businessId) continue;
      if (action === "all" || action === "reminders") results.reminders += await sendRemindersForBusiness(businessId);
      if (action === "all" || action === "indemnity") results.indemnity += await sendIndemnityEmailsForBusiness(businessId);
      if (action === "all" || action === "reviews") results.reviews += await sendReviewRequestsForBusiness(businessId);
      if (action === "all" || action === "review_reminders") results.review_reminders += await sendReviewRemindersForBusiness(businessId);
      if (action === "all" || action === "re_engage") results.re_engage += await sendReEngagementForBusiness(businessId);
      if (action === "all" || action === "auto_expire") results.auto_expire += await autoExpireBookingsForBusiness(businessId);
      if (action === "all" || action === "human_timeout") results.human_timeout += await autoTimeoutHumanChatsForBusiness(businessId);
    }

    return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: getHeaders(req.headers.get("origin")) });
  } catch (error) {
    console.error("AUTO_MESSAGES_ERR", error);
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: getHeaders(req.headers.get("origin")) });
  }
}));
