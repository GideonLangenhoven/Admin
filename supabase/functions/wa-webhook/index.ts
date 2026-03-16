import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  resolveBusinessSiteUrls,
  resolveTenantByWhatsappPayload,
  type TenantContext,
} from "../_shared/tenant.ts";
import { resolveWaiverLink } from "../_shared/waiver.ts";

var VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN")!;
var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
var BOOKING_SUCCESS_URL = Deno.env.get("BOOKING_SUCCESS_URL") || "";
var BOOKING_CANCEL_URL = Deno.env.get("BOOKING_CANCEL_URL") || "";
var VOUCHER_SUCCESS_URL = Deno.env.get("VOUCHER_SUCCESS_URL") || "";
var supabase = createServiceClient();
var GK = Deno.env.get("GEMINI_API_KEY") || "";

function withQuery(base: string, params: Record<string, string>) {
  var url = new URL(base);
  for (var [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function tenantTimeZone(tenant: TenantContext) {
  return tenant.business.timezone || "UTC";
}

function businessName(tenant: TenantContext) {
  return String(tenant.business.name || "our team");
}

function formatDateTime(tenant: TenantContext, iso: any, options: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString("en-ZA", { ...options, timeZone: tenantTimeZone(tenant) });
}

function formatDateOnly(tenant: TenantContext, iso: any, options: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleDateString("en-ZA", { ...options, timeZone: tenantTimeZone(tenant) });
}

function formatTimeOnly(tenant: TenantContext, iso: any, options: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleTimeString("en-ZA", { ...options, timeZone: tenantTimeZone(tenant) });
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  var formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  var parts = formatter.formatToParts(date);
  var values: Record<string, string> = {};
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].type !== "literal") values[parts[i].type] = parts[i].value;
  }
  var utcTs = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return utcTs - date.getTime();
}

function zonedDateTimeToUtcIso(tenant: TenantContext, dateKey: string, hour: number, minute: number = 0) {
  var [year, month, day] = dateKey.split("-").map(Number);
  var guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  var offset = getTimeZoneOffsetMs(guess, tenantTimeZone(tenant));
  return new Date(guess.getTime() - offset).toISOString();
}

function serializeFaqForPrompt(faqJson: any) {
  if (!faqJson) return "";
  if (Array.isArray(faqJson)) return JSON.stringify(faqJson);
  if (typeof faqJson === "object") {
    return Object.entries(faqJson)
      .map(function ([key, value]) {
        return key + ": " + (typeof value === "string" ? value : JSON.stringify(value));
      })
      .join("\n");
  }
  return String(faqJson);
}

function serializeTerminology(terminology: any) {
  if (!terminology || typeof terminology !== "object") return "";
  return Object.entries(terminology)
    .map(function ([key, value]) {
      return key + "=" + String(value);
    })
    .join(", ");
}

function getFaqAnswer(tenant: TenantContext, key: string) {
  var faqJson = tenant.business.faq_json || {};
  if (faqJson && typeof faqJson === "object" && !Array.isArray(faqJson) && typeof faqJson[key] === "string") {
    return faqJson[key];
  }
  return null;
}

function buildGeminiInstruction(tenant: TenantContext, extraContext?: string) {
  var sections = [
    String(tenant.business.ai_system_prompt || "").trim(),
    "Use the tenant FAQ and terminology below. Keep replies short, factual, and never invent availability, pricing, or policies.",
  ];

  var terminologyText = serializeTerminology(tenant.business.terminology);
  if (terminologyText) sections.push("Terminology: " + terminologyText);

  var faqText = serializeFaqForPrompt(tenant.business.faq_json);
  if (faqText) sections.push("FAQ:\n" + faqText);

  if (extraContext) sections.push("Live context:\n" + extraContext);

  return sections.filter(Boolean).join("\n\n");
}

async function getBusinessSiteUrls(tenant: TenantContext) {
  return resolveBusinessSiteUrls(tenant.business, {
    bookingSuccessUrl: BOOKING_SUCCESS_URL,
    bookingCancelUrl: BOOKING_CANCEL_URL,
    voucherSuccessUrl: VOUCHER_SUCCESS_URL,
  });
}

async function sendWA(tenant: TenantContext, to: any, body: any) {
  var res = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + tenant.credentials.waToken, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to, ...body }),
  });
  var data = await res.json();
  console.log("WA:" + JSON.stringify(data));

  // If we get an error about outside the 24 hour window (code 131047 or similar), 
  // we fallback to sending a generic template message to wake the user up.
  if (!res.ok && data.error && (data.error.code === 131047 || (data.error.message && data.error.message.includes("24")))) {
    console.log("Outside 24h window, sending template fallback...");
    var templateRes = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + tenant.credentials.waToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: {
          name: "hello_world", // You will need to replace this with your actual approved template name in Meta Business Suite
          language: { code: "en_US" }
        }
      })
    });
    return await templateRes.json();
  }

  return data;
}
async function sendText(tenant: TenantContext, to: any, t: any) { return sendWA(tenant, to, { type: "text", text: { body: t } }); }
async function sendButtons(tenant: TenantContext, to: any, bt: any, btns: any) {
  return sendWA(tenant, to, { type: "interactive", interactive: { type: "button", body: { text: bt }, action: { buttons: btns.map(function (b: any) { return { type: "reply", reply: { id: b.id, title: b.title.substring(0, 20) } }; }) } } });
}
async function sendList(tenant: TenantContext, to: any, bt: any, btnTxt: any, secs: any) {
  return sendWA(tenant, to, { type: "interactive", interactive: { type: "list", body: { text: bt }, action: { button: btnTxt.substring(0, 20), sections: secs } } });
}
async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function typingDelay() { await delay(800 + Math.floor(Math.random() * 1200)); }
async function gemFallback(tenant: TenantContext, msg: string, extraContext?: string): Promise<string | null> {
  if (!GK) return null;
  try {
    var r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildGeminiInstruction(tenant, extraContext) }] },
        contents: [{ role: "user", parts: [{ text: msg }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 150 }
      })
    });
    var d = await r.json();
    if (d.candidates?.[0]?.content?.parts?.[0]) return d.candidates[0].content.parts[0].text;
    return null;
  } catch (e) { return null; }
}
async function getConvo(tenant: TenantContext, phone: any) {
  var r = await supabase.from("conversations").select().eq("business_id", tenant.business.id).eq("phone", phone).single();
  if (r.data) return r.data;
  var r2 = await supabase.from("conversations").insert({ business_id: tenant.business.id, phone: phone, status: "BOT", current_state: "IDLE", state_data: {} }).select().single();
  return r2.data;
}
async function setConvo(id: any, u: any) { await supabase.from("conversations").update({ ...u, updated_at: new Date().toISOString() }).eq("id", id); }
async function logE(tenant: TenantContext, evt: any, p?: any, bid?: any) { await supabase.from("logs").insert({ business_id: tenant.business.id, booking_id: bid, event: evt, payload: p }); }
function fmtTime(tenant: TenantContext, iso: any) { return formatDateTime(tenant, iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }

async function getSlotPrice(slot: any) {
  if (slot.price_per_person_override) return Number(slot.price_per_person_override);
  var t = await supabase.from("tours").select("base_price_per_person").eq("id", slot.tour_id).single();
  return Number(t.data?.base_price_per_person || 600);
}
async function getAvailSlotsForTour(tenant: TenantContext, tourId: any, days: number = 14) {
  var later = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  var r = await supabase.rpc("list_available_slots", {
    p_business_id: tenant.business.id,
    p_range_start: new Date().toISOString(),
    p_range_end: later,
    p_tour_id: tourId,
  });
  return (r.data || [])
    .filter(function (s: any) { return Number(s.available_capacity || 0) > 0; })
    .map(function (s: any) { return { ...s, booked: Math.max(0, Number(s.capacity_total || 0) - Number(s.available_capacity || 0)), held: 0, tours: { name: s.tour_name } }; });
}
async function getAvailSlots(tenant: TenantContext, days: number = 14) {
  var later = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  var r = await supabase.rpc("list_available_slots", {
    p_business_id: tenant.business.id,
    p_range_start: new Date().toISOString(),
    p_range_end: later,
    p_tour_id: null,
  });
  return (r.data || [])
    .filter(function (s: any) { return Number(s.available_capacity || 0) > 0; })
    .map(function (s: any) { return { ...s, booked: Math.max(0, Number(s.capacity_total || 0) - Number(s.available_capacity || 0)), held: 0, tours: { name: s.tour_name } }; });
}
async function getActiveTours(tenant: TenantContext) {
  var r = await supabase.from("tours").select("id, name, description, base_price_per_person, duration_minutes, hidden")
    .eq("business_id", tenant.business.id).eq("active", true).order("sort_order", { ascending: true });
  return (r.data || []).filter(function (t: any) { return !t.name.includes("Private") && !t.hidden; });
}
async function getBookingCustomFields(tenant: TenantContext) {
  var r = await supabase.from("businesses").select("booking_custom_fields").eq("id", tenant.business.id).maybeSingle();
  return Array.isArray(r.data?.booking_custom_fields) ? r.data.booking_custom_fields.filter(function (f: any) { return f && f.key && f.label; }) : [];
}
function nextCustomField(defs: any[], values: Record<string, unknown>) {
  for (var i = 0; i < (defs || []).length; i++) {
    var field = defs[i];
    if (!field) continue;
    if (!String(values?.[field.key] || "").trim()) return field;
  }
  return null;
}
function promptForCustomField(field: any) {
  if (!field) return "Please send the next booking detail.";
  return field.label + (field.required ? " *" : "") + (field.placeholder ? "\n" + field.placeholder : "");
}
async function getLoyaltyCount(tenant: TenantContext, phone: any) {
  try { var r = await supabase.rpc("check_loyalty", { p_phone: phone, p_business_id: tenant.business.id }); return r.data || 0; } catch (e) { return 0; }
}
async function calcDiscount(tenant: TenantContext, qty: any, phone: any) {
  var pol = await supabase.from("policies").select().eq("business_id", tenant.business.id).single();
  var p = pol.data; var discount = { type: "", percent: 0 };
  var lc = await getLoyaltyCount(tenant, phone);
  if (p && lc >= (p.loyalty_bookings_threshold || 2)) discount = { type: "LOYALTY", percent: p.loyalty_discount_percent || 10 };
  if (p && qty >= (p.group_discount_min_qty || 6)) { var gp = p.group_discount_percent || 5; if (gp > discount.percent) discount = { type: "GROUP", percent: gp }; }
  return discount;
}
function genVoucherCode() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; var code = "";
  for (var i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}
async function hasActiveBookings(tenant: TenantContext, phone: any) {
  var r = await supabase.from("bookings").select("id").eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED"]).limit(1);
  return (r.data || []).length > 0;
}

// ===== REFERRAL SYSTEM =====
function genReferralCode(name: any) {
  var clean = ((name || "REF") + "").split(" ")[0].toUpperCase().substring(0, 4);
  var rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return clean + rand;
}
async function getOrCreateReferral(tenant: TenantContext, phone: any, name: any) {
  var existing = await supabase.from("referrals").select().eq("referrer_phone", phone).eq("business_id", tenant.business.id).eq("status", "ACTIVE").single();
  if (existing.data) return existing.data;
  var code = genReferralCode(name);
  var r = await supabase.from("referrals").insert({ business_id: tenant.business.id, referrer_phone: phone, referrer_name: name, referral_code: code, discount_percent: 5 }).select().single();
  return r.data;
}
async function validateReferralCode(code: any, phone: any) {
  var r = await supabase.from("referrals").select().eq("referral_code", code.toUpperCase()).eq("status", "ACTIVE").single();
  if (!r.data) return null;
  if (r.data.referrer_phone === phone) return null;
  if (r.data.uses >= r.data.max_uses) return null;
  return r.data;
}

// ===== REPEAT BOOKING =====
async function getLastCompletedBooking(tenant: TenantContext, phone: any) {
  var r = await supabase.from("bookings").select("*, tours(id, name, base_price_per_person)").eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["COMPLETED", "PAID"]).order("created_at", { ascending: false }).limit(1).single();
  return r.data;
}

var REVIEW_URL = "https://g.page/r/CWabH9a6u5DbEB0/review";

// ===== SMART AVAILABILITY =====
function parseTimeRef(tenant: TenantContext, input: string): { start: Date, end: Date, label: string } | null {
  var i = input.toLowerCase();
  var now = new Date();
  var tzNow = new Date(now.toLocaleString("en-US", { timeZone: tenantTimeZone(tenant) }));
  var today = new Date(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate());
  var targetDate: Date | null = null;
  var label = "";
  if (i.includes("tomorrow") || i.includes("tmrw")) { targetDate = new Date(today); targetDate.setDate(targetDate.getDate() + 1); label = "tomorrow"; }
  else if (i.includes("today") || i.includes("this afternoon") || i.includes("this morning")) { targetDate = new Date(today); label = "today"; }
  else {
    var days: string[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    for (var d = 0; d < days.length; d++) {
      if (i.includes(days[d]) || i.includes(days[d].substring(0, 3))) {
        var currentDay = today.getDay(); var diff = d - currentDay; if (diff <= 0) diff += 7;
        targetDate = new Date(today); targetDate.setDate(targetDate.getDate() + diff);
        label = days[d].charAt(0).toUpperCase() + days[d].slice(1); break;
      }
    }
  }
  if (i.includes("weekend")) {
    var sat = new Date(today); var daysToSat = 6 - sat.getDay(); if (daysToSat <= 0) daysToSat += 7;
    sat.setDate(sat.getDate() + daysToSat);
    var mon = new Date(sat); mon.setDate(mon.getDate() + 2);
    return { start: sat, end: mon, label: "this weekend" };
  }
  if (i.includes("next week")) {
    var nextMon = new Date(today); var toMon = (8 - nextMon.getDay()) % 7 || 7;
    nextMon.setDate(nextMon.getDate() + toMon);
    var nextSun = new Date(nextMon); nextSun.setDate(nextSun.getDate() + 7);
    return { start: nextMon, end: nextSun, label: "next week" };
  }
  if (!targetDate) {
    var dm = i.match(/(\d{1,2})\s*(st|nd|rd|th)/);
    if (dm) {
      targetDate = new Date(today); targetDate.setDate(parseInt(dm[1]));
      if (targetDate < today) targetDate.setMonth(targetDate.getMonth() + 1);
      label = targetDate.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: tenantTimeZone(tenant) });
    }
  }
  if (!targetDate) return null;
  var start = new Date(targetDate); var end = new Date(targetDate); end.setDate(end.getDate() + 1);
  if (i.includes("morning") || i.includes("early")) { start.setHours(5, 0, 0, 0); end = new Date(targetDate); end.setHours(12, 0, 0, 0); label += " morning"; }
  else if (i.includes("afternoon")) { start.setHours(12, 0, 0, 0); end = new Date(targetDate); end.setHours(17, 0, 0, 0); label += " afternoon"; }
  else if (i.includes("evening") || i.includes("sunset")) { start.setHours(16, 0, 0, 0); end = new Date(targetDate); end.setHours(21, 0, 0, 0); label += " evening"; }
  var tm = i.match(/(\d{1,2})\s*(am|pm)/);
  if (tm) {
    var hr = parseInt(tm[1]); if (tm[2] === "pm" && hr < 12) hr += 12; if (tm[2] === "am" && hr === 12) hr = 0;
    start.setHours(hr, 0, 0, 0); end = new Date(targetDate); end.setHours(hr + 2, 0, 0, 0);
  }
  return { start: start, end: end, label: label };
}
async function checkWeatherConcern(tenant: TenantContext, phone: string, input: string): Promise<boolean> {
  var i = input.toLowerCase();
  var isWeatherQ = (i.includes("trip") || i.includes("tour") || i.includes("paddle")) && (i.includes("still on") || i.includes("go ahead") || i.includes("happening") || i.includes("confirmed"));
  var isWeatherCheck = i.includes("weather") && (i.includes("tomorrow") || i.includes("today") || i.includes("look"));
  if (!isWeatherQ && !isWeatherCheck) return false;

  // Check if they have a booking
  var wBkr = await supabase.from("bookings").select("id, slots(start_time), tours(name)")
    .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
    .order("created_at", { ascending: false }).limit(1).single();
  var bkInfo = "";
  var bkTime = "";
  if (wBkr.data) {
    var wSlot = (wBkr.data as any).slots;
    var wTour = (wBkr.data as any).tours;
    if (wSlot) {
      bkInfo = "Your *" + (wTour?.name || "tour") + "* is on " + fmtTime(tenant, wSlot.start_time) + ".\n\n";
      bkTime = wSlot.start_time;
    }
  }

  var defaultWeatherSpot = { lat: -33.908, lon: 18.398 };
  var configuredWeatherSpot = Array.isArray(tenant.business.weather_widget_locations) && tenant.business.weather_widget_locations.length > 0
    ? tenant.business.weather_widget_locations[0]
    : defaultWeatherSpot;
  var weatherLat = Number(configuredWeatherSpot?.lat ?? defaultWeatherSpot.lat);
  var weatherLon = Number(configuredWeatherSpot?.lon ?? defaultWeatherSpot.lon);

  // Fetch live weather from Open-Meteo for the tenant's configured weather spot.
  var weatherMsg = "";
  try {
    var tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    var dateStr = tmr.toISOString().split("T")[0];
    var wUrl = "https://api.open-meteo.com/v1/forecast?latitude=" + weatherLat + "&longitude=" + weatherLon + "&daily=wind_speed_10m_max,wind_direction_10m_dominant,weather_code&hourly=wind_speed_10m,wind_direction_10m,visibility,temperature_2m&timezone=" + encodeURIComponent(tenantTimeZone(tenant)) + "&forecast_days=2";
    var mUrl = "https://marine-api.open-meteo.com/v1/marine?latitude=" + weatherLat + "&longitude=" + weatherLon + "&daily=wave_height_max,wave_period_max&timezone=" + encodeURIComponent(tenantTimeZone(tenant)) + "&forecast_days=2";
    var [wRes, mRes] = await Promise.all([fetch(wUrl), fetch(mUrl)]);
    var wData = await wRes.json();
    var mData = await mRes.json();

    // Get tomorrow's data (index 1)
    var maxWind = wData?.daily?.wind_speed_10m_max?.[1] || 0;
    var windDir = wData?.daily?.wind_direction_10m_dominant?.[1] || 0;
    var swell = mData?.daily?.wave_height_max?.[1] || 0;
    var weatherCode = wData?.daily?.weather_code?.[1] || 0;

    // Check visibility at tour hours (7-9am = indices 7-9)
    var minVis = 99999;
    var hourlyVis = wData?.hourly?.visibility || [];
    var hourlyTimes = wData?.hourly?.time || [];
    for (var hi = 0; hi < hourlyTimes.length; hi++) {
      if (hourlyTimes[hi].startsWith(dateStr) && hi % 24 >= 6 && hi % 24 <= 10) {
        if (hourlyVis[hi] < minVis) minVis = hourlyVis[hi];
      }
    }
    var foggy = minVis < 1000; // less than 1km visibility

    // Wind direction name
    var dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    var dirName = dirs[Math.round(windDir / 22.5) % 16];
    var isSE = dirName.includes("SE");
    var windLimit = isSE ? 25 : 20;
    var windBad = maxWind > windLimit;
    var swellBad = swell > 2.6;

    var concerns: string[] = [];
    if (swellBad) concerns.push("swell is " + swell.toFixed(1) + "m (above 2.6m)");
    if (windBad) concerns.push("wind gusts up to " + Math.round(maxWind) + "km/h " + dirName + (isSE ? " (limit 25km/h for SE)" : " (limit 20km/h)"));
    if (foggy) concerns.push("low visibility/fog expected");

    if (concerns.length > 0) {
      weatherMsg = "Looking at tomorrow\u2019s forecast, it does look like a challenging paddle \u26A0\uFE0F\n\n" + concerns.map(function (c) { return "\u2022 " + c; }).join("\n") + "\n\nWe\u2019ll let you know for sure tomorrow morning, about an hour before the trip. Please keep your phone nearby \u{1F4F1}\n\nIf we cancel, you get a *full refund or free reschedule*.";
    } else {
      weatherMsg = "Tomorrow\u2019s looking good! \u2600\uFE0F\n\n\u{1F30A} Swell: " + swell.toFixed(1) + "m\n\u{1F4A8} Wind: " + Math.round(maxWind) + "km/h " + dirName + "\n\nConditions look favourable for paddling. We\u2019ll still confirm on the morning of your trip about an hour before launch. Keep your phone nearby \u{1F4F1}";
    }
  } catch (e) {
    console.error("Weather API err:", e);
    weatherMsg = "We check conditions every morning before trips go out. If the swell is high, there\u2019s heavy fog, or strong winds, we may need to postpone.\n\nWe\u2019ll let you know on the morning of your trip, about an hour before launch. Keep your phone nearby \u{1F4F1}";
  }

  await sendText(tenant, phone, bkInfo + weatherMsg);
  await sendButtons(tenant, phone, "Anything else?", [{ id: "ASK", title: "\u2753 Another Question" }, { id: "IDLE", title: "\u2B05 Menu" }]);
  return true;
}

function detectAvailQuery(input: string): boolean {
  var i = input.toLowerCase();
  var hasTime = i.includes("tomorrow") || i.includes("today") || i.includes("weekend") || i.includes("next week") || i.includes("morning") || i.includes("afternoon") || i.includes("evening") || ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].some(function (d) { return i.includes(d); }) || /\d{1,2}(st|nd|rd|th)/.test(i) || /\d{1,2}\s*(am|pm)/.test(i);
  var hasIntent = i.includes("available") || i.includes("space") || i.includes("slot") || i.includes("open") || i.includes("spot") || i.includes("can i") || i.includes("do you have") || i.includes("any tour") || i.includes("what time") || i.includes("book for") || i.includes("free") || i.includes("which") || i.includes("what");
  return hasTime && hasIntent;
}
async function handleSmartAvail(tenant: TenantContext, phone: string, input: string): Promise<boolean> {
  var timeRef = parseTimeRef(tenant, input);
  if (!timeRef) return false;

  // No hard slot limits; pull all within the boundaries user asked for
  var r = await supabase.from("slots").select("id, start_time, capacity_total, booked, held, tour_id, tours(name, base_price_per_person)")
    .eq("business_id", tenant.business.id).eq("status", "OPEN")
    .gte("start_time", timeRef.start.toISOString())
    .lt("start_time", timeRef.end.toISOString())
    .order("start_time", { ascending: true });
  var slots = (r.data || []).filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) > 0; });
  if (slots.length === 0) {
    await sendText(tenant, phone, "I checked and unfortunately there aren't any slots generated or available for " + timeRef.label + ". \u{1F614}\n\nWe usually publish slots a month or two in advance. Let me know if you want to look at another date!");
    await sendButtons(tenant, phone, "Options:", [{ id: "AVAIL", title: "\u{1F4C5} Look at other dates" }, { id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "IDLE", title: "\u2B05 Menu" }]);
    return true;
  }

  // Slice to a readable amount for WhatsApp UX, but tell them to hit book if they want more
  var displaySlots = slots.slice(0, 8);
  var msg = "Here\u2019s what\u2019s available for *" + timeRef.label + "*:\n\n";
  for (var si = 0; si < displaySlots.length; si++) {
    var s = displaySlots[si]; var tour = (s as any).tours;
    var avail = s.capacity_total - s.booked - (s.held || 0);
    msg += "\u{1F6F6} *" + (tour?.name || "Tour") + "*\n";
    msg += "   " + fmtTime(tenant, s.start_time) + " \u2014 " + avail + " spots \u2014 R" + (tour?.base_price_per_person || "600") + "/pp\n\n";
  }

  if (slots.length > 8) {
    msg += "...and several other times available! Click 'Pick a Date' to browse the full calendar.\n\nWant to book one of these?";
  } else {
    msg += "Want to book one of these?";
  }
  await sendButtons(tenant, phone, msg, [{ id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "AVAIL", title: "\u{1F4C5} Other Dates" }, { id: "IDLE", title: "\u2B05 Menu" }]);
  return true;
}

function matchFAQ(input: any) {
  var i = input.toLowerCase();
  // Meeting point
  if (i.includes("where") && (i.includes("meet") || i.includes("go") || i.includes("find") || i.includes("located"))) return "meeting_point";
  if (i.includes("meeting point") || i.includes("location") || i.includes("address") || i.includes("directions") || i.includes("get there")) return "meeting_point";
  if (i.includes("map") || i.includes("pin") || i.includes("gps")) return "meeting_point";
  // What to bring
  if (i.includes("bring") || i.includes("wear") || i.includes("pack") || i.includes("prepare") || i.includes("need to take") || i.includes("what do i need")) return "what_to_bring";
  if (i.includes("clothes") || i.includes("gear") || i.includes("equipment") || i.includes("sunscreen")) return "what_to_bring";
  // Cancellation
  if ((i.includes("cancel") && (i.includes("policy") || i.includes("what if") || i.includes("can i"))) || (i.includes("refund") && !i.includes("my")) || (i.includes("change") && i.includes("mind"))) return "cancellation";
  if (i.includes("money back") || i.includes("get refund")) return "cancellation";
  // Duration
  if (i.includes("how long") || i.includes("duration") || i.includes("how much time") || i.includes("how many hours") || i.includes("how many minutes")) return "duration";
  if (i.includes("what time") && (i.includes("finish") || i.includes("end") || i.includes("done"))) return "duration";
  // Safety
  if (i.includes("safe") || i.includes("danger") || i.includes("risk") || i.includes("drown") || i.includes("scary")) return "safety";
  if (i.includes("swim") || i.includes("experience") && (i.includes("need") || i.includes("require"))) return "safety";
  if (i.includes("beginner") || i.includes("first time") || i.includes("never") && i.includes("before")) return "safety";
  if (i.includes("can't swim") || i.includes("cant swim") || i.includes("nervous")) return "safety";
  // Weather
  if (i.includes("weather") || i.includes("rain") || i.includes("wind") || i.includes("cold") || i.includes("storm")) return "weather";
  if (i.includes("what if") && (i.includes("rain") || i.includes("bad weather") || i.includes("windy"))) return "weather";
  // Pricing
  if (i.includes("price") || i.includes("cost") || i.includes("how much") || i.includes("rate") || i.includes("fee") || i.includes("charge") || i.includes("rand") || i.includes("expensive")) return "pricing";
  if (i.includes("pay") && !i.includes("payment")) return "pricing";
  if (i.includes("discount") || i.includes("special") || i.includes("deal") || i.includes("promo")) return "pricing";
  // Age
  if (i.includes("age") || i.includes("child") || i.includes("kid") || i.includes("baby") || i.includes("toddler") || i.includes("young") || i.includes("old enough")) return "age";
  if (i.includes("family") || i.includes("families") || i.includes("my son") || i.includes("my daughter") || i.includes("my child")) return "age";
  // Parking
  if (i.includes("park") || i.includes("parking") || i.includes("car")) return "parking";
  // Groups
  if (i.includes("group") || i.includes("team") || i.includes("corporate") || i.includes("birthday") || i.includes("party") || i.includes("event") || i.includes("hen") || i.includes("bachelor")) return "groups";
  // What to expect
  if (i.includes("expect") || i.includes("what happens") || i.includes("what is it like") || i.includes("tell me about") || i.includes("describe") || i.includes("what do you do")) return "what_to_expect";
  if (i.includes("itinerary") || i.includes("programme") || (i.includes("schedule") && !i.includes("reschedule")) || i.includes("typical")) return "what_to_expect";
  // Camera / phone
  if (i.includes("camera") || i.includes("gopro") || i.includes("phone") && (i.includes("bring") || i.includes("take") || i.includes("waterproof"))) return "camera";
  if (i.includes("dry bag")) return "camera";
  // Dog / pet
  if (i.includes("dog") || i.includes("pet") || i.includes("animal")) return "dog";
  // Fitness / weight
  if (i.includes("fitness") || i.includes("fit") && i.includes("need") || i.includes("weight") || i.includes("heavy") || i.includes("overweight") || i.includes("disabled") || i.includes("wheelchair") || i.includes("mobility")) return "fitness";
  // Pregnant
  if (i.includes("pregnant") || i.includes("pregnancy") || i.includes("expecting")) return "pregnant";
  // Glasses
  if (i.includes("glasses") || i.includes("spectacles") || i.includes("contact") && i.includes("lens") || i.includes("contacts")) return "glasses";
  // Food / drinks
  if (i.includes("food") || i.includes("eat") || i.includes("drink") || i.includes("hungry") || i.includes("snack") || i.includes("wine") || i.includes("alcohol") || i.includes("bubbly")) return "food";
  // Payment methods
  if (i.includes("cash") || i.includes("eft") || i.includes("transfer") || (i.includes("pay") && (i.includes("how") || i.includes("method") || i.includes("card") || i.includes("international")))) return "payment";
  if (i.includes("deposit") || i.includes("split") && i.includes("pay")) return "payment";
  // Tour differences
  if ((i.includes("difference") || i.includes("compare") || i.includes("which") && i.includes("tour") || i.includes("which one") || i.includes("best tour")) && !i.includes("book")) return "difference";
  // Hours
  if (i.includes("hours") || i.includes("open") || i.includes("operating") || (i.includes("what time") && !i.includes("finish") && !i.includes("end") && !i.includes("my"))) return "hours";
  // Holidays
  if (i.includes("holiday") || i.includes("public holiday") || i.includes("christmas") || i.includes("new year") || i.includes("easter") || i.includes("festive")) return "holidays";
  // Tours overview
  if ((i.includes("what tour") || i.includes("which tour") || i.includes("tour") && i.includes("offer") || i.includes("options") || i.includes("what do you do")) && !i.includes("book")) return "tours_overview";
  return null;
}

// Detect intent from natural language
// Detect intent using Gemini for natural language understanding
async function detectIntent(tenant: TenantContext, input: string, phone: string): Promise<string | null> {
  var i = input.toLowerCase();

  // Fast path for exact keywords to save API calls
  if (i === "book" || i === "reserve") return "BOOK";
  if (i === "menu" || i === "start" || i === "restart") return "MENU";
  if (i === "reschedule") return "RESCHEDULE";
  if (i === "cancel") return "CANCEL";

  // Use Gemini for natural language intent classification
  if (!GK) return null; // Fallback if no API key

  try {
    var r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text: `You are an intent classifier for a tourism activity booking assistant for ${businessName(tenant)}. Read the user's message and reply with EXACTLY ONE of the following keywords based on their intent, or 'UNKNOWN' if it doesn't match any:

BOOK (wants to book a tour)
AVAIL (asking about times, schedule, or availability)
MY_BOOKINGS (wants to manage, view, change, reschedule, or cancel an existing booking)
VOUCHER (wants to buy or redeem a gift voucher)
HUMAN (wants to speak to a human, agent, or team member)
THANKS (saying thank you or goodbye)

Reply ONLY with the keyword, nothing else.`}]
        },
        contents: [{ role: "user", parts: [{ text: input }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
      })
    });
    var d = await r.json();
    if (d.candidates?.[0]?.content?.parts?.[0]) {
      var intent = d.candidates[0].content.parts[0].text.trim().toUpperCase();
      if (["BOOK", "AVAIL", "MY_BOOKINGS", "VOUCHER", "HUMAN", "THANKS"].includes(intent)) {
        return intent;
      }
    }
  } catch (e) { console.error("Intent classification failed", e); }

  return null;
}


async function handleMsg(tenant: TenantContext, phone: any, text: any, msgType: any, interactive?: any) {
  try {
    var convo = await getConvo(tenant, phone);
    if (!convo) return;
    // Log incoming message before HUMAN check
    var _rt = (text || "").trim();
    var _ri = (msgType === "interactive" && interactive) ? ((interactive.button_reply && interactive.button_reply.id) || (interactive.list_reply && interactive.list_reply.id) || "") : "";
    try {
      var cmRes = await supabase.from("chat_messages").insert({ business_id: convo.business_id || tenant.business.id, phone: phone, direction: "IN", body: _rt || _ri || "[non-text]", sender: convo.customer_name || phone });
      if (cmRes.error) await logE(tenant, "CHAT_ERROR_RES", cmRes.error);
    } catch (e: any) {
      await logE(tenant, "CHAT_ERROR_CATCH", { msg: e.message });
    }
    var input = (text || "").trim().toLowerCase();
    var rawText = (text || "").trim();
    var rid = "";
    if (msgType === "interactive" && interactive) {
      rid = (interactive.button_reply && interactive.button_reply.id) || (interactive.list_reply && interactive.list_reply.id) || "";
    }

    // Allow "menu"/"start"/"restart" to escape HUMAN mode so the user can always get the bot back
    var isResetKeyword = (input === "menu" || input === "start" || input === "restart" || input === "back" || input === "home" || input === "main menu" || input === "start over");
    if (convo.status === "HUMAN") {
      if (isResetKeyword) {
        await setConvo(convo.id, { status: "BOT", current_state: "IDLE", state_data: {} });
      } else {
        return; // Still in human-handled mode, bot stays silent
      }
    }

    var state = convo.current_state || "IDLE";
    var sd = convo.state_data || {};
    console.log("S:" + state + " I:" + input + " R:" + rid);

    // Global reset
    if (isResetKeyword) {
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      state = "IDLE";
    }

    // Greetings trigger welcome
    if ((input === "hi" || input === "hello" || input === "hey" || input === "howzit" || input === "hiya" || input === "yo" || input === "sup" || input === "good morning" || input === "good afternoon" || input === "good evening") && state !== "IDLE") {
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      state = "IDLE";
    }

    // Weather cancellation response intercept
    if ((input === "1" || input === "2" || input === "3" || input === "1️⃣" || input === "2️⃣" || input === "3️⃣" || input.includes("refund") || input.includes("voucher") || input.includes("reschedule")) && (state === "IDLE" || state === "MENU")) {
      var yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var cb = await supabase.from("bookings").select("id, status, cancellation_reason, slot_id, qty, total_amount, tour_id, refund_status")
        .eq("business_id", tenant.business.id)
        .eq("phone", phone)
        .eq("status", "CANCELLED")
        .gt("cancelled_at", yesterday)
        .order("cancelled_at", { ascending: false }).limit(1).single();

      if (cb.data && cb.data.cancellation_reason && cb.data.cancellation_reason.includes("Weather")) {
        var choiceDesc = "";
        if (input.includes("1") || input.includes("reschedule")) choiceDesc = "RESCHEDULE";
        else if (input.includes("2") || input.includes("voucher")) choiceDesc = "VOUCHER";
        else if (input.includes("3") || input.includes("refund")) choiceDesc = "REFUND";

        if (choiceDesc) {
          state = "BOOKING_ACTIONS";
          sd = { booking_id: cb.data.id, slot_id: cb.data.slot_id, qty: cb.data.qty, total: cb.data.total_amount, tour_id: cb.data.tour_id, hours_before: 25, is_weather: true };

          if (choiceDesc === "RESCHEDULE") {
            rid = "ACT_RESCH_" + cb.data.id;
          } else if (choiceDesc === "VOUCHER") {
            rid = "ACT_VOUCHER_" + cb.data.id;
          } else if (choiceDesc === "REFUND") {
            rid = "ACT_WX_REFUND_" + cb.data.id;
          }
        }
      }
    }

    // POP / Payment Issue Intercept
    var isPaymentIssue = false;
    if (msgType === "document" || msgType === "image") isPaymentIssue = true;
    if (input.includes("proof") || input.includes("pop") || input.includes("receipt") || input.includes("paid it") || input.includes("just paid")) isPaymentIssue = true;
    if (input.includes("payment") && (input.includes("fail") || input.includes("error") || input.includes("won't") || input.includes("issue"))) isPaymentIssue = true;
    if (input.includes("can't pay") || input.includes("cannot pay") || input.includes("error paying") || input.includes("trouble paying")) isPaymentIssue = true;

    if (isPaymentIssue) {
      // Only intercept if we aren't already in human mode
      if (convo.status !== "HUMAN") {
        await typingDelay();
        await sendText(tenant, phone, "I see you're sending a payment update or having trouble paying. I've paused my automated responses and alerted our team to check this for you right away. 🛶\n\nA human will reply to you here shortly!");
        await setConvo(convo.id, { status: "HUMAN", current_state: "IDLE", state_data: {} });
        return;
      }
    }

    // ===== NATURAL LANGUAGE FROM ANY STATE =====
    if (state === "IDLE" || state === "MENU") {
      // Check smart availability first
      if (!rid && detectAvailQuery(input)) {
        var handled = await handleSmartAvail(tenant, phone, input);
        if (handled) { await setConvo(convo.id, { current_state: "MENU" }); return; }
      }

      // Check FAQ
      var faqKey = matchFAQ(input);
      if (faqKey && !rid) {
        var faqAnswer = getFaqAnswer(tenant, faqKey);
        if (!faqAnswer) {
          await sendText(tenant, phone, "I’m not sure about that yet. Let me connect you to our team.");
          await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
          return;
        }
        await typingDelay();
        await sendText(tenant, phone, faqAnswer);
        await typingDelay();
        await sendText(tenant, phone, "Anything else I can help with?");
        await sendButtons(tenant, phone, "Quick actions:", [
          { id: "BOOK", title: "\u{1F6F6} Book a Tour" },
          { id: "MORE", title: "\u{1F4AC} More Options" },
        ]);
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // Check intent (skip if rid already set from button click)
      var intent = rid ? null : await detectIntent(tenant, input, phone);
      if (intent === "THANKS" && !rid) {
        await sendText(tenant, phone, "You\u2019re welcome! \u{1F60A} Feel free to ask anything else or type *menu* to see your options.");
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }
      if (intent && !rid) { rid = intent; }
    }

    // ===== IDLE =====
    if (state === "IDLE") {
      var lc = await getLoyaltyCount(tenant, phone);
      var hasBookings = await hasActiveBookings(tenant, phone);
      var welcome = "";

      if (lc >= 2) {
        welcome = "Hey, welcome back! \u{1F44B} Great to see you again. What can I do for you?";
      } else if (lc === 1 || hasBookings) {
        welcome = "Hey, welcome back to " + businessName(tenant) + "! \u{1F44B}\n\nWhat can I help you with?";
      } else {
        welcome = "Hey there! \u{1F44B} Welcome to *" + businessName(tenant) + "*! How can I help you today?";
      }

      // Returning customers see My Bookings first
      if (hasBookings) {
        await sendButtons(tenant, phone, welcome, [
          { id: "MY_BOOKINGS", title: "\u{1F4CB} My Bookings" },
          { id: "BOOK", title: "\u{1F6F6} Book a Tour" },
          { id: "MORE", title: "\u{1F4AC} More Options" },
        ]);
      } else {
        await sendButtons(tenant, phone, welcome, [
          { id: "BOOK", title: "\u{1F6F6} Book a Tour" },
          { id: "MORE", title: "\u{1F4AC} More Options" },
          { id: "MY_BOOKINGS", title: "\u{1F4CB} My Bookings" },
        ]);
      }
      await setConvo(convo.id, { current_state: "MENU" });
    }

    // ===== MENU =====
    else if (state === "MENU") {
      var c = rid || input;

      // BOOK
      if (c === "BOOK" || c.includes("book")) {
        var tours = await getActiveTours(tenant);
        if (tours.length === 0) { await sendText(tenant, phone, "No tours available at the moment \u2014 check back soon!"); await setConvo(convo.id, { current_state: "IDLE" }); return; }
        if (tours.length === 1) {
          await sendText(tenant, phone, "How many people will be joining? (1\u201330)");
          await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { tour_id: tours[0].id } });
        } else {
          var trows: any[] = [];
          for (var ti = 0; ti < tours.length; ti++) {
            var tr = tours[ti];
            trows.push({ id: "TOUR_" + tr.id, title: tr.name, description: "R" + tr.base_price_per_person + "/pp \u2022 " + tr.duration_minutes + " min" });
          }
          await sendText(tenant, phone, "Awesome, let\u2019s get you on the water! \u{1F30A}\n\nWhich tour catches your eye?");
          await sendList(tenant, phone, "We have " + tours.length + " incredible options:", "Choose a Tour", [{ title: "Our Tours", rows: trows }]);
          await setConvo(convo.id, { current_state: "PICK_TOUR", state_data: {} });
        }
      }

      // AVAILABILITY
      else if (c === "AVAIL" || c.includes("avail")) {
        var tours2 = await getActiveTours(tenant);
        if (tours2.length <= 1) {
          var slots = await getAvailSlots(tenant, 8);
          if (slots.length === 0) { await sendText(tenant, phone, "Nothing open right now, but check back soon \u2014 we add new slots regularly!"); await setConvo(convo.id, { current_state: "IDLE" }); }
          else {
            var msg = "Here\u2019s what\u2019s coming up:\n\n";
            for (var ai = 0; ai < slots.length; ai++) {
              var as2 = slots[ai]; var aav = as2.capacity_total - as2.booked - (as2.held || 0); var apr = await getSlotPrice(as2);
              msg += "\u2022 " + fmtTime(tenant, as2.start_time) + " \u2014 " + aav + " spots \u2014 R" + apr + "/pp\n";
            }
            await sendButtons(tenant, phone, msg, [{ id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "IDLE", title: "\u2B05 Back" }]);
          }
        } else {
          var availMsg = "Here\u2019s what\u2019s available:\n\n";
          for (var ati = 0; ati < tours2.length; ati++) {
            var at2 = tours2[ati];
            var atSlots = await getAvailSlotsForTour(tenant, at2.id, 3);
            availMsg += "*" + at2.name + "* (R" + at2.base_price_per_person + "/pp)\n";
            if (atSlots.length === 0) { availMsg += "  Fully booked for now\n\n"; }
            else {
              for (var asi = 0; asi < atSlots.length; asi++) {
                var ats = atSlots[asi]; availMsg += "  \u2022 " + fmtTime(tenant, ats.start_time) + " \u2014 " + (ats.capacity_total - ats.booked - (ats.held || 0)) + " spots\n";
              }
              availMsg += "\n";
            }
          }
          await sendButtons(tenant, phone, availMsg, [{ id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "IDLE", title: "\u2B05 Back" }]);
        }
      }

      // MY BOOKINGS / RESCHEDULE / CANCEL
      else if (c === "MY_BOOKINGS" || c === "RESCHEDULE" || c === "CANCEL" || c.includes("my booking") || c.includes("manage") || c.includes("reschedule") || c.includes("cancel")) {
        var bkr = await supabase.from("bookings").select("id, status, qty, total_amount, slot_id, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED", "CANCELLED"])
          .order("created_at", { ascending: false }).limit(5);
        var bookings = bkr.data || [];
        if (bookings.length === 0) {
          await sendText(tenant, phone, "You don\u2019t have any active bookings at the moment.");
          await sendButtons(tenant, phone, "Want to book your next adventure?", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Main Menu" }]);
          await setConvo(convo.id, { current_state: "MENU" });
        } else {
          var bmsg = "Here are your bookings:\n\n"; var brows: any[] = [];
          for (var bi = 0; bi < bookings.length; bi++) {
            var b = bookings[bi]; var bslot = (b as any).slots; var btour = (b as any).tours;
            var bref = b.id.substring(0, 8).toUpperCase(); var btime = bslot ? fmtTime(tenant, bslot.start_time) : "TBC";
            bmsg += (bi + 1) + ". *" + bref + "* \u2014 " + (btour?.name || "Tour") + "\n   " + btime + " \u2022 " + b.qty + " pax \u2022 R" + b.total_amount + " \u2022 " + b.status + "\n\n";
            brows.push({ id: "BK_" + b.id, title: bref + " - " + b.status, description: (btour?.name || "Tour").substring(0, 20) + " " + (btime || "").substring(0, 15) });
          }
          await sendList(tenant, phone, bmsg + "Tap to manage a booking:", "My Bookings", [{ title: "Your Bookings", rows: brows }]);
          await setConvo(convo.id, { current_state: "MY_BOOKINGS_LIST" });
        }
      }

      // ASK A QUESTION
      else if (c === "ASK" || c === "ask" || c.includes("question")) {
        await typingDelay();
        await sendText(tenant, phone, "Go ahead, ask me anything! \u{1F60A}\n\nI can answer things like:\n\u2022 \"What should I bring?\"\n\u2022 \"Where do we meet?\"\n\u2022 \"Is it safe for beginners?\"\n\u2022 \"Can I reschedule my booking?\"\n\u2022 \"What\'s available tomorrow?\"\n\nOr ask about your specific booking \u2014 I can look it up!");
        await setConvo(convo.id, { current_state: "ASK_MODE" });
        return;
      }

      // MORE OPTIONS
      else if (c === "MORE") {
        await sendList(tenant, phone, "What else can I help with?", "Options", [{
          title: "More Options", rows: [
            { id: "AVAIL", title: "\u{1F4C5} Availability", description: "See upcoming tour times" },
            { id: "MY_BOOKINGS", title: "\u{1F4CB} My Bookings", description: "View & manage bookings" },
            { id: "VOUCHER", title: "\u{1F381} Gift Vouchers", description: "Buy or redeem vouchers" },
            { id: "REFERRAL", title: "\u{1F91D} Refer a Friend", description: "You both get 5% off" },
            { id: "HUMAN", title: "\u{1F4AC} Speak to Our Team", description: "Chat with a real person" },
          ]
        }]);
      }

      // FAQ LIST
      else if (c === "FAQ_LIST") {
        await sendList(tenant, phone, "What would you like to know? (Or just ask me in your own words!)", "Browse Topics", [{
          title: "Common Questions",
          rows: [
            { id: "FAQ_MEET", title: "Meeting Point", description: "Where to find us" },
            { id: "FAQ_BRING", title: "What to Bring", description: "Gear and prep" },
            { id: "FAQ_CANCEL", title: "Cancellation Policy", description: "Refund info" },
            { id: "FAQ_DURATION", title: "Tour Duration", description: "How long is it" },
            { id: "FAQ_SAFE", title: "Safety", description: "Is it safe for beginners" },
            { id: "FAQ_WEATHER", title: "Weather Policy", description: "What if it rains" },
            { id: "FAQ_PRICE", title: "Pricing & Discounts", description: "What it costs" },
            { id: "FAQ_AGE", title: "Kids & Families", description: "Age requirements" },
            { id: "FAQ_PARKING", title: "Parking", description: "Where to park" },
            { id: "FAQ_EXPECT", title: "What to Expect", description: "The full experience" },
          ],
        }]);
        await setConvo(convo.id, { current_state: "FAQ_LIST" });
      }

      // VOUCHER
      else if (c === "VOUCHER" || c.includes("voucher") || c.includes("gift")) {
        await sendButtons(tenant, phone, "\u{1F39F} *Vouchers*\n\nWhat would you like to do?", [
          { id: "BUY_VOUCHER", title: "\u{1F381} Buy a Gift Voucher" },
          { id: "REDEEM_VOUCHER", title: "\u{1F39F} Redeem a Code" },
          { id: "IDLE", title: "\u2B05 Back" },
        ]);
      }

      // BUY GIFT VOUCHER
      else if (c === "BUY_VOUCHER" || c.includes("buy") && c.includes("voucher")) {
        var tours = await getActiveTours(tenant);
        var trows = [];
        for (var ti = 0; ti < tours.length; ti++) {
          var tr = tours[ti];
          trows.push({ id: "GV_" + tr.id, title: tr.name, description: "R" + tr.base_price_per_person + " voucher" });
        }
        await sendText(tenant, phone, "\u{1F381} *Buy a Gift Voucher*\n\nGreat idea! Pick which tour the voucher is for:");
        await sendList(tenant, phone, "Each voucher has a credit value applied to your booking.", "Choose Tour", [{ title: "Tours", rows: trows }]);
        await setConvo(convo.id, { current_state: "GV_PICK_TOUR", state_data: {} });
      }

      // REDEEM
      else if (c === "REDEEM_VOUCHER") {
        await sendText(tenant, phone, "Got a voucher? Nice! \u{1F389}\n\nPlease type your 8-character voucher code:");
        await setConvo(convo.id, { current_state: "REDEEM_VOUCHER" });
      }


      // REDEEM
      else if (c === "REDEEM_VOUCHER") {
        await sendText(tenant, phone, "Got a voucher? Nice! \u{1F389}\n\nPlease type your 8-character voucher code:");
        await setConvo(convo.id, { current_state: "REDEEM_VOUCHER" });
      }

      // HUMAN
      // REFERRAL
      else if (c === "REFERRAL" || (c.includes("refer") && !c.includes("refund"))) {
        var cname = convo.customer_name || "Friend";
        var ref = await getOrCreateReferral(tenant, phone, cname);
        if (ref) {
          await sendText(tenant, phone, "\u{1F91D} *Share the adventure!*\n\nHere\u2019s your personal referral code:\n\n\u{1F3AF} Code: *" + ref.referral_code + "*\n\n\u2022 Your friend gets *5% off* their first booking\n\u2022 You get *5% off* your next booking\n\nJust tell them to mention your code when booking!\n\nShare this message:\n_Hey! Use my code *" + ref.referral_code + "* to get 5% off a booking with " + businessName(tenant) + "._");
          await sendButtons(tenant, phone, "Anything else?", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        } else {
          await sendText(tenant, phone, "Something went wrong generating your code. Type *speak to us* for help.");
        }
      }

      // REPEAT BOOKING
      else if (c === "BOOK_AGAIN") {
        var lastBk = await getLastCompletedBooking(tenant, phone);
        if (lastBk) {
          var lbTour = lastBk.tours;
          await sendText(tenant, phone, "\u{1F6F6} Let\u2019s book you on *" + (lbTour ? lbTour.name : "a tour") + "* again!\n\nHow many people this time?");
          await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { tour_id: lbTour ? lbTour.id : lastBk.tour_id } });
        } else {
          await setConvo(convo.id, { current_state: "MENU" });
          rid = "BOOK";
        }
      }

      else if (c === "HUMAN" || c.includes("speak") || c.includes("human") || c.includes("agent") || c.includes("contact")) {
        await sendText(tenant, phone, "No problem! I\u2019m connecting you to our team now. They\u2019ll get back to you shortly \u{1F64F}\n\nIn the meantime, feel free to type *menu* if you want to chat with me again.");
        await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
        await logE(tenant, "human_takeover", { phone: phone });
      }

      // BACK
      else if (c === "IDLE" || c === "back" || c === "main menu") {
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        await handleMsg(tenant, phone, "hi", "text");
      }

      // FALLBACK — try to be helpful
      else {
        await typingDelay();
        var gemReply = await gemFallback(tenant, input || rawText);
        if (gemReply) {
          await sendText(tenant, phone, gemReply);
          await sendButtons(tenant, phone, "Anything else?", [
            { id: "BOOK", title: "\u{1F6F6} Book a Tour" },
            { id: "MORE", title: "\u{1F4AC} More Options" },
          ]);
        } else {
          await sendText(tenant, phone, "I\u2019m not quite sure what you mean \u{1F60A} You can ask me things like \"where do we meet\" or \"how much does it cost\" \u2014 or pick an option below:");
          await sendButtons(tenant, phone, "Quick actions:", [
            { id: "BOOK", title: "\u{1F6F6} Book a Tour" },
            { id: "MY_BOOKINGS", title: "\u{1F4CB} My Bookings" },
            { id: "MORE", title: "\u{1F4AC} More Options" },
          ]);
        }
      }
    }

    // ===== PICK TOUR =====
    else if (state === "PICK_TOUR") {
      var tourId = rid ? rid.replace("TOUR_", "") : "";
      if (!tourId) { await sendText(tenant, phone, "Please pick a tour from the list above."); return; }
      var tourInfo = await supabase.from("tours").select("*").eq("id", tourId).single();
      if (!tourInfo.data) { await sendText(tenant, phone, "Hmm, can\u2019t find that tour. Let\u2019s try again."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      var t = tourInfo.data;
      await sendText(tenant, phone, "*" + t.name + "* \u{1F6F6}\n\n" + t.description + "\n\n\u23F1 " + t.duration_minutes + " minutes\n\u{1F4B0} R" + t.base_price_per_person + " per person\n\nHow many people will be joining?");
      await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { tour_id: tourId } });
    }

    // ===== MY BOOKINGS LIST =====
    else if (state === "MY_BOOKINGS_LIST") {
      var bookingId = rid ? rid.replace("BK_", "") : "";
      if (!bookingId) { await sendText(tenant, phone, "Please select a booking from the list."); return; }
      var bkd = await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("id", bookingId).single();
      if (!bkd.data) { await sendText(tenant, phone, "Can\u2019t find that booking."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      var bk = bkd.data; var bkref = bk.id.substring(0, 8).toUpperCase();
      var bkslot = (bk as any).slots; var bktour = (bk as any).tours;
      var bkhrs = bkslot ? (new Date(bkslot.start_time).getTime() - Date.now()) / (1000 * 60 * 60) : 0;
      var detail = "*Booking " + bkref + "*\n\n\u{1F6F6} " + (bktour?.name || "Tour") + "\n\u{1F4C5} " + (bkslot ? fmtTime(tenant, bkslot.start_time) : "TBC") + "\n\u{1F465} " + bk.qty + " people\n\u{1F4B0} R" + bk.total_amount + "\n\u{1F4CC} " + bk.status + "\n\nWhat would you like to do?";
      var actions: any[] = [];
      if (bk.status === "CANCELLED") {
        if (bk.cancellation_reason && bk.cancellation_reason.includes("Weather")) {
          if (bk.refund_status === "REQUESTED" || bk.refund_status === "PROCESSED") {
            detail += "\n\n100% Refund has already been requested.";
            actions = [{ id: "IDLE", title: "\u2B05 Back" }];
          } else if (bk.converted_to_voucher_id) {
            detail += "\n\nAlready converted to a voucher.";
            actions = [{ id: "IDLE", title: "\u2B05 Back" }];
          } else {
            actions = [{ id: "ACT_RESCH_" + bk.id, title: "\u{1F504} Reschedule" }, { id: "ACT_VOUCHER_" + bk.id, title: "\u{1F39F} To Voucher" }, { id: "ACT_WX_REFUND_" + bk.id, title: "\u{1F4B8} 100% Refund" }];
          }
        } else {
          actions = [{ id: "IDLE", title: "\u2B05 Back" }];
        }
      } else if (bk.status === "PAID" && bkhrs >= 24) {
        actions = [{ id: "ACT_CANCEL_" + bk.id, title: "\u274C Cancel" }, { id: "ACT_RESCH_" + bk.id, title: "\u{1F504} Reschedule" }, { id: "ACT_VOUCHER_" + bk.id, title: "\u{1F39F} To Voucher" }];
      } else if (bk.status === "PAID") {
        actions = [{ id: "ACT_CANCEL_" + bk.id, title: "\u274C Cancel (no refund)" }, { id: "IDLE", title: "\u2B05 Back" }];
      } else { actions = [{ id: "ACT_CANCEL_" + bk.id, title: "\u274C Cancel" }, { id: "IDLE", title: "\u2B05 Back" }]; }
      await sendButtons(tenant, phone, detail, actions);
      await setConvo(convo.id, { current_state: "BOOKING_ACTIONS", state_data: { booking_id: bk.id, slot_id: bk.slot_id, qty: bk.qty, total: bk.total_amount, hours_before: bkhrs, tour_id: bk.tour_id, is_weather: bk.cancellation_reason && bk.cancellation_reason.includes("Weather") } });
    }

    // ===== BOOKING ACTIONS =====
    else if (state === "BOOKING_ACTIONS") {
      var action = rid || "";
      if (action.startsWith("ACT_CANCEL_")) {
        if (sd.hours_before >= 24) {
          var rAmt = Math.round(Number(sd.total) * 0.95 * 100) / 100;
          await sendButtons(tenant, phone, "Are you sure you want to cancel?\n\nYou\u2019ll get a *95% refund (R" + rAmt + ")*. A small 5% booking fee applies.", [{ id: "CONFIRM_CANCEL", title: "\u2705 Yes, Cancel" }, { id: "IDLE", title: "\u274C Keep It" }]);
        } else {
          await sendButtons(tenant, phone, "Are you sure? This booking is within 24 hours, so unfortunately *no refund* is available.", [{ id: "CONFIRM_CANCEL", title: "\u2705 Yes, Cancel" }, { id: "IDLE", title: "\u274C Keep It" }]);
        }
        await setConvo(convo.id, { current_state: "CONFIRM_CANCEL_ACTION" });
      }
      else if (action.startsWith("ACT_RESCH_")) {
        if (!sd.is_weather && sd.hours_before < 24) { await sendText(tenant, phone, "Sorry, rescheduling is only available more than 24 hours before your tour."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
        var cbk2 = await supabase.from("bookings").select("reschedule_count").eq("id", sd.booking_id).single();
        if (cbk2.data && cbk2.data.reschedule_count >= 2) { await sendText(tenant, phone, "You\u2019ve already rescheduled twice. Let me connect you to our team for help."); await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" }); return; }

        await typingDelay();
        await sendText(tenant, phone, "No problem! \ud83d\udcc5 Simply type the new date you want to reschedule to (e.g., 'Tomorrow' or '1 September')");
        await setConvo(convo.id, { current_state: "PICK_DATE", state_data: { ...sd, is_reschedule: true, reschedule_count: cbk2.data?.reschedule_count || 0 } });
      }
      else if (action.startsWith("ACT_WX_REFUND_")) {
        await sendButtons(tenant, phone, "Are you sure you want to request a 100% full refund for this weather cancellation?", [{ id: "CONFIRM_WX_REFUND", title: "✅ Yes, Refund" }, { id: "IDLE", title: "❌ Go Back" }]);
        await setConvo(convo.id, { current_state: "CONFIRM_WX_REFUND_ACTION", state_data: sd });
      }
      else if (action.startsWith("ACT_VOUCHER_")) {
        if (!sd.is_weather && sd.hours_before < 24) { await sendText(tenant, phone, "Voucher conversion is only available more than 24 hours before the tour."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
        await sendButtons(tenant, phone, "Convert this booking to a *gift voucher*?\n\nYou\u2019ll get a voucher code good for *one free trip* on any tour. Valid for 12 months.\n\nYour current seats will be released.", [{ id: "CONFIRM_VOUCHER", title: "\u2705 Yes, Convert" }, { id: "IDLE", title: "\u274C Keep Booking" }]);
        await setConvo(convo.id, { current_state: "CONFIRM_VOUCHER_CONVERT" });
      }
      else { await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); await handleMsg(tenant, phone, "hi", "text"); }
    }

    // ===== CONFIRM CANCEL =====
    else if (state === "CONFIRM_CANCEL_ACTION") {
      if (rid === "CONFIRM_CANCEL" || input === "yes") {
        await supabase.from("bookings").update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: "Customer cancelled" }).eq("id", sd.booking_id);
        if (sd.slot_id) { var slr = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single(); if (slr.data) await supabase.from("slots").update({ booked: Math.max(0, slr.data.booked - sd.qty) }).eq("id", sd.slot_id); }
        if (sd.hours_before >= 24) {
          var refAmt = Math.round(Number(sd.total) * 0.95 * 100) / 100;
          await supabase.from("bookings").update({ refund_status: "REQUESTED", refund_amount: refAmt, refund_notes: "95% refund" }).eq("id", sd.booking_id);
          await logE(tenant, "refund_requested", { booking_id: sd.booking_id, amount: refAmt }, sd.booking_id);
          await sendText(tenant, phone, "Done! Your booking has been cancelled.\n\nA refund of *R" + refAmt + "* has been submitted \u2014 expect it within 5\u20137 business days.\n\nWe\u2019d love to have you back on the water soon! \u{1F6F6}");
        } else {
          await logE(tenant, "booking_cancelled_no_refund", { booking_id: sd.booking_id }, sd.booking_id);
          await sendText(tenant, phone, "Your booking has been cancelled.\n\nAs it was within 24 hours, no refund is available per our policy.\n\nHope to see you again! \u{1F6F6}");
        }
        // Send cancellation email
        try {
          var cbkData = await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("id", sd.booking_id).single();
          if (cbkData.data && cbkData.data.email) {
            await fetch(SUPABASE_URL + "/functions/v1/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
              body: JSON.stringify({ type: "CANCELLATION", data: { email: cbkData.data.email, customer_name: cbkData.data.customer_name, ref: sd.booking_id.substring(0, 8).toUpperCase(), tour_name: (cbkData.data as any).tours?.name || "Tour", start_time: (cbkData.data as any).slots?.start_time ? fmtTime(tenant, (cbkData.data as any).slots.start_time) : "", refund_amount: sd.hours_before >= 24 ? refAmt : null } }),
            });
          }
        } catch (e) { console.log("cancel email err"); }
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      } else { await sendText(tenant, phone, "Great, your booking is safe! \u{1F389}"); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); }
    }

    // ===== CONFIRM WX REFUND =====
    else if (state === "CONFIRM_WX_REFUND_ACTION") {
      if (rid === "CONFIRM_WX_REFUND" || input === "yes") {
        var refAmt = sd.total;
        await supabase.from("bookings").update({ refund_status: "REQUESTED", refund_amount: refAmt, refund_notes: "100% weather refund" }).eq("id", sd.booking_id);
        await logE(tenant, "refund_requested", { booking_id: sd.booking_id, amount: refAmt }, sd.booking_id);
        await sendText(tenant, phone, "Done! A full refund of *R" + refAmt + "* has been submitted \u2014 expect it within 5\u20137 business days.\n\nWe\u2019d love to have you back on the water soon! \u{1F6F6}");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      } else {
        await sendText(tenant, phone, "No worries, your booking remains cancelled and untouched. You can manage it again from the My Bookings menu.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      }
    }

    // ===== CONFIRM VOUCHER =====
    else if (state === "CONFIRM_VOUCHER_CONVERT") {
      if (rid === "CONFIRM_VOUCHER" || input === "yes") {
        var vcode = genVoucherCode();
        var vr = await supabase.from("vouchers").insert({ business_id: tenant.business.id, code: vcode, status: "ACTIVE", type: "FREE_TRIP", source_booking_id: sd.booking_id, expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString() }).select().single();
        if (vr.error) { await sendText(tenant, phone, "Something went wrong. Let me connect you to our team."); await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" }); return; }
        await supabase.from("bookings").update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: "Converted to voucher " + vcode, converted_to_voucher_id: vr.data.id }).eq("id", sd.booking_id);
        if (sd.slot_id) { var svr = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single(); if (svr.data) await supabase.from("slots").update({ booked: Math.max(0, svr.data.booked - sd.qty) }).eq("id", sd.slot_id); }
        await logE(tenant, "voucher_from_booking", { booking_id: sd.booking_id, code: vcode }, sd.booking_id);
        // Email voucher to customer
        try {
          var vEmail = await supabase.from("bookings").select("email").eq("id", sd.booking_id).single();
          if (vEmail.data && vEmail.data.email) {
            await fetch(SUPABASE_URL + "/functions/v1/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
              body: JSON.stringify({ type: "VOUCHER", data: { email: vEmail.data.email, code: vcode, expires_at: fmtTime(tenant, new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString()) } }),
            });
          }
        } catch (e) { console.log("voucher email err"); }
        await sendText(tenant, phone, "All done! Here\u2019s your voucher:\n\n\u{1F39F} Code: *" + vcode + "*\n\u{1F381} Good for: *One free trip* (any tour, any group size)\n\u{1F4C5} Valid until: " + fmtTime(tenant, new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString()) + "\n\nShare it with a friend or use it yourself \u2014 just type *menu* and select *Redeem Voucher* when you\u2019re ready!");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      } else { await sendText(tenant, phone, "No worries, your booking stays as is! \u{1F389}"); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); }
    }

    // ===== FAQ LIST =====
    else if (state === "FAQ_LIST") {
      var faqMap: any = { FAQ_MEET: "meeting_point", FAQ_BRING: "what_to_bring", FAQ_CANCEL: "cancellation", FAQ_DURATION: "duration", FAQ_SAFE: "safety", FAQ_WEATHER: "weather", FAQ_PRICE: "pricing", FAQ_AGE: "age", FAQ_PARKING: "parking", FAQ_EXPECT: "what_to_expect" };
      var key = faqMap[rid];
      var keyAnswer = key ? getFaqAnswer(tenant, key) : null;
      if (key && keyAnswer) {
        await sendText(tenant, phone, keyAnswer);
        await sendText(tenant, phone, "Anything else? Just ask, or:");
        await sendButtons(tenant, phone, "Quick actions:", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "FAQ_LIST", title: "\u2753 More Questions" }, { id: "IDLE", title: "\u2B05 Main Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
      } else {
        // Try natural language match even in FAQ state
        var fk = matchFAQ(input);
        var fkAnswer = fk ? getFaqAnswer(tenant, fk) : null;
        if (fk && fkAnswer) {
          await sendText(tenant, phone, fkAnswer);
          await sendButtons(tenant, phone, "Anything else?", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "FAQ_LIST", title: "\u2753 More Questions" }, { id: "IDLE", title: "\u2B05 Main Menu" }]);
          await setConvo(convo.id, { current_state: "MENU" });
        } else {
          await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
          await handleMsg(tenant, phone, "hi", "text");
        }
      }
    }

    // ===== ASK QTY =====
    else if (state === "ASK_QTY") {
      var qty = parseInt(input);
      if (isNaN(qty) || qty < 1 || qty > 30) { await sendText(tenant, phone, "Just need a number between 1 and 30 \u{1F60A}"); return; }

      // Check if there are ANY valid slots left in general (just to catch waitlist cases)
      var tourSlots = sd.tour_id ? await getAvailSlotsForTour(tenant, sd.tour_id, 60) : await getAvailSlots(tenant, 60);
      var fitting = tourSlots.filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) >= qty; });

      if (fitting.length === 0) {
        await sendText(tenant, phone, "Ah, we are fully booked for " + qty + " people right now. Want me to add you to the waitlist? I\u2019ll message you as soon as a spot opens up!");
        await sendButtons(tenant, phone, "Options:", [{ id: "WAITLIST_YES", title: "\u{1F4CB} Join Waitlist" }, { id: "BOOK", title: "\u{1F6F6} Try Another Tour" }, { id: "IDLE", title: "\u2B05 Back" }]);
        await setConvo(convo.id, { current_state: "WAITLIST_OFFER", state_data: { ...sd, qty: qty } });
        return;
      }

      await typingDelay();
      // Show upcoming dates preview so user doesn't have to guess
      var previewMsg = qty + " " + (qty === 1 ? "person" : "people") + " \u2014 nice! \u{1F4C5}\n\nHere\u2019s what\u2019s coming up:\n";
      try {
        var previewSlots = await supabase.from("slots").select("start_time, capacity_total, booked, held, status, tour_id")
          .eq("business_id", tenant.business.id).gt("start_time", new Date().toISOString())
          .lte("start_time", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
          .order("start_time", { ascending: true });
        var pvSlots = previewSlots.data || [];
        // Group by date
        var pvDays: any = {};
        for (var pvi = 0; pvi < pvSlots.length; pvi++) {
          var pvs = pvSlots[pvi];
          var pvDate = formatDateOnly(tenant, pvs.start_time, { weekday: "short", day: "numeric", month: "short" });
          if (!pvDays[pvDate]) pvDays[pvDate] = { open: 0, closed: 0, full: 0 };
          if (pvs.status !== "OPEN") { pvDays[pvDate].closed++; }
          else if (pvs.capacity_total - pvs.booked - (pvs.held || 0) < qty) { pvDays[pvDate].full++; }
          else { pvDays[pvDate].open++; }
        }
        var pvKeys = Object.keys(pvDays);
        var pvShown = 0;
        for (var pvk = 0; pvk < pvKeys.length && pvShown < 5; pvk++) {
          var pvd = pvDays[pvKeys[pvk]];
          if (pvd.open > 0) { previewMsg += "\u2022 " + pvKeys[pvk] + " \u2014 " + pvd.open + " trip" + (pvd.open > 1 ? "s" : "") + " available\n"; }
          else if (pvd.closed > 0 && pvd.open === 0 && pvd.full === 0) { previewMsg += "\u2022 " + pvKeys[pvk] + " \u2014 \u274C Closed (weather)\n"; }
          else { previewMsg += "\u2022 " + pvKeys[pvk] + " \u2014 Fully booked\n"; }
          pvShown++;
        }
        if (pvShown > 0) { previewMsg += "\nType a date to see times!"; }
        else { previewMsg += "No upcoming trips in the next week. Type any date to check!"; }
      } catch (pvErr) { previewMsg += "\nType a date to see times! (e.g., 'Tomorrow' or '1 September')"; }
      await sendText(tenant, phone, previewMsg);
      await setConvo(convo.id, { current_state: "PICK_DATE", state_data: { ...sd, qty: qty } });
    }

    // ===== PICK DATE (new step) =====
    else if (state === "PICK_DATE") {
      var pickedDate = "";

      // Attempt Natural Language Date Parsing if they typed it instead of clicking
      if (rawText) {
        if (GK) {
          try {
            var r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, {
              method: "POST", headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(5000),
              body: JSON.stringify({
                system_instruction: { parts: [{ text: `You are a date extractor. The user is asking for a date. Today is ${new Date().toISOString().split("T")[0]}. Return exactly one YYYY-MM-DD date string based on their input, or "INVALID" if no date is found. Examples: "Tomorrow" -> next date. "1 September" -> 2026-09-01.` }] },
                contents: [{ role: "user", parts: [{ text: rawText }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 15 }
              })
            });
            var d = await r.json();
            if (d.candidates?.[0]?.content?.parts?.[0]) {
              var extracted = d.candidates[0].content.parts[0].text.trim();
              if (extracted !== "INVALID" && extracted.match(/^\d{4}-\d{2}-\d{2}$/)) pickedDate = extracted;
            }
          } catch (e) { }
        }
      }

      if (!pickedDate) {
        await sendText(tenant, phone, "Please type a clear date like 'Tomorrow' or '1 September'.");
        return;
      }

      // Convert the picked local date into a UTC range using the tenant timezone.
      var startIso = zonedDateTimeToUtcIso(tenant, pickedDate, 0, 0);
      var endIso = zonedDateTimeToUtcIso(tenant, pickedDate, 24, 0);

      var slotQ = supabase.from("slots").select("id, start_time, capacity_total, booked, held, status, is_peak, price_per_person_override, tour_id, tours(name, base_price_per_person)")
        .eq("business_id", tenant.business.id)
        .gte("start_time", startIso)
        .lt("start_time", endIso)
        .order("start_time", { ascending: true });

      // Don't filter by tour_id — show ALL activities for the date so user can see all options

      var { data: dbSlots } = await slotQ;

      var pdFormatted = formatDateOnly(tenant, zonedDateTimeToUtcIso(tenant, pickedDate, 12, 0), { weekday: "long", day: "numeric", month: "short" });

      if (!dbSlots || dbSlots.length === 0) {
        await sendText(tenant, phone, "We don\u2019t have any trips scheduled for " + pdFormatted + " yet. Try a date in the next 2 weeks! \u{1F4C5}");
        return;
      }

      var openSlots = [];
      var allClosed = true;
      var hasOpenButFull = false;

      for (var ts of dbSlots) {
        if (ts.status === "OPEN") {
          allClosed = false;
          var t_avail = ts.capacity_total - ts.booked - (ts.held || 0);
          if (t_avail >= sd.qty) {
            openSlots.push(ts);
          } else {
            hasOpenButFull = true;
          }
        }
      }

      if (allClosed) {
        await sendText(tenant, phone, "\u26C5 Unfortunately *" + pdFormatted + "* is closed due to bad weather. Please choose another date \u2014 type a new date to try again!");
        return;
      }

      if (openSlots.length === 0) {
        if (hasOpenButFull) {
          await sendText(tenant, phone, "All trips on *" + pdFormatted + "* are fully booked for " + sd.qty + " people. Try another date or a smaller group! \u{1F4C5}");
        } else {
          await sendText(tenant, phone, "No available trips on *" + pdFormatted + "*. Try another date! \u{1F4C5}");
        }
        return;
      }

      // Multiple or 1 slot — show time picker via numbered text menu (cap at 10)
      var maxDisplay = 10;
      var timeTxt = pdFormatted + " \u2014 pick a time (reply with a number):\n\n";
      var slotMap: any = {};
      var displayCount = Math.min(openSlots.length, maxDisplay);
      for (var ti = 0; ti < displayCount; ti++) {
        var os = openSlots[ti];
        var oavl = os.capacity_total - os.booked - (os.held || 0);
        var opri = os.price_per_person_override || os.tours?.base_price_per_person || 600;
        var otime = formatTimeOnly(tenant, os.start_time, { hour: "2-digit", minute: "2-digit" });
        var tName = os.tours?.name ? os.tours.name + " \u2022 " : "";
        timeTxt += (ti + 1) + ". " + tName + otime + " (" + oavl + " spots, R" + opri + "/pp)\n";
        slotMap[ti + 1] = os.id;
      }
      if (openSlots.length > maxDisplay) timeTxt += "\n...and " + (openSlots.length - maxDisplay) + " more times available!";

      await typingDelay();
      await sendText(tenant, phone, timeTxt.trim());

      // Update state to use the freshly grabbed slots so price checking relies on them.
      await setConvo(convo.id, { current_state: "PICK_SLOT", state_data: { ...sd, slot_map: slotMap } });
    }

    // ===== PICK SLOT =====
    else if (state === "PICK_SLOT") {
      var slotId = "";
      var num = parseInt(input.replace(/[^\d]/g, ""));
      if (!isNaN(num) && sd.slot_map && sd.slot_map[num]) {
        slotId = sd.slot_map[num];
      }
      if (!slotId) { await sendText(tenant, phone, "Please reply with a valid number from the list."); return; }
      var sr2 = await supabase.from("slots").select("*").eq("id", slotId).single();
      var slot = sr2.data;
      if (!slot) { await sendText(tenant, phone, "That slot is no longer available. Let\u2019s pick another date \u2014 type a date to try again!"); await setConvo(convo.id, { current_state: "PICK_DATE" }); return; }
      if (slot.status !== "OPEN") { await sendText(tenant, phone, "That slot has been closed (possibly due to weather). Let\u2019s pick another date \u2014 type a new date!"); await setConvo(convo.id, { current_state: "PICK_DATE" }); return; }
      var slotAvailRes = await supabase.rpc("slot_available_capacity", { p_slot_id: slotId });
      var slotAvail = Number(slotAvailRes.data || 0);
      if (slotAvail < sd.qty) { await sendText(tenant, phone, "Not enough spots left on that trip for " + sd.qty + " people (only " + slotAvail + " left). Try another option from the list or type a new date!"); await setConvo(convo.id, { current_state: "PICK_DATE" }); return; }

      if (sd.is_reschedule) {
        await sendText(tenant, phone, "Processing your change... \u23F3");
        var { data: rbData, error: rbErr } = await supabase.functions.invoke("rebook-booking", {
          body: {
            booking_id: sd.booking_id,
            new_slot_id: slotId,
            excess_action: "VOUCHER"
          }
        });
        if (rbErr || rbData?.error) {
          await sendText(tenant, phone, "Something went wrong changing your booking. Let me connect you to our team.");
          await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
          return;
        }
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }

      var price = await getSlotPrice(slot);
      var baseTotal = price * sd.qty;
      var disc = await calcDiscount(tenant, sd.qty, phone);
      var finalTotal = baseTotal; var discountMsg = "";
      if (disc.percent > 0) {
        var saving = Math.round(baseTotal * disc.percent / 100); finalTotal = baseTotal - saving;
        if (disc.type === "GROUP") discountMsg = "\n\u{1F389} *5% group discount applied!* You save R" + saving;
        if (disc.type === "LOYALTY") discountMsg = "\n\u{1F31F} *10% loyalty discount!* You save R" + saving;
      }
      // Check if voucher booking — subtract voucher value from total
      var voucherDeduction = 0;
      if (sd.voucher_id) {
        var voucherValue = Number(sd.voucher_value || 0);
        voucherDeduction = Math.min(voucherValue, finalTotal);
        finalTotal = Math.max(0, finalTotal - voucherDeduction);
        if (finalTotal === 0) {
          discountMsg = "\n\u{1F39F} *Voucher applied \u2014 this trip is on us!*";
        } else {
          discountMsg = "\n\u{1F39F} *Voucher applied \u2014 R" + voucherDeduction + " off!*";
        }
      }
      var tourName2 = await supabase.from("tours").select("name").eq("id", slot.tour_id).single();
      var summary = "Here\u2019s your booking summary:\n\n\u{1F6F6} *" + (tourName2.data?.name || "Tour") + "*\n\u{1F4C5} " + fmtTime(tenant, slot.start_time) + "\n\u{1F465} " + sd.qty + " " + (sd.qty === 1 ? "person" : "people") + "\n\u{1F4B0} R" + price + " \u00D7 " + sd.qty + " = R" + baseTotal;
      if (sd.voucher_id && finalTotal === 0) summary += discountMsg + "\n*Total: FREE*";
      else if (sd.voucher_id && finalTotal > 0) summary += discountMsg + "\n*Remaining: R" + finalTotal + "*";
      else if (disc.percent > 0) summary += discountMsg + "\n*Total: R" + finalTotal + "*";
      else summary += "\n*Total: R" + finalTotal + "*";
      summary += "\n\nLook good?";
      var confirmBtns = [{ id: "CONFIRM", title: finalTotal > 0 ? "\u2705 Pay R" + finalTotal : "\u2705 Confirm (FREE)" }, { id: "IDLE", title: "\u274C Cancel" }];
      if (finalTotal > 0) confirmBtns.splice(1, 0, { id: "ADD_VOUCHER", title: "\u{1F39F} Add Voucher" });
      await sendButtons(tenant, phone, summary, confirmBtns);
      await setConvo(convo.id, { current_state: "CONFIRM_BOOKING", state_data: { ...sd, slot_id: slotId, tour_id: slot.tour_id, unit_price: price, base_total: baseTotal, total: finalTotal, discount_type: disc.type, discount_percent: disc.percent, voucher_deduction: voucherDeduction || 0 } });
    }

    // ===== CONFIRM BOOKING =====
    else if (state === "CONFIRM_BOOKING") {
      if (rid === "IDLE" || input === "no" || input === "cancel") { await sendText(tenant, phone, "No worries, cancelled! Type *menu* whenever you\u2019re ready."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      if (rid === "ADD_VOUCHER") {
        await sendText(tenant, phone, "Enter your voucher code:");
        await setConvo(convo.id, { current_state: "ADD_EXTRA_VOUCHER" });
        return;
      }
      if (rid === "CONFIRM" || input === "yes") {
        await typingDelay();
        await sendText(tenant, phone, "Brilliant! Just need a couple of details to lock it in.\n\nPlease reply with your:\n- Full Name\n- Email Address\n\n*(You can just send them together in one message!)*");
        await setConvo(convo.id, { current_state: "ASK_DETAILS", state_data: sd });
      }
    }

    // ===== ASK DETAILS (also handles ASK_NAME_EMAIL) =====
    else if (state === "ASK_DETAILS" || state === "ASK_NAME_EMAIL") {
      var dParts = rawText.split(/[,;\n]+/).map(function (p) { return p.trim(); }).filter(function (p) { return p.length > 0; });
      // Restore any partial data saved from a previous message in this state
      var dName = sd.partial_name || "";
      var dEmail = sd.partial_email || "";
      for (var dp of dParts) {
        var dc = dp.replace(/^(name|email)[:\-\s]*/i, "").trim();
        if (!dc) continue;
        // Use regex to extract just the email address, handles trailing text like "john@email.com but ..."
        var emailMatch = dc.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
        if (emailMatch && !dEmail) { dEmail = emailMatch[0].toLowerCase(); }
        else if (!emailMatch && dc.match(/[a-zA-Z]/) && !dName) { dName = dc; }
      }

      if (!dName || !dEmail) {
        var dMiss = []; if (!dName) dMiss.push("full name"); if (!dEmail) dMiss.push("email address");
        // Save whatever was valid so the next message doesn't start from scratch
        await setConvo(convo.id, { state_data: { ...sd, partial_name: dName || sd.partial_name || "", partial_email: dEmail || sd.partial_email || "" } });
        var missMsg = dMiss.length === 1
          ? "Got it! I just need your " + dMiss[0] + " now:"
          : "I still need your " + dMiss.join(" and ") + ".\n\nPlease send them together, e.g.:\n*John Smith, john@email.com*";
        await sendText(tenant, phone, missMsg);
        return;
      }
      var customDefs = await getBookingCustomFields(tenant);
      if (customDefs.length > 0) {
        await setConvo(convo.id, { current_state: "ASK_CUSTOM_FIELDS", state_data: { ...sd, customer_name: dName, email: dEmail, custom_field_defs: customDefs, custom_fields: {}, partial_name: undefined, partial_email: undefined } });
        await typingDelay();
        await sendText(tenant, phone, "Almost done.\n\n" + promptForCustomField(customDefs[0]));
        return;
      }
      await setConvo(convo.id, { current_state: "FINALIZE_BOOKING", state_data: { ...sd, customer_name: dName, email: dEmail, partial_name: undefined, partial_email: undefined } });
      await typingDelay();
      await handleMsg(tenant, phone, "internal_proceed", "text", null); // Auto-advance to finalize
    }

    else if (state === "ASK_CUSTOM_FIELDS") {
      var defs = Array.isArray(sd.custom_field_defs) ? sd.custom_field_defs : [];
      var values = { ...(sd.custom_fields || {}) };
      var currentField = nextCustomField(defs, values);
      if (!currentField) {
        await setConvo(convo.id, { current_state: "FINALIZE_BOOKING", state_data: { ...sd, custom_fields: values } });
        await typingDelay();
        await handleMsg(tenant, phone, "internal_proceed", "text", null);
        return;
      }

      var fieldValue = rawText.trim();
      if (!fieldValue && currentField.required) {
        await sendText(tenant, phone, "I still need this before I can lock in the booking:\n\n" + promptForCustomField(currentField));
        return;
      }

      values[currentField.key] = fieldValue;
      var upcomingField = nextCustomField(defs, values);
      if (upcomingField) {
        await setConvo(convo.id, { state_data: { ...sd, custom_fields: values } });
        await sendText(tenant, phone, "Got it.\n\n" + promptForCustomField(upcomingField));
        return;
      }

      await setConvo(convo.id, { current_state: "FINALIZE_BOOKING", state_data: { ...sd, custom_fields: values } });
      await typingDelay();
      await handleMsg(tenant, phone, "internal_proceed", "text", null);
      return;
    }

    // ===== FINALIZE BOOKING =====
    else if (state === "FINALIZE_BOOKING") {
      var email = sd.email;
      var br2 = await supabase.from("bookings").insert({
        business_id: tenant.business.id, tour_id: sd.tour_id, slot_id: sd.slot_id,
        customer_name: sd.customer_name, phone: phone, email: email,
        qty: sd.qty, unit_price: sd.unit_price, total_amount: sd.total,
        original_total: sd.base_total, discount_type: sd.discount_type || null, discount_percent: sd.discount_percent || 0,
        status: "PENDING", source: "WHATSAPP", custom_fields: sd.custom_fields || {},
      }).select().single();
      if (br2.error || !br2.data) { console.error("Err:", JSON.stringify(br2.error)); await sendText(tenant, phone, "Something went wrong. Let me connect you to our team."); await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" }); return; }
      var booking = br2.data;

      // VOUCHER BOOKING — skip payment
      if (sd.voucher_id && sd.total <= 0) {
        await supabase.from("bookings").update({ status: "PAID", yoco_payment_id: "VOUCHER_" + sd.voucher_code }).eq("id", booking.id);
        // Mark voucher as used
        // Redeem all vouchers
        var allVIds = sd.voucher_ids || [sd.voucher_id];
        for (var vi = 0; vi < allVIds.length; vi++) {
          if (allVIds[vi]) await supabase.from("vouchers").update({ status: "REDEEMED", redeemed_at: new Date().toISOString(), redeemed_by_phone: phone, redeemed_booking_id: booking.id }).eq("id", allVIds[vi]);
        }
        // Update slot booked count
        var svr2 = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single();
        if (svr2.data) await supabase.from("slots").update({ booked: svr2.data.booked + sd.qty }).eq("id", sd.slot_id);
        var vref = booking.id.substring(0, 8).toUpperCase();
        var vslot = await supabase.from("slots").select("start_time").eq("id", sd.slot_id).single();
        var vtour = await supabase.from("tours").select("name").eq("id", sd.tour_id).single();
        var waiverLink = resolveWaiverLink(tenant.business, booking.id, (booking as any).waiver_token);
        await logE(tenant, "voucher_booking_confirmed", { booking_id: booking.id, voucher_code: sd.voucher_code }, booking.id);
        // Upsell second trip
        var otherTours2 = (await getActiveTours(tenant)).filter(function (t: any) { return t.id !== sd.tour_id; });
        if (otherTours2.length > 0) {
          var upsellTour = otherTours2[0];
          setTimeout(async function () {
            try {
              await sendText(tenant, phone, "\u{1F4A1} Psst! How about adding a *" + upsellTour.name + "* to your trip? Book both and enjoy even more of Cape Town\u2019s coastline!\n\nJust type *book* to add another tour.");
            } catch (e) { }
          }, 5000);
        }
        await sendText(tenant, phone,
          "\u{1F389} *You\u2019re all set!*\n\n" +
          "\u{1F4CB} Ref: " + vref + "\n" +
          "\u{1F6F6} " + (vtour.data?.name || "Tour") + "\n" +
          "\u{1F4C5} " + (vslot.data ? fmtTime(tenant, vslot.data.start_time) : "TBC") + "\n" +
          "\u{1F465} " + sd.qty + " people\n" +
          "\u{1F39F} Paid with voucher *" + sd.voucher_code + "*\n\n" +
          (waiverLink ? "\u{1F4DD} Waiver: " + waiverLink + "\n\n" : "") +
          "\u{1F4CD} *Meeting Point:* Check your confirmation details from " + businessName(tenant) + " for arrival instructions.\n\n" +
          "\u{1F392} *Bring:* Sunscreen, hat, towel, water bottle\n\n" +
          "See you soon! \u{1F30A}"
        );
        // Send confirmation email
        try {
          await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({ type: "BOOKING_CONFIRM", data: { booking_id: booking.id, business_id: tenant.business.id, email: email, customer_name: sd.customer_name, ref: vref, tour_name: vtour.data?.name || "Tour", start_time: vslot.data ? fmtTime(tenant, vslot.data.start_time) : "TBC", qty: sd.qty, total_amount: "FREE (voucher)" } }),
          });
        } catch (e) { }
        await setConvo(convo.id, { current_state: "IDLE", state_data: {}, last_booking_id: booking.id, customer_name: sd.customer_name, email: email });
        return;
      }

      // PAID BOOKING — create hold + Yoco checkout
      var hr2 = await supabase.from("holds").insert({ booking_id: booking.id, slot_id: sd.slot_id, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), status: "ACTIVE" }).select().single();
      if (hr2.error) { await supabase.from("bookings").update({ status: "CANCELLED", cancellation_reason: "Hold failed" }).eq("id", booking.id); await sendText(tenant, phone, "Those spots were just snapped up! Let\u2019s try again."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      try { var sn = await supabase.from("slots").select("held").eq("id", sd.slot_id).single(); await supabase.from("slots").update({ held: Number(sn.data?.held || 0) + sd.qty }).eq("id", sd.slot_id); } catch (e) { }
      await supabase.from("bookings").update({ status: "HELD" }).eq("id", booking.id);
      await logE(tenant, "hold_created", { booking_id: booking.id }, booking.id);

      var bookingSiteUrls = await getBusinessSiteUrls(tenant);
      console.log("YOCO_CALL: key_len=" + tenant.credentials.yocoSecretKey.length + " amount=" + Math.round(sd.total * 100)); var yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
        method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Math.round(sd.total * 100), currency: tenant.business.currency || "ZAR",
          successUrl: withQuery(bookingSiteUrls.bookingSuccessUrl, { ref: booking.id }),
          cancelUrl: bookingSiteUrls.bookingCancelUrl,
          failureUrl: bookingSiteUrls.bookingCancelUrl,
          metadata: { booking_id: booking.id, customer_name: sd.customer_name, qty: String(sd.qty) },
        }),
      });
      var yocoData = await yocoRes.json();
      console.log("YOCO:" + JSON.stringify(yocoData));
      var payUrl = "";
      if (yocoData && yocoData.id && yocoData.redirectUrl) {
        await supabase.from("bookings").update({ yoco_checkout_id: yocoData.id }).eq("id", booking.id);
        payUrl = yocoData.redirectUrl;
      } else { payUrl = "Payment link unavailable \u2014 type *speak to us* for help"; }
      var ref = booking.id.substring(0, 8).toUpperCase();
      await sendText(tenant, phone, "Almost there, " + sd.customer_name.split(" ")[0] + "! \u{1F389}\n\n\u{1F4CB} Ref: " + ref + "\n\u{1F4B0} Total: R" + sd.total + "\n\nComplete your payment here:\n" + payUrl + "\n\n\u23F0 Your spots are held for 15 minutes.");
      await setConvo(convo.id, { current_state: "AWAITING_PAYMENT", state_data: { booking_id: booking.id }, last_booking_id: booking.id, customer_name: sd.customer_name, email: email });
      await logE(tenant, "payment_link_sent", { booking_id: booking.id }, booking.id);
    }

    // ===== AWAITING PAYMENT =====
    else if (state === "AWAITING_PAYMENT") {
      if (input === "help" || input === "speak" || input === "human" || input.includes("speak to")) { await sendText(tenant, phone, "Connecting you to our team..."); await setConvo(convo.id, { status: "HUMAN" }); }
      else { await sendText(tenant, phone, "Just waiting for your payment to come through! \u{1F4B3}\n\nAlready paid? It can take a moment to process.\n\nNeed help? Type *speak to us*\nStart over? Type *menu*"); }
    }

    // ===== REDEEM VOUCHER =====

    // ===== GIFT VOUCHER PURCHASE =====
    else if (state === "GV_PICK_TOUR") {
      var tourId = rid ? rid.replace("GV_", "") : "";
      if (!tourId) { await sendText(tenant, phone, "Please pick a tour from the list."); return; }
      var tourInfo = await supabase.from("tours").select("*").eq("id", tourId).single();
      if (!tourInfo.data) { await sendText(tenant, phone, "Can't find that tour. Let's try again."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      var t = tourInfo.data;
      await sendText(tenant, phone, "\u{1F381} *" + t.name + " Gift Voucher*\nValue: R" + t.base_price_per_person + "\n\nWho is this voucher for? Type their name (e.g. Sarah):");
      await setConvo(convo.id, { current_state: "GV_RECIPIENT_NAME", state_data: { tour_id: tourId, tour_name: t.name, value: t.base_price_per_person } });
    }

    else if (state === "GV_RECIPIENT_NAME") {
      if (rawText.length < 1) { await sendText(tenant, phone, "Please type the recipient's name:"); return; }
      await sendText(tenant, phone, "Nice! And would you like to add a personal message?\n\nType your message (e.g. \"Happy Birthday! Enjoy the adventure!\")\n\nOr type *skip* to skip:");
      await setConvo(convo.id, { current_state: "GV_MESSAGE", state_data: { ...sd, recipient_name: rawText } });
    }

    else if (state === "GV_MESSAGE") {
      var giftMsg = (input === "skip" || input === "no") ? "" : rawText;
      await sendText(tenant, phone, "Almost done! I just need your details.\n\nWhat's your full name?");
      await setConvo(convo.id, { current_state: "GV_BUYER_NAME", state_data: { ...sd, gift_message: giftMsg } });
    }

    else if (state === "GV_BUYER_NAME") {
      if (rawText.length < 2) { await sendText(tenant, phone, "Please type your full name:"); return; }
      await sendText(tenant, phone, "Thanks " + rawText.split(" ")[0] + "! And your email address? (We'll send the voucher here)");
      await setConvo(convo.id, { current_state: "GV_BUYER_EMAIL", state_data: { ...sd, buyer_name: rawText } });
    }

    else if (state === "GV_BUYER_EMAIL") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawText)) { await sendText(tenant, phone, "That doesn't look like a valid email. Try again?"); return; }
      var buyerEmail = rawText.toLowerCase();
      var summary = "\u{1F381} *Gift Voucher Summary*\n\n" +
        "\u{1F6F6} " + sd.tour_name + "\n" +
        "\u{1F4B0} R" + sd.value + "\n" +
        "\u{1F465} For: " + sd.recipient_name + "\n";
      if (sd.gift_message) summary += "\u{1F4AC} Message: \"" + sd.gift_message + "\"\n";
      summary += "\u{1F4E7} Send to: " + buyerEmail + "\n\nLook good?";
      await sendButtons(tenant, phone, summary, [{ id: "GV_CONFIRM", title: "\u2705 Pay R" + sd.value }, { id: "IDLE", title: "\u274C Cancel" }]);
      await setConvo(convo.id, { current_state: "GV_CONFIRM", state_data: { ...sd, buyer_email: buyerEmail } });
    }

    else if (state === "GV_CONFIRM") {
      if (rid === "IDLE" || input === "no" || input === "cancel") {
        await sendText(tenant, phone, "No worries, cancelled! Type *menu* whenever you're ready.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }
      if (rid === "GV_CONFIRM" || input === "yes") {
        // Create voucher in PENDING status
        var vcode = genVoucherCode();
        var vr = await supabase.from("vouchers").insert({
          business_id: tenant.business.id, code: vcode, status: "PENDING", type: "FREE_TRIP",
          recipient_name: sd.recipient_name, gift_message: sd.gift_message || null,
          buyer_name: sd.buyer_name, buyer_email: sd.buyer_email, buyer_phone: phone,
          tour_name: sd.tour_name, value: sd.value, purchase_amount: sd.value,
          expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        }).select().single();

        if (vr.error || !vr.data) {
          console.error("GV_ERR:", JSON.stringify(vr.error));
          await sendText(tenant, phone, "Something went wrong. Let me connect you to our team.");
          await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
          return;
        }

        // Create Yoco checkout
        // Uses global tenant.credentials.yocoSecretKey
        var voucherSiteUrls = await getBusinessSiteUrls(tenant);
        var yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
          method: "POST",
          headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Math.round(Number(sd.value) * 100), currency: tenant.business.currency || "ZAR",
            successUrl: withQuery(voucherSiteUrls.voucherSuccessUrl, { code: vcode }),
            cancelUrl: voucherSiteUrls.bookingCancelUrl,
            failureUrl: voucherSiteUrls.bookingCancelUrl,
            metadata: { voucher_id: vr.data.id, voucher_code: vcode, type: "GIFT_VOUCHER" },
          }),
        });
        var yocoData = await yocoRes.json();
        console.log("YOCO_GV:" + JSON.stringify(yocoData));

        if (yocoData && yocoData.id && yocoData.redirectUrl) {
          await supabase.from("vouchers").update({ yoco_checkout_id: yocoData.id }).eq("id", vr.data.id);
          await sendText(tenant, phone,
            "\u{1F381} Great! Complete your payment to generate the voucher:\n\n" +
            "\u{1F4B0} Amount: R" + sd.value + "\n" +
            "\u{1F517} " + yocoData.redirectUrl + "\n\n" +
            "Once paid, the voucher will be emailed to " + sd.buyer_email
          );
        } else {
          await sendText(tenant, phone, "Payment link unavailable. Type *speak to us* for help.");
        }
        await setConvo(convo.id, { current_state: "GV_AWAITING_PAYMENT", state_data: { voucher_id: vr.data.id, voucher_code: vcode, buyer_email: sd.buyer_email } });
      }
    }

    else if (state === "GV_AWAITING_PAYMENT") {
      if (input === "help" || input.includes("speak to")) {
        await sendText(tenant, phone, "Connecting you to our team...");
        await setConvo(convo.id, { status: "HUMAN" });
      } else {
        await sendText(tenant, phone, "Just waiting for your payment to come through!\n\nAlready paid? It can take a moment to process.\n\nNeed help? Type *speak to us*\nStart over? Type *menu*");
      }
    }


    else if (state === "REDEEM_VOUCHER") {
      var code = rawText.toUpperCase().replace(/\s/g, "");
      if (code.length !== 8) { await sendText(tenant, phone, "Voucher codes are 8 characters long. Double-check and try again:"); return; }
      var vr2 = await supabase.from("vouchers").select().eq("code", code).eq("status", "ACTIVE").single();
      if (!vr2.data) {
        // Check if redeemed
        var vUsed = await supabase.from("vouchers").select("status").eq("code", code).single();
        if (vUsed.data && vUsed.data.status === "REDEEMED") {
          await sendText(tenant, phone, "This voucher has already been redeemed. Each voucher code can only be used once.");
          await sendButtons(tenant, phone, "Options:", [{ id: "ADD_VOUCHER", title: "\u{1F39F} Try Another" }, { id: "CONFIRM", title: "\u2705 Continue" }, { id: "IDLE", title: "\u2B05 Back" }]);
          await setConvo(convo.id, { current_state: "CONFIRM_BOOKING" }); return;
        }
        await sendText(tenant, phone, "Hmm, that code doesn\u2019t seem to be valid. Check for typos and try again, or type *speak to us* for help.");
        await sendButtons(tenant, phone, "Options:", [{ id: "VOUCHER", title: "\u{1F39F} Try Again" }, { id: "HUMAN", title: "\u{1F4AC} Get Help" }, { id: "IDLE", title: "\u2B05 Back" }]);
        await setConvo(convo.id, { current_state: "MENU" }); return;
      }
      if (vr2.data.expires_at && new Date(vr2.data.expires_at) < new Date()) { await sendText(tenant, phone, "Unfortunately this voucher has expired. Type *speak to us* if you think this is a mistake."); await setConvo(convo.id, { current_state: "IDLE" }); return; }

      // Get voucher value
      var vVal = Number(vr2.data.value || vr2.data.purchase_amount || 0);
      var tours3 = await getActiveTours(tenant);
      if (tours3.length === 1) {
        await sendText(tenant, phone, "\u{1F389} Voucher accepted! (R" + vVal + " credit)\n\nHow many people will be joining?");
        await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { voucher_code: code, voucher_id: vr2.data.id, voucher_value: vVal, tour_id: tours3[0].id } });
      } else {
        var vtrows: any[] = [];
        for (var vti = 0; vti < tours3.length; vti++) {
          var vtr = tours3[vti];
          vtrows.push({ id: "TOUR_" + vtr.id, title: vtr.name, description: vtr.duration_minutes + " min \u2022 normally R" + vtr.base_price_per_person + "/pp" });
        }
        await sendText(tenant, phone, "\u{1F389} Voucher accepted! (R" + vVal + " credit)\n\nWhich tour would you like?");
        await sendList(tenant, phone, "Pick your adventure:", "Choose Tour", [{ title: "Tours", rows: vtrows }]);
        await setConvo(convo.id, { current_state: "PICK_TOUR", state_data: { voucher_code: code, voucher_id: vr2.data.id, voucher_value: vVal } });
      }
    }


    // ===== ADD EXTRA VOUCHER =====
    else if (state === "ADD_EXTRA_VOUCHER") {
      var xcode = rawText.toUpperCase().replace(/\s/g, "");
      if (xcode.length !== 8) { await sendText(tenant, phone, "Voucher codes are 8 characters long. Try again:"); return; }
      var xvr = await supabase.from("vouchers").select().eq("code", xcode).eq("status", "ACTIVE").single();
      if (!xvr.data) {
        var xUsed = await supabase.from("vouchers").select("status").eq("code", xcode).single();
        if (xUsed.data && xUsed.data.status === "REDEEMED") {
          await sendText(tenant, phone, "This voucher has already been redeemed. Each code can only be used once.");
        } else {
          await sendText(tenant, phone, "That code doesn\u2019t seem valid. Check for typos and try again.");
        }
        await sendButtons(tenant, phone, "Options:", [{ id: "ADD_VOUCHER", title: "\u{1F39F} Try Again" }, { id: "CONFIRM", title: "\u2705 Continue" }, { id: "IDLE", title: "\u274C Cancel" }]);
        await setConvo(convo.id, { current_state: "CONFIRM_BOOKING" });
        return;
      }
      if (xvr.data.expires_at && new Date(xvr.data.expires_at) < new Date()) {
        await sendText(tenant, phone, "This voucher has expired.");
        await setConvo(convo.id, { current_state: "CONFIRM_BOOKING" });
        return;
      }
      // Stack the voucher value
      var xVal = Number(xvr.data.value || xvr.data.purchase_amount || 0);
      var existingVoucherValue = Number(sd.voucher_value || 0);
      var newVoucherValue = existingVoucherValue + xVal;
      // Store multiple voucher codes and IDs
      var vCodes = (sd.voucher_codes || [sd.voucher_code].filter(Boolean));
      vCodes.push(xcode);
      var vIds = (sd.voucher_ids || [sd.voucher_id].filter(Boolean));
      vIds.push(xvr.data.id);
      // Recalculate total
      var newDeduction = Math.min(newVoucherValue, Number(sd.base_total));
      var newTotal = Math.max(0, Number(sd.base_total) - newDeduction);
      // Apply any other discounts too
      if (sd.discount_percent > 0 && !sd.voucher_id) {
        var discSaving = Math.round(Number(sd.base_total) * sd.discount_percent / 100);
        newTotal = Math.max(0, newTotal - discSaving);
      }
      var xMsg = "\u{1F39F} *Second voucher applied!* (R" + xVal + " credit)\n\n";
      if (newTotal === 0) xMsg += "Your trip is now *completely FREE!*";
      else xMsg += "Remaining balance: *R" + newTotal + "*";
      await sendText(tenant, phone, xMsg);
      var updatedSd = { ...sd, voucher_value: newVoucherValue, voucher_codes: vCodes, voucher_ids: vIds, voucher_deduction: newDeduction, total: newTotal };
      var cBtns = [{ id: "CONFIRM", title: newTotal > 0 ? "\u2705 Pay R" + newTotal : "\u2705 Confirm (FREE)" }, { id: "IDLE", title: "\u274C Cancel" }];
      if (newTotal > 0) cBtns.splice(1, 0, { id: "ADD_VOUCHER", title: "\u{1F39F} Add Voucher" });
      await sendButtons(tenant, phone, "Ready to proceed?", cBtns);
      await setConvo(convo.id, { current_state: "CONFIRM_BOOKING", state_data: updatedSd });
    }


    // ===== ASK MODE =====
    else if (state === "ASK_MODE") {
      // Smart context-aware answering with database lookups
      await typingDelay();

      // PRIORITY 1: Check booking-related intents first (before FAQ!)
      var wantReschedule = input.includes("reschedule") || input.includes("move") && (input.includes("booking") || input.includes("trip")) || (input.includes("change") && (input.includes("date") || input.includes("time") || input.includes("booking") || input.includes("day")));
      var wantCancel = (input.includes("cancel") && !input.includes("cancellation") && !input.includes("policy")) || (input.includes("refund") && input.includes("my"));
      var wantMyBooking = input.includes("my booking") || input.includes("my trip") || input.includes("my tour") || (input.includes("booking") && (input.includes("today") || input.includes("made") || input.includes("check") || input.includes("status") || input.includes("when") || input.includes("detail") || input.includes("info"))) || (input.includes("when") && (input.includes("my") || input.includes("trip") || input.includes("tour") || input.includes("paddle"))) || (input.includes("what time") && input.includes("my")) || (input.includes("how many") && input.includes("my")) || (input.includes("ref") && (input.includes("my") || input.includes("booking")));
      var wantBook = input.includes("book") && (input.includes("want") || input.includes("like") || input.includes("can i"));
      var wantAddPeople = (input.includes("add") || input.includes("more") || input.includes("extra")) && (input.includes("people") || input.includes("person") || input.includes("pax") || input.includes("guest") || input.includes("friend"));
      var wantReducePeople = (input.includes("reduce") || input.includes("remove") || input.includes("less") || input.includes("fewer")) && (input.includes("people") || input.includes("person") || input.includes("pax"));
      var wantChangeTour = (input.includes("change") || input.includes("switch") || input.includes("swap")) && (input.includes("tour") || input.includes("sea") || input.includes("sunset"));
      var wantChangeName = (input.includes("change") || input.includes("update") || input.includes("wrong")) && (input.includes("name") || input.includes("person"));
      var wantPaymentLink = input.includes("payment") && (input.includes("link") || input.includes("pay") || input.includes("again") || input.includes("new")) || (input.includes("didn") && input.includes("pay")) || input.includes("resend");
      var wantConfirmEmail = (input.includes("email") || input.includes("confirmation")) && (input.includes("resend") || input.includes("again") || input.includes("didn") || input.includes("not received") || input.includes("haven"));
      var wantReceipt = input.includes("receipt") || input.includes("invoice") || input.includes("proof") && input.includes("payment");
      var wantWrongDate = (input.includes("wrong") && (input.includes("date") || input.includes("day") || input.includes("time"))) || (input.includes("booked") && input.includes("wrong"));

      // If they want to book, go straight to booking flow
      if (wantBook && !wantReschedule && !wantCancel) {
        await setConvo(convo.id, { current_state: "MENU" });
        await handleMsg(tenant, phone, "book", "text");
        return;
      }

      // Handle wrong date as reschedule
      if (wantWrongDate) { wantReschedule = true; }

      // Handle add/reduce people, change tour, change name — connect to team
      if (wantAddPeople) {
        var addBkr = await supabase.from("bookings").select("id, qty, total_amount, unit_price, slot_id, tour_id, slots(start_time, capacity_total, booked, held), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (addBkr.data) {
          var addBk = addBkr.data; var addRef = addBk.id.substring(0, 8).toUpperCase();
          var addSlot = (addBk as any).slots; var addTour = (addBk as any).tours;
          var addAvail = addSlot ? addSlot.capacity_total - addSlot.booked - (addSlot.held || 0) : 0;
          await sendText(tenant, phone, "Your booking *" + addRef + "* currently has " + addBk.qty + " people on " + (addTour?.name || "Tour") + " \u2014 " + (addSlot ? fmtTime(tenant, addSlot.start_time) : "TBC") + ".\n\n" + (addAvail > 0 ? "There are " + addAvail + " extra spots available.\n\n" : "This slot is full unfortunately.\n\n") + "How many people total would you like? (Currently " + addBk.qty + ")");
          await setConvo(convo.id, { current_state: "MODIFY_QTY", state_data: { booking_id: addBk.id, slot_id: addBk.slot_id, tour_id: addBk.tour_id, current_qty: addBk.qty, unit_price: addBk.unit_price, max_avail: addBk.qty + addAvail } });
        } else {
          await sendText(tenant, phone, "I couldn\u2019t find an active booking. Try My Bookings or contact our team.");
          await sendButtons(tenant, phone, "Options:", [{ id: "MY_BOOKINGS", title: "\u{1F4CB} My Bookings" }, { id: "IDLE", title: "\u2B05 Menu" }]);
          await setConvo(convo.id, { current_state: "MENU" });
        }
        return;
      }

      if (wantReducePeople) {
        var redBkr = await supabase.from("bookings").select("id, qty, total_amount, unit_price, slot_id, tour_id, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (redBkr.data) {
          var redBk = redBkr.data; var redRef = redBk.id.substring(0, 8).toUpperCase();
          var redSlot = (redBk as any).slots; var redTour = (redBk as any).tours;
          var redHrs = redSlot ? (new Date(redSlot.start_time).getTime() - Date.now()) / (1000 * 60 * 60) : 0;
          var refundNote = redHrs >= 24 ? "You\u2019ll get a refund for the difference." : "As it\u2019s within 24 hours, the refund policy applies.";
          await sendText(tenant, phone, "Your booking *" + redRef + "* has " + redBk.qty + " people on " + (redTour?.name || "Tour") + ".\n\n" + refundNote + "\n\nHow many people total would you like? (Currently " + redBk.qty + ")");
          await setConvo(convo.id, { current_state: "MODIFY_QTY", state_data: { booking_id: redBk.id, slot_id: redBk.slot_id, tour_id: redBk.tour_id, current_qty: redBk.qty, unit_price: redBk.unit_price, max_avail: 30, hours_before: redHrs } });
        } else {
          await sendText(tenant, phone, "No active booking found. Try My Bookings.");
          await setConvo(convo.id, { current_state: "MENU" });
        }
        return;
      }

      if (wantChangeTour) {
        var ctBkr = await supabase.from("bookings").select("id, qty, total_amount, unit_price, slot_id, tour_id, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (ctBkr.data) {
          var ctBk = ctBkr.data; var ctRef = ctBk.id.substring(0, 8).toUpperCase();
          var ctTour = (ctBk as any).tours;
          var ctSlot = (ctBk as any).slots;
          var tours = await getActiveTours(tenant);
          var otherTours = tours.filter(function (t: any) { return t.id !== ctBk.tour_id; });
          if (otherTours.length > 0) {
            await sendText(tenant, phone, "Your booking *" + ctRef + "* is for *" + (ctTour?.name || "Tour") + "* on " + (ctSlot ? fmtTime(tenant, ctSlot.start_time) : "TBC") + ".\n\nWhich tour would you like to switch to?");
            var ctRows = otherTours.map(function (t: any) { return { id: "CHTOUR_" + t.id, title: t.name, description: "R" + t.base_price_per_person + "/pp \u2022 " + t.duration_minutes + " min" }; });
            await sendList(tenant, phone, "Pick a new tour:", "Choose Tour", [{ title: "Available Tours", rows: ctRows }]);
            await setConvo(convo.id, { current_state: "CHANGE_TOUR_PICK", state_data: { booking_id: ctBk.id, slot_id: ctBk.slot_id, tour_id: ctBk.tour_id, qty: ctBk.qty, current_tour: ctTour?.name } });
          } else {
            await sendText(tenant, phone, "No other tours available right now.");
            await setConvo(convo.id, { current_state: "MENU" });
          }
        } else {
          await sendText(tenant, phone, "No active booking found.");
          await setConvo(convo.id, { current_state: "MENU" });
        }
        return;
      }

      if (wantChangeName) {
        var nmBkr = await supabase.from("bookings").select("id, customer_name, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (nmBkr.data) {
          var nmBk = nmBkr.data; var nmRef = nmBk.id.substring(0, 8).toUpperCase();
          await sendText(tenant, phone, "The booking *" + nmRef + "* is currently under *" + nmBk.customer_name + "*. What should the new name be?");
          await setConvo(convo.id, { current_state: "CHANGE_NAME", state_data: { booking_id: nmBk.id } });
        } else {
          await sendText(tenant, phone, "No active booking found.");
          await setConvo(convo.id, { current_state: "MENU" });
        }
        return;
      }

      // Handle payment link resend
      if (wantPaymentLink) {
        var payBkr = await supabase.from("bookings").select("id, status, total_amount, yoco_checkout_id, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["HELD", "PENDING"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (payBkr.data && payBkr.data.yoco_checkout_id) {
          // Create new checkout
          var rpBk = payBkr.data;
          var rpRef = rpBk.id.substring(0, 8).toUpperCase();
          var resendSiteUrls = await getBusinessSiteUrls(tenant);
          var rpYoco = await fetch("https://payments.yoco.com/api/checkouts", {
            method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: Math.round(Number(rpBk.total_amount) * 100), currency: tenant.business.currency || "ZAR",
              successUrl: withQuery(resendSiteUrls.bookingSuccessUrl, { ref: rpBk.id }),
              cancelUrl: resendSiteUrls.bookingCancelUrl,
              failureUrl: resendSiteUrls.bookingCancelUrl,
              metadata: { booking_id: rpBk.id, type: "RESEND" },
            }),
          });
          var rpYocoData = await rpYoco.json();
          if (rpYocoData?.redirectUrl) {
            await supabase.from("bookings").update({ yoco_checkout_id: rpYocoData.id }).eq("id", rpBk.id);
            await sendText(tenant, phone, "Here\u2019s a fresh payment link for booking *" + rpRef + "* (R" + rpBk.total_amount + "):\n\n" + rpYocoData.redirectUrl + "\n\n\u23F0 Your spots are held for 15 minutes.");
          } else {
            await sendText(tenant, phone, "Couldn\u2019t generate a new link. Let me connect you to our team.");
            await setConvo(convo.id, { status: "HUMAN" });
          }
        } else {
          await sendText(tenant, phone, "I couldn\u2019t find an unpaid booking. If you\u2019ve already paid, your confirmation email should be on the way! Check your spam folder too.");
          await sendButtons(tenant, phone, "Options:", [{ id: "MY_BOOKINGS", title: "\u{1F4CB} My Bookings" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        }
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // Handle confirmation email resend
      if (wantConfirmEmail) {
        var emBkr = await supabase.from("bookings").select("id, email, customer_name, qty, total_amount, status, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (emBkr.data) {
          var emBk = emBkr.data; var emRef = emBk.id.substring(0, 8).toUpperCase();
          try {
            await fetch(SUPABASE_URL + "/functions/v1/send-email", {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
              body: JSON.stringify({ type: "BOOKING_CONFIRM", data: { booking_id: emBk.id, business_id: tenant.business.id, email: emBk.email, customer_name: emBk.customer_name, ref: emRef, tour_name: (emBk as any).tours?.name || "Tour", start_time: (emBk as any).slots?.start_time ? fmtTime(tenant, (emBk as any).slots.start_time) : "TBC", qty: emBk.qty, total_amount: emBk.total_amount } }),
            });
            await sendText(tenant, phone, "Done! I\u2019ve resent the confirmation to *" + emBk.email + "* \u2709\uFE0F\n\nCheck your inbox (and spam folder). Ref: " + emRef);
          } catch (e) {
            await sendText(tenant, phone, "Something went wrong sending the email. Let me connect you to our team.");
          }
        } else {
          await sendText(tenant, phone, "I couldn\u2019t find a confirmed booking to resend. Check My Bookings or contact our team.");
        }
        await sendButtons(tenant, phone, "Anything else?", [{ id: "ASK", title: "\u2753 Another Question" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // Handle split payment
      var wantSplit = (input.includes("split") && input.includes("pay")) || (input.includes("separate") && input.includes("pay"));
      if (wantSplit) {
        var spBkr = await supabase.from("bookings").select("id, total_amount, status")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["HELD", "PENDING"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (spBkr.data) {
          await sendText(tenant, phone, "Sure! Your total is R" + spBkr.data.total_amount + ". How many people are splitting the payment? (2-10)");
          await setConvo(convo.id, { current_state: "SPLIT_PAYMENT_COUNT", state_data: { booking_id: spBkr.data.id, split_total: spBkr.data.total_amount } });
        } else {
          await sendText(tenant, phone, "No unpaid booking found. Start a new booking first!");
          await setConvo(convo.id, { current_state: "MENU" });
        }
        return;
      }

      // Handle cash/deposit request
      var wantCash = input.includes("cash") || (input.includes("deposit") && !input.includes("refund"));
      if (wantCash) {
        var cashBkr = await supabase.from("bookings").select("id, total_amount, status")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["HELD", "PENDING"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (cashBkr.data) {
          var depAmount = Math.round(Number(cashBkr.data.total_amount) * 0.5);
          var depositSiteUrls = await getBusinessSiteUrls(tenant);
          var depYoco = await fetch("https://payments.yoco.com/api/checkouts", {
            method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: Math.round(depAmount * 100), currency: tenant.business.currency || "ZAR",
              successUrl: withQuery(depositSiteUrls.bookingSuccessUrl, { ref: cashBkr.data.id }),
              cancelUrl: depositSiteUrls.bookingCancelUrl,
              metadata: { booking_id: cashBkr.data.id, type: "DEPOSIT_50" },
            }),
          });
          var depData = await depYoco.json();
          if (depData?.redirectUrl) {
            await sendText(tenant, phone, "No problem! Pay a 50% deposit (R" + depAmount + ") to secure your booking, and settle the rest in cash on the day:\n\n" + depData.redirectUrl);
          } else {
            await sendText(tenant, phone, "Couldn\u2019t generate deposit link. Contact our team.");
          }
        } else {
          await sendText(tenant, phone, "We ask for at least a 50% deposit online to secure your booking. Start a booking and I\u2019ll send you a deposit link!");
        }
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // Handle receipt request
      if (wantReceipt) {
        await sendText(tenant, phone, "Your confirmation email serves as your receipt. I can resend it if you need it! Just say \"resend my confirmation email\"\n\nFor a formal tax invoice, let me connect you to our team.");
        await sendButtons(tenant, phone, "Options:", [{ id: "HUMAN", title: "\u{1F4AC} Get Invoice" }, { id: "ASK", title: "\u2753 Another Question" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // Check weather concern
      if (!wantReschedule && !wantCancel && !wantMyBooking) {
        var weatherHandled = await checkWeatherConcern(tenant, phone, input);
        if (weatherHandled) { await setConvo(convo.id, { current_state: "MENU" }); return; }
      }

      // Check smart availability before FAQ
      if (!wantReschedule && !wantCancel && !wantMyBooking && detectAvailQuery(input)) {
        var askHandled = await handleSmartAvail(tenant, phone, input);
        if (askHandled) { await setConvo(convo.id, { current_state: "MENU" }); return; }
      }

      if (wantReschedule || wantCancel || wantMyBooking) {
        // Look up their bookings
        var askBkr = await supabase.from("bookings").select("id, status, qty, total_amount, slot_id, tour_id, created_at, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(5);
        var askBookings = askBkr.data || [];

        if (askBookings.length === 0) {
          await sendText(tenant, phone, "I couldn\u2019t find any active bookings linked to this phone number. If you booked with a different number, try the My Bookings page on our website with your email.");
          await sendButtons(tenant, phone, "What else?", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "ASK", title: "\u2753 Another Question" }, { id: "IDLE", title: "\u2B05 Menu" }]);
          await setConvo(convo.id, { current_state: "MENU" });
          return;
        }

        // If they want to reschedule
        if (wantReschedule) {
          if (askBookings.length === 1) {
            var rb = askBookings[0]; var rbSlot = (rb as any).slots; var rbTour = (rb as any).tours;
            var rbRef = rb.id.substring(0, 8).toUpperCase();
            var rbHrs = rbSlot ? (new Date(rbSlot.start_time).getTime() - Date.now()) / (1000 * 60 * 60) : 0;

            if (rbHrs < 24) {
              await sendText(tenant, phone, "Your booking *" + rbRef + "* for " + (rbTour?.name || "the tour") + " on " + (rbSlot ? fmtTime(tenant, rbSlot.start_time) : "TBC") + " is within 24 hours, so rescheduling isn\u2019t available anymore. You can contact our team for help.");
              await sendButtons(tenant, phone, "Options:", [{ id: "HUMAN", title: "\u{1F4AC} Speak to Team" }, { id: "IDLE", title: "\u2B05 Menu" }]);
              await setConvo(convo.id, { current_state: "MENU" });
              return;
            }

            // Check reschedule count
            var rCount = await supabase.from("bookings").select("reschedule_count").eq("id", rb.id).single();
            if (rCount.data && rCount.data.reschedule_count >= 2) {
              await sendText(tenant, phone, "You\u2019ve already rescheduled this booking twice. Let me connect you to our team.");
              await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
              return;
            }

            // Load slots for reschedule
            var askRSlots = rb.tour_id ? await getAvailSlotsForTour(tenant, rb.tour_id, 60) : await getAvailSlots(tenant, 60);
            var askRFitting = askRSlots.filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) >= rb.qty && s.id !== rb.slot_id; });

            if (askRFitting.length === 0) {
              await sendText(tenant, phone, "No alternative slots with enough space right now. Let me connect you to our team.");
              await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
              return;
            }

            await sendText(tenant, phone, "Sure! I found your booking:\n\n\u{1F6F6} *" + (rbTour?.name || "Tour") + "*\n\u{1F4C5} " + (rbSlot ? fmtTime(tenant, rbSlot.start_time) : "TBC") + "\n\u{1F465} " + rb.qty + " people\n\nPick a new date:");

            // Group by week
            var askRGroups: any = {};
            for (var ari = 0; ari < askRFitting.length; ari++) {
              var ars = askRFitting[ari]; var arsDate = new Date(ars.start_time);
              var arwStart = new Date(arsDate); arwStart.setDate(arwStart.getDate() - arwStart.getDay());
              var arwLabel = formatDateOnly(tenant, arwStart.toISOString(), { day: "numeric", month: "short" });
              var arwKey = arwStart.toISOString().split("T")[0];
              if (!askRGroups[arwKey]) askRGroups[arwKey] = { label: "Week of " + arwLabel, rows: [] };
              if (askRGroups[arwKey].rows.length < 10) {
                askRGroups[arwKey].rows.push({ id: "RSLOT_" + ars.id, title: fmtTime(tenant, ars.start_time).substring(0, 24), description: (ars.capacity_total - ars.booked - (ars.held || 0)) + " spots" });
              }
            }
            var askRSecs: any[] = []; var askRKeys = Object.keys(askRGroups).sort(); var askRTotal = 0;
            for (var ark = 0; ark < askRKeys.length && askRTotal < 10; ark++) {
              var arg = askRGroups[askRKeys[ark]]; var arRem = 10 - askRTotal;
              if (arg.rows.length > arRem) arg.rows = arg.rows.slice(0, arRem);
              askRTotal += arg.rows.length; askRSecs.push({ title: arg.label.substring(0, 24), rows: arg.rows });
            }
            await sendList(tenant, phone, "Scroll through weeks:", "View Dates", askRSecs);
            await setConvo(convo.id, { current_state: "RESCHEDULE_PICK", state_data: { booking_id: rb.id, slot_id: rb.slot_id, qty: rb.qty, total: rb.total_amount, tour_id: rb.tour_id, reschedule_count: rCount.data?.reschedule_count || 0 } });
            return;
          } else {
            // Multiple bookings — let them pick
            var rbMsg = "I found " + askBookings.length + " active bookings. Which one do you want to reschedule?\n\n";
            var rbRows: any[] = [];
            for (var rbi = 0; rbi < askBookings.length; rbi++) {
              var rbb = askBookings[rbi]; var rbbSlot = (rbb as any).slots; var rbbTour = (rbb as any).tours;
              var rbbRef = rbb.id.substring(0, 8).toUpperCase();
              rbMsg += (rbi + 1) + ". *" + rbbRef + "* \u2014 " + (rbbTour?.name || "Tour") + "\n   " + (rbbSlot ? fmtTime(tenant, rbbSlot.start_time) : "TBC") + "\n\n";
              rbRows.push({ id: "BK_" + rbb.id, title: rbbRef + " - " + (rbbTour?.name || "").substring(0, 15), description: rbbSlot ? fmtTime(tenant, rbbSlot.start_time).substring(0, 24) : "TBC" });
            }
            await sendList(tenant, phone, rbMsg, "Select Booking", [{ title: "Your Bookings", rows: rbRows }]);
            await setConvo(convo.id, { current_state: "MY_BOOKINGS_LIST" });
            return;
          }
        }

        // If they want to cancel
        if (wantCancel) {
          if (askBookings.length === 1) {
            var cb = askBookings[0]; var cbSlot = (cb as any).slots; var cbTour = (cb as any).tours;
            var cbRef = cb.id.substring(0, 8).toUpperCase();
            var cbHrs = cbSlot ? (new Date(cbSlot.start_time).getTime() - Date.now()) / (1000 * 60 * 60) : 0;
            var cbDetail = "I found your booking:\n\n\u{1F6F6} *" + (cbTour?.name || "Tour") + "*\n\u{1F4C5} " + (cbSlot ? fmtTime(tenant, cbSlot.start_time) : "TBC") + "\n\u{1F465} " + cb.qty + " people\n\n";
            if (cbHrs >= 24) {
              var cbRefund = Math.round(Number(cb.total_amount) * 0.95 * 100) / 100;
              cbDetail += "You\u2019ll get a *95% refund (R" + cbRefund + ")*. Cancel?";
            } else {
              cbDetail += "This is within 24 hours so *no refund* is available. Still cancel?";
            }
            await sendButtons(tenant, phone, cbDetail, [{ id: "CONFIRM_CANCEL", title: "\u2705 Yes, Cancel" }, { id: "IDLE", title: "\u274C Keep It" }]);
            await setConvo(convo.id, { current_state: "CONFIRM_CANCEL_ACTION", state_data: { booking_id: cb.id, slot_id: cb.slot_id, qty: cb.qty, total: cb.total_amount, hours_before: cbHrs } });
            return;
          } else {
            // Multiple — show list
            var cbMsg = "Which booking do you want to cancel?\n\n";
            var cbRows: any[] = [];
            for (var cbi = 0; cbi < askBookings.length; cbi++) {
              var cbb = askBookings[cbi]; var cbbSlot = (cbb as any).slots; var cbbTour = (cbb as any).tours;
              var cbbRef = cbb.id.substring(0, 8).toUpperCase();
              cbRows.push({ id: "BK_" + cbb.id, title: cbbRef + " - " + (cbbTour?.name || "").substring(0, 15), description: cbbSlot ? fmtTime(tenant, cbbSlot.start_time).substring(0, 24) : "TBC" });
            }
            await sendList(tenant, phone, cbMsg, "Select Booking", [{ title: "Your Bookings", rows: cbRows }]);
            await setConvo(convo.id, { current_state: "MY_BOOKINGS_LIST" });
            return;
          }
        }

        // General booking inquiry
        var bMsg = "Here are your active bookings:\n\n";
        for (var abi = 0; abi < askBookings.length; abi++) {
          var ab = askBookings[abi]; var abSlot = (ab as any).slots; var abTour = (ab as any).tours;
          bMsg += "\u{1F6F6} *" + (abTour?.name || "Tour") + "*\n\u{1F4C5} " + (abSlot ? fmtTime(tenant, abSlot.start_time) : "TBC") + "\n\u{1F465} " + ab.qty + " people \u2022 " + ab.status + "\nRef: " + ab.id.substring(0, 8).toUpperCase() + "\n\n";
        }
        bMsg += "Need to change anything?";
        await sendButtons(tenant, phone, bMsg, [{ id: "MY_BOOKINGS", title: "\u{1F4CB} Manage Bookings" }, { id: "ASK", title: "\u2753 Another Question" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // PRIORITY 2: Check FAQ (after booking intents)
      var askFaq = matchFAQ(input);
      var askFaqAnswer = askFaq ? getFaqAnswer(tenant, askFaq) : null;
      if (askFaq && askFaqAnswer) {
        await sendText(tenant, phone, askFaqAnswer);
        await sendButtons(tenant, phone, "Anything else?", [{ id: "ASK", title: "\u2753 Another Question" }, { id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // PRIORITY 3: Try Gemini with database context
      var gemContext = "";
      // Get their bookings for context
      var ctxBkr = await supabase.from("bookings").select("id, status, qty, total_amount, slots(start_time), tours(name)")
        .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED"])
        .order("created_at", { ascending: false }).limit(3);
      var ctxBookings = ctxBkr.data || [];
      if (ctxBookings.length > 0) {
        gemContext = "\nUser has these active bookings: ";
        for (var ci = 0; ci < ctxBookings.length; ci++) {
          var cb2 = ctxBookings[ci]; var cb2Slot = (cb2 as any).slots; var cb2Tour = (cb2 as any).tours;
          gemContext += (cb2Tour?.name || "Tour") + " on " + (cb2Slot ? fmtTime(tenant, cb2Slot.start_time) : "TBC") + " (" + cb2.qty + " ppl, " + cb2.status + "), ";
        }
      }

      // Get next available slots for context
      var ctxSlots = await getAvailSlots(tenant, 5);
      if (ctxSlots.length > 0) {
        gemContext += "\nNext available: ";
        for (var csi = 0; csi < ctxSlots.length; csi++) {
          var cs = ctxSlots[csi];
          gemContext += fmtTime(tenant, cs.start_time) + " (" + (cs.capacity_total - cs.booked - (cs.held || 0)) + " spots), ";
        }
      }

      // Call Gemini with full context
      if (GK) {
        try {
          var ctxR = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: buildGeminiInstruction(tenant, gemContext) }] },
              contents: [{ role: "user", parts: [{ text: rawText }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 200 }
            })
          });
          var ctxD = await ctxR.json();
          if (ctxD.candidates?.[0]?.content?.parts?.[0]) {
            await sendText(tenant, phone, ctxD.candidates[0].content.parts[0].text);
            await sendButtons(tenant, phone, "Anything else?", [{ id: "ASK", title: "\u2753 Another Question" }, { id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Menu" }]);
            await setConvo(convo.id, { current_state: "MENU" });
            return;
          }
        } catch (e) { console.log("Gem err:", e); }
      }

      // Fallback
      await sendText(tenant, phone, "Hmm, I\u2019m not sure about that one. Try asking in a different way, or pick an option below:");
      await sendButtons(tenant, phone, "Options:", [{ id: "ASK", title: "\u2753 Try Again" }, { id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Menu" }]);
      await setConvo(convo.id, { current_state: "MENU" });
    }

    // ===== MODIFY QTY =====
    else if (state === "MODIFY_QTY") {
      var newQty = parseInt(input);
      if (isNaN(newQty) || newQty < 1 || newQty > 30) { await sendText(tenant, phone, "Just need a number between 1 and 30:"); return; }
      if (newQty === sd.current_qty) { await sendText(tenant, phone, "That\u2019s the same as your current booking! No changes needed \u{1F60A}"); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      if (newQty > sd.max_avail) { await sendText(tenant, phone, "Only " + sd.max_avail + " spots available. Try a smaller number:"); return; }
      var qtyDiff = newQty - sd.current_qty;
      // Recalculate discount for new qty (group discount threshold may change)
      var mqDisc = await calcDiscount(tenant, newQty, phone);
      var mqBaseTotal = newQty * Number(sd.unit_price);
      var newTotal = mqBaseTotal;
      if (mqDisc.percent > 0) { newTotal = mqBaseTotal - Math.round(mqBaseTotal * mqDisc.percent / 100); }
      var oldTotal = sd.current_qty * Number(sd.unit_price);
      var oldDisc = await calcDiscount(tenant, sd.current_qty, phone);
      if (oldDisc.percent > 0) { oldTotal = oldTotal - Math.round(oldTotal * oldDisc.percent / 100); }
      var diffAmount = Math.abs(newTotal - oldTotal);
      // Update booking
      await supabase.from("bookings").update({ qty: newQty, total_amount: newTotal, discount_type: mqDisc.type || null, discount_percent: mqDisc.percent || 0 }).eq("id", sd.booking_id);
      // Update slot booked count
      var mqSlot = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single();
      if (mqSlot.data) await supabase.from("slots").update({ booked: Math.max(0, mqSlot.data.booked + qtyDiff) }).eq("id", sd.slot_id);
      if (qtyDiff > 0) {
        // Added people - need additional payment
        var addSiteUrls = await getBusinessSiteUrls(tenant);
        var addYoco = await fetch("https://payments.yoco.com/api/checkouts", {
          method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Math.round(diffAmount * 100), currency: tenant.business.currency || "ZAR",
            successUrl: withQuery(addSiteUrls.bookingSuccessUrl, { ref: sd.booking_id }),
            cancelUrl: addSiteUrls.bookingCancelUrl,
            failureUrl: addSiteUrls.bookingCancelUrl,
            metadata: { booking_id: sd.booking_id, type: "ADD_PEOPLE" },
          }),
        });
        var addYocoData = await addYoco.json();
        if (addYocoData?.redirectUrl) {
          await sendText(tenant, phone, "Updated to " + newQty + " people! \u2705\n\nYou need to pay an extra *R" + diffAmount + "* for the " + qtyDiff + " additional " + (qtyDiff === 1 ? "person" : "people") + ":\n\n" + addYocoData.redirectUrl);
        } else {
          await sendText(tenant, phone, "Updated to " + newQty + " people! Please contact our team to arrange the additional payment of R" + diffAmount + ".");
        }
      } else {
        // Reduced people
        if (sd.hours_before >= 24) {
          await supabase.from("bookings").update({ refund_status: "REQUESTED", refund_amount: diffAmount, refund_notes: "Qty reduced from " + sd.current_qty + " to " + newQty }).eq("id", sd.booking_id);
          await sendText(tenant, phone, "Updated to " + newQty + " people! \u2705\n\nA refund of *R" + diffAmount + "* has been submitted \u2014 expect it within 5-7 business days.");
        } else {
          await sendText(tenant, phone, "Updated to " + newQty + " people! \u2705\n\nAs this is within 24 hours, the refund policy applies for the difference.");
        }
      }
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
    }

    // ===== CHANGE TOUR PICK =====
    else if (state === "CHANGE_TOUR_PICK") {
      var newTourId = rid ? rid.replace("CHTOUR_", "") : "";
      if (!newTourId) { await sendText(tenant, phone, "Please pick a tour from the list."); return; }
      var newTourInfo = await supabase.from("tours").select("*").eq("id", newTourId).single();
      if (!newTourInfo.data) { await sendText(tenant, phone, "Can\u2019t find that tour."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      var nt = newTourInfo.data;
      // Find a slot for the new tour on a similar date
      var newSlots = await getAvailSlotsForTour(tenant, newTourId, 60);
      var fitting2 = newSlots.filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) >= sd.qty; });
      if (fitting2.length === 0) { await sendText(tenant, phone, "No available slots for " + nt.name + " with " + sd.qty + " spots. Contact our team for help."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      // Group by week
      var ctGroups: any = {};
      for (var cti = 0; cti < fitting2.length; cti++) {
        var cts = fitting2[cti]; var ctsDate = new Date(cts.start_time);
        var ctwStart = new Date(ctsDate); ctwStart.setDate(ctwStart.getDate() - ctwStart.getDay());
        var ctwLabel = formatDateOnly(tenant, ctwStart.toISOString(), { day: "numeric", month: "short" });
        var ctwKey = ctwStart.toISOString().split("T")[0];
        if (!ctGroups[ctwKey]) ctGroups[ctwKey] = { label: "Week of " + ctwLabel, rows: [] };
        if (ctGroups[ctwKey].rows.length < 10) {
          ctGroups[ctwKey].rows.push({ id: "CTSLOT_" + cts.id, title: fmtTime(tenant, cts.start_time).substring(0, 24), description: (cts.capacity_total - cts.booked - (cts.held || 0)) + " spots" });
        }
      }
      var ctSecs: any[] = []; var ctKeys2 = Object.keys(ctGroups).sort(); var ctTotal2 = 0;
      for (var ctk = 0; ctk < ctKeys2.length && ctTotal2 < 10; ctk++) {
        var ctg = ctGroups[ctKeys2[ctk]]; var ctRem = 10 - ctTotal2;
        if (ctg.rows.length > ctRem) ctg.rows = ctg.rows.slice(0, ctRem);
        ctTotal2 += ctg.rows.length; ctSecs.push({ title: ctg.label.substring(0, 24), rows: ctg.rows });
      }
      await sendText(tenant, phone, "Switching to *" + nt.name + "* (R" + nt.base_price_per_person + "/pp). Pick a date:");
      await sendList(tenant, phone, "Available times:", "View Dates", ctSecs);
      await setConvo(convo.id, { current_state: "CHANGE_TOUR_SLOT", state_data: { ...sd, new_tour_id: newTourId, new_tour_name: nt.name, new_price: nt.base_price_per_person } });
    }

    // ===== CHANGE TOUR SLOT =====
    else if (state === "CHANGE_TOUR_SLOT") {
      var ctSlotId = rid ? rid.replace("CTSLOT_", "") : "";
      if (!ctSlotId) { await sendText(tenant, phone, "Please pick a slot."); return; }
      // Release old slot
      var oldSlotR = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single();
      if (oldSlotR.data) await supabase.from("slots").update({ booked: Math.max(0, oldSlotR.data.booked - sd.qty) }).eq("id", sd.slot_id);
      // Book new slot
      var newSlotR = await supabase.from("slots").select("booked, start_time").eq("id", ctSlotId).single();
      if (newSlotR.data) await supabase.from("slots").update({ booked: newSlotR.data.booked + sd.qty }).eq("id", ctSlotId);
      var newTotal2 = sd.qty * Number(sd.new_price);
      await supabase.from("bookings").update({ tour_id: sd.new_tour_id, slot_id: ctSlotId, unit_price: sd.new_price, total_amount: newTotal2 }).eq("id", sd.booking_id);
      await sendText(tenant, phone, "All done! \u2705 Switched to *" + sd.new_tour_name + "* on " + (newSlotR.data ? fmtTime(tenant, newSlotR.data.start_time) : "TBC") + ".\n\nSee you on the water! \u{1F30A}");
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
    }

    // ===== CHANGE NAME =====
    else if (state === "CHANGE_NAME") {
      if (rawText.length < 2) { await sendText(tenant, phone, "Please type the new name:"); return; }
      await supabase.from("bookings").update({ customer_name: rawText }).eq("id", sd.booking_id);
      await sendText(tenant, phone, "Updated! The booking is now under *" + rawText + "* \u2705");
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
    }

    // ===== SPLIT PAYMENT =====
    else if (state === "SPLIT_PAYMENT_COUNT") {
      var splitCount = parseInt(input);
      if (isNaN(splitCount) || splitCount < 2 || splitCount > 10) { await sendText(tenant, phone, "How many payment links do you need? (2-10)"); return; }
      var splitAmount = Math.round(Number(sd.split_total) / splitCount * 100) / 100;
      var splitLinks = "";
      for (var spi = 0; spi < splitCount; spi++) {
        var splitSiteUrls = await getBusinessSiteUrls(tenant);
        var spYoco = await fetch("https://payments.yoco.com/api/checkouts", {
          method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Math.round(splitAmount * 100), currency: tenant.business.currency || "ZAR",
            successUrl: withQuery(splitSiteUrls.bookingSuccessUrl, { ref: sd.booking_id }),
            cancelUrl: splitSiteUrls.bookingCancelUrl,
            metadata: { booking_id: sd.booking_id, type: "SPLIT_" + (spi + 1) + "_OF_" + splitCount },
          }),
        });
        var spData = await spYoco.json();
        if (spData?.redirectUrl) splitLinks += "\nPayment " + (spi + 1) + " (R" + splitAmount + "): " + spData.redirectUrl;
      }
      if (splitLinks) {
        await sendText(tenant, phone, "Here are your " + splitCount + " payment links (R" + splitAmount + " each):" + splitLinks);
      } else {
        await sendText(tenant, phone, "Couldn\u2019t generate split links. Contact our team for help.");
      }
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
    }

    // ===== WAITLIST OFFER =====
    else if (state === "WAITLIST_OFFER") {
      if (rid === "WAITLIST_YES" || input.includes("yes") || input.includes("waitlist")) {
        var wlName = convo.customer_name || null;
        await supabase.from("waitlist").insert({
          business_id: tenant.business.id, tour_id: sd.tour_id, phone: phone,
          customer_name: wlName, qty: sd.qty, status: "WAITING"
        });
        await sendText(tenant, phone, "You\u2019re on the waitlist! \u2705 I\u2019ll message you as soon as " + sd.qty + " spots open up. You can also try a different date or tour in the meantime.");
        await sendButtons(tenant, phone, "Anything else?", [{ id: "BOOK", title: "\u{1F6F6} Try Different Date" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU", state_data: {} });
      } else {
        await setConvo(convo.id, { current_state: "MENU", state_data: {} });
        if (rid === "BOOK") await handleMsg(tenant, phone, "book", "text");
        else await handleMsg(tenant, phone, "hi", "text");
      }
    }

    // ===== RESCHEDULE PICK (user picked a new slot from reschedule list) =====
    else if (state === "RESCHEDULE_PICK") {
      var rSlotId = rid ? rid.replace("RSLOT_", "") : "";
      if (!rSlotId) { await sendText(tenant, phone, "Please pick a slot from the list."); return; }
      // Re-fetch and validate the slot
      var rSlotR = await supabase.from("slots").select("*, tours(name)").eq("id", rSlotId).single();
      var rSlot = rSlotR.data;
      if (!rSlot) { await sendText(tenant, phone, "That slot is no longer available. Let\u2019s try again — type *reschedule* to start over."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      if (rSlot.status !== "OPEN") { await sendText(tenant, phone, "That slot has been closed (possibly due to weather). Try *reschedule* again for updated options."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      var rAvail = rSlot.capacity_total - rSlot.booked - (rSlot.held || 0);
      if (rAvail < sd.qty) { await sendText(tenant, phone, "Not enough spots left on that slot for " + sd.qty + " people. Try *reschedule* again."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      // Call rebook-booking
      await sendText(tenant, phone, "Processing your reschedule... \u23F3");
      var { data: rbkData, error: rbkErr } = await supabase.functions.invoke("rebook-booking", {
        body: {
          booking_id: sd.booking_id,
          new_slot_id: rSlotId,
          excess_action: "VOUCHER"
        }
      });
      if (rbkErr || rbkData?.error) {
        console.error("RESCHEDULE_PICK rebook err:", rbkErr || rbkData?.error);
        await sendText(tenant, phone, "Something went wrong changing your booking. Let me connect you to our team.");
        await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
        return;
      }
      await sendText(tenant, phone, "\u2705 *Booking Rescheduled!*\n\nYour trip has been moved to:\n\u{1F6F6} " + (rSlot.tours?.name || "Tour") + "\n\u{1F4C5} " + fmtTime(tenant, rSlot.start_time) + "\n\u{1F465} " + sd.qty + " people\n\nType *menu* anytime to manage your booking.");
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
    }

    // ===== WEATHER REFUND =====
    else if (state === "MENU" && rid && rid.startsWith("WEATHER_REFUND_")) {
      var wrBkId = rid.replace("WEATHER_REFUND_", "");
      var wrBk = await supabase.from("bookings").select("id, total_amount, slot_id, qty").eq("id", wrBkId).single();
      if (wrBk.data) {
        await supabase.from("bookings").update({ status: "CANCELLED", cancellation_reason: "Weather cancellation", refund_status: "REQUESTED", refund_amount: wrBk.data.total_amount }).eq("id", wrBkId);
        if (wrBk.data.slot_id) {
          var wrSl = await supabase.from("slots").select("booked").eq("id", wrBk.data.slot_id).single();
          if (wrSl.data) await supabase.from("slots").update({ booked: Math.max(0, wrSl.data.booked - wrBk.data.qty) }).eq("id", wrBk.data.slot_id);
        }
        await sendText(tenant, phone, "Full refund of R" + wrBk.data.total_amount + " submitted \u2705 Expect it back on your card within 5-7 business days.\n\nWe\u2019d love to have you back when the weather plays along! Type *book* anytime \u{1F30A}");
      }
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
    }

    // ===== FALLBACK =====
    else {
      // Try FAQ match from any state
      var fallbackFaq = matchFAQ(input);
      var fallbackFaqAnswer = fallbackFaq ? getFaqAnswer(tenant, fallbackFaq) : null;
      if (fallbackFaq && fallbackFaqAnswer) {
        await sendText(tenant, phone, fallbackFaqAnswer);
        await sendButtons(tenant, phone, "Anything else?", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "MY_BOOKINGS", title: "\u{1F4CB} My Bookings" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
      } else {
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        await handleMsg(tenant, phone, "hi", "text");
      }
    }
  } catch (botErr: any) {
    console.error("HANDLEMSG_CRASH:", botErr);
    try {
      await logE(tenant, "BOT_CRASH", { error: String(botErr), stack: botErr?.stack, input: text });
      await sendText(tenant, phone, "Oops, something went wrong on our end! \u{1F61E} Please try again or type *menu* to start over.");
    } catch (_) { }
  }
}

Deno.serve(async (req: any) => {
  var url = new URL(req.url);
  if (req.method === "GET") {
    var mode = url.searchParams.get("hub.mode"); var token = url.searchParams.get("hub.verify_token"); var challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method === "POST") {
    try {
      var body = await req.json();
      var tenant = await resolveTenantByWhatsappPayload(supabase, body);
      var message = body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0];
      if (!message) return new Response("OK", { status: 200 });
      var ph = message.from; var mt = message.type; var txt = ""; var inter = null;
      if (mt === "text") txt = (message.text && message.text.body) || "";
      else if (mt === "interactive") { inter = message.interactive; txt = (inter.button_reply && inter.button_reply.title) || (inter.list_reply && inter.list_reply.title) || ""; }
      else if (mt === "document") txt = "[Document Sent]";
      else if (mt === "image") txt = "[Image Sent]";
      else { console.log("SKIP non-text msg type:" + mt + " from:" + ph); return new Response("OK", { status: 200 }); }
      console.log("F:" + ph + " B:" + tenant.business.id + " T:" + txt);
      await handleMsg(tenant, ph, txt, mt, inter);
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("E:", err);
      return new Response("Webhook error", { status: 500 });
    }
  }
  return new Response("Not allowed", { status: 405 });
});
