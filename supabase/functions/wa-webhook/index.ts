// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  resolveBusinessSiteUrls,
  resolveTenantByWhatsappPayload,
  sendWhatsappFreeformOrSignal,
  type TenantContext,
} from "../_shared/tenant.ts";
import { resolveWaiverLink } from "../_shared/waiver.ts";

const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_APP_SECRET = Deno.env.get("WA_APP_SECRET") || "";
const BOOKING_SUCCESS_URL = Deno.env.get("BOOKING_SUCCESS_URL") || "";
const BOOKING_CANCEL_URL = Deno.env.get("BOOKING_CANCEL_URL") || "";
const VOUCHER_SUCCESS_URL = Deno.env.get("VOUCHER_SUCCESS_URL") || "";
const supabase = createServiceClient();
const GK = Deno.env.get("GEMINI_API_KEY") || "";

// ───────── Meta x-hub-signature-256 verification (HMAC-SHA256) ─────────
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function verifyMetaSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!WA_APP_SECRET) {
    console.error("WA_APP_SECRET not configured — rejecting webhook for safety");
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const providedHex = signatureHeader.substring(7);
  const providedBytes = hexToBytes(providedHex);
  if (providedBytes.length !== 32) return false;
  try {
    const keyData = new TextEncoder().encode(WA_APP_SECRET);
    const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const computed = new Uint8Array(sigBuf);
    return timingSafeEqual(computed, providedBytes);
  } catch (e) {
    console.error("HMAC verify failed:", e);
    return false;
  }
}

function withQuery(base: string, params: Record<string, string>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
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
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].type !== "literal") values[parts[i].type] = parts[i].value;
  }
  const utcTs = Date.UTC(
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
  const [year, month, day] = dateKey.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimeZoneOffsetMs(guess, tenantTimeZone(tenant));
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
  const faqJson = tenant.business.faq_json || {};
  if (faqJson && typeof faqJson === "object" && !Array.isArray(faqJson) && typeof faqJson[key] === "string") {
    return faqJson[key];
  }
  return null;
}

function buildGeminiInstruction(tenant: TenantContext, extraContext?: string) {
  const sections = [
    String(tenant.business.ai_system_prompt || "").trim(),
    "Use the tenant FAQ and terminology below. Keep replies short, factual, and never invent availability, pricing, or policies.",
  ];

  const terminologyText = serializeTerminology(tenant.business.terminology);
  if (terminologyText) sections.push("Terminology: " + terminologyText);

  const faqText = serializeFaqForPrompt(tenant.business.faq_json);
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
  const res = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + tenant.credentials.waToken, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to, ...body }),
  });
  const data = await res.json();
  console.log("WA:" + JSON.stringify(data));

  // If we get an error about outside the 24 hour window (code 131047 or similar), 
  // we fallback to sending a generic template message to wake the user up.
  if (!res.ok && data.error && (data.error.code === 131047 || (data.error.message && data.error.message.includes("24")))) {
    console.log("Outside 24h window, sending template fallback...");
    const templateRes = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + tenant.credentials.waToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: {
          // TODO: Replace "hello_world" with an approved WhatsApp template name from Meta Business Suite
          name: "hello_world",
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
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildGeminiInstruction(tenant, extraContext) }] },
        contents: [{ role: "user", parts: [{ text: msg }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 150 }
      })
    });
    const d = await r.json();
    if (d.candidates?.[0]?.content?.parts?.[0]) return d.candidates[0].content.parts[0].text;
    return null;
  } catch (e) { return null; }
}
async function getConvo(tenant: TenantContext, phone: any) {
  const r = await supabase.from("conversations").select().eq("business_id", tenant.business.id).eq("phone", phone).single();
  if (r.data) return r.data;
  const r2 = await supabase.from("conversations").insert({ business_id: tenant.business.id, phone: phone, status: "BOT", current_state: "IDLE", state_data: {} }).select().single();
  return r2.data;
}
async function setConvo(id: any, u: any) { await supabase.from("conversations").update({ ...u, updated_at: new Date().toISOString() }).eq("id", id); }
async function logE(tenant: TenantContext, evt: any, p?: any, bid?: any) { await supabase.from("logs").insert({ business_id: tenant.business.id, booking_id: bid, event: evt, payload: p }); }
function fmtTime(tenant: TenantContext, iso: any) { return formatDateTime(tenant, iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }

async function getSlotPrice(slot: any) {
  if (slot.price_per_person_override) return Number(slot.price_per_person_override);
  const t = await supabase.from("tours").select("base_price_per_person").eq("id", slot.tour_id).single();
  return Number(t.data?.base_price_per_person || 600);
}
async function getAvailSlotsForTour(tenant: TenantContext, tourId: any, days: number = 14) {
  const later = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  // M5: Add 60-min cutoff — don't show slots starting within the next hour
  const cutoff = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const r = await supabase.rpc("list_available_slots", {
    p_business_id: tenant.business.id,
    p_range_start: cutoff,
    p_range_end: later,
    p_tour_id: tourId,
  });
  return (r.data || [])
    .filter(function (s: any) { return Number(s.available_capacity || 0) > 0; })
    .map(function (s: any) { return { ...s, booked: Math.max(0, Number(s.capacity_total || 0) - Number(s.available_capacity || 0)), held: 0, tours: { name: s.tour_name } }; });
}
async function getAvailSlots(tenant: TenantContext, days: number = 14) {
  const later = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  // M5: Add 60-min cutoff — don't show slots starting within the next hour
  const cutoff = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const r = await supabase.rpc("list_available_slots", {
    p_business_id: tenant.business.id,
    p_range_start: cutoff,
    p_range_end: later,
    p_tour_id: null,
  });
  return (r.data || [])
    .filter(function (s: any) { return Number(s.available_capacity || 0) > 0; })
    .map(function (s: any) { return { ...s, booked: Math.max(0, Number(s.capacity_total || 0) - Number(s.available_capacity || 0)), held: 0, tours: { name: s.tour_name } }; });
}
async function getActiveTours(tenant: TenantContext) {
  const r = await supabase.from("tours").select("id, name, description, base_price_per_person, duration_minutes, hidden")
    .eq("business_id", tenant.business.id).eq("active", true).order("sort_order", { ascending: true });
  return (r.data || []).filter(function (t: any) { return !t.name.includes("Private") && !t.hidden; });
}
async function getBookingCustomFields(tenant: TenantContext) {
  const r = await supabase.from("businesses").select("booking_custom_fields").eq("id", tenant.business.id).maybeSingle();
  return Array.isArray(r.data?.booking_custom_fields) ? r.data.booking_custom_fields.filter(function (f: any) { return f && f.key && f.label; }) : [];
}
function nextCustomField(defs: any[], values: Record<string, unknown>) {
  for (let i = 0; i < (defs || []).length; i++) {
    const field = defs[i];
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
  try { const r = await supabase.rpc("check_loyalty", { p_phone: phone, p_business_id: tenant.business.id }); return r.data || 0; } catch (e) { return 0; }
}
async function calcDiscount(tenant: TenantContext, qty: any, phone: any) {
  const pol = await supabase.from("policies").select().eq("business_id", tenant.business.id).single();
  const p = pol.data; const discount = { type: "", percent: 0 };
  const lc = await getLoyaltyCount(tenant, phone);
  if (p && lc >= (p.loyalty_bookings_threshold || 2)) discount = { type: "LOYALTY", percent: p.loyalty_discount_percent || 10 };
  if (p && qty >= (p.group_discount_min_qty || 6)) { const gp = p.group_discount_percent || 5; if (gp > discount.percent) discount = { type: "GROUP", percent: gp }; }
  return discount;
}
function genVoucherCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}
async function insertVoucherWithRetry(payload: any, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) payload.code = genVoucherCode();
    const { data, error } = await supabase.from("vouchers").insert(payload).select().single();
    if (!error) return { data, error: null };
    if (error.code === "23505" && attempt < maxRetries - 1) continue;
    return { data: null, error };
  }
  return { data: null, error: { message: "Failed to generate unique voucher code after " + maxRetries + " attempts" } };
}
async function hasActiveBookings(tenant: TenantContext, phone: any) {
  const r = await supabase.from("bookings").select("id").eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED"]).limit(1);
  return (r.data || []).length > 0;
}

// ===== REFERRAL SYSTEM =====
function genReferralCode(name: any) {
  const clean = ((name || "REF") + "").split(" ")[0].toUpperCase().substring(0, 4);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return clean + rand;
}
async function getOrCreateReferral(tenant: TenantContext, phone: any, name: any) {
  const existing = await supabase.from("referrals").select().eq("referrer_phone", phone).eq("business_id", tenant.business.id).eq("status", "ACTIVE").single();
  if (existing.data) return existing.data;
  const code = genReferralCode(name);
  const r = await supabase.from("referrals").insert({ business_id: tenant.business.id, referrer_phone: phone, referrer_name: name, referral_code: code, discount_percent: 5 }).select().single();
  return r.data;
}
async function validateReferralCode(tenant: TenantContext, code: any, phone: any) {
  const r = await supabase.from("referrals").select().eq("referral_code", code.toUpperCase()).eq("business_id", tenant.business.id).eq("status", "ACTIVE").single();
  if (!r.data) return null;
  if (r.data.referrer_phone === phone) return null;
  if (r.data.uses >= r.data.max_uses) return null;
  return r.data;
}

// ===== REPEAT BOOKING =====
async function getLastCompletedBooking(tenant: TenantContext, phone: any) {
  const r = await supabase.from("bookings").select("*, tours(id, name, base_price_per_person)").eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["COMPLETED", "PAID"]).order("created_at", { ascending: false }).limit(1).single();
  return r.data;
}

// REVIEW_URL removed — use tenant.business.social_google_reviews (Prompt 23)

// ===== SMART AVAILABILITY =====
function parseTimeRef(tenant: TenantContext, input: string): { start: Date, end: Date, label: string } | null {
  const i = input.toLowerCase();
  const now = new Date();
  const tzNow = new Date(now.toLocaleString("en-US", { timeZone: tenantTimeZone(tenant) }));
  const today = new Date(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate());
  let targetDate: Date | null = null;
  let label = "";
  if (i.includes("tomorrow") || i.includes("tmrw")) { targetDate = new Date(today); targetDate.setDate(targetDate.getDate() + 1); label = "tomorrow"; }
  else if (i.includes("today") || i.includes("this afternoon") || i.includes("this morning")) { targetDate = new Date(today); label = "today"; }
  else {
    const days: string[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    for (let d = 0; d < days.length; d++) {
      if (i.includes(days[d]) || i.includes(days[d].substring(0, 3))) {
        const currentDay = today.getDay(); const diff = d - currentDay; if (diff <= 0) diff += 7;
        targetDate = new Date(today); targetDate.setDate(targetDate.getDate() + diff);
        label = days[d].charAt(0).toUpperCase() + days[d].slice(1); break;
      }
    }
  }
  if (i.includes("weekend")) {
    const sat = new Date(today); const daysToSat = 6 - sat.getDay(); if (daysToSat <= 0) daysToSat += 7;
    sat.setDate(sat.getDate() + daysToSat);
    const mon = new Date(sat); mon.setDate(mon.getDate() + 2);
    return { start: sat, end: mon, label: "this weekend" };
  }
  if (i.includes("next week")) {
    const nextMon = new Date(today); const toMon = (8 - nextMon.getDay()) % 7 || 7;
    nextMon.setDate(nextMon.getDate() + toMon);
    const nextSun = new Date(nextMon); nextSun.setDate(nextSun.getDate() + 7);
    return { start: nextMon, end: nextSun, label: "next week" };
  }
  if (!targetDate) {
    const dm = i.match(/(\d{1,2})\s*(st|nd|rd|th)/);
    if (dm) {
      targetDate = new Date(today); targetDate.setDate(parseInt(dm[1]));
      if (targetDate < today) targetDate.setMonth(targetDate.getMonth() + 1);
      label = targetDate.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: tenantTimeZone(tenant) });
    }
  }
  if (!targetDate) return null;
  const start = new Date(targetDate); const end = new Date(targetDate); end.setDate(end.getDate() + 1);
  if (i.includes("morning") || i.includes("early")) { start.setHours(5, 0, 0, 0); end = new Date(targetDate); end.setHours(12, 0, 0, 0); label += " morning"; }
  else if (i.includes("afternoon")) { start.setHours(12, 0, 0, 0); end = new Date(targetDate); end.setHours(17, 0, 0, 0); label += " afternoon"; }
  else if (i.includes("evening") || i.includes("sunset")) { start.setHours(16, 0, 0, 0); end = new Date(targetDate); end.setHours(21, 0, 0, 0); label += " evening"; }
  const tm = i.match(/(\d{1,2})\s*(am|pm)/);
  if (tm) {
    const hr = parseInt(tm[1]); if (tm[2] === "pm" && hr < 12) hr += 12; if (tm[2] === "am" && hr === 12) hr = 0;
    start.setHours(hr, 0, 0, 0); end = new Date(targetDate); end.setHours(hr + 2, 0, 0, 0);
  }
  return { start: start, end: end, label: label };
}
async function checkWeatherConcern(tenant: TenantContext, phone: string, input: string): Promise<boolean> {
  const i = input.toLowerCase();
  const isWeatherQ = (i.includes("trip") || i.includes("tour") || i.includes("paddle")) && (i.includes("still on") || i.includes("go ahead") || i.includes("happening") || i.includes("confirmed"));
  const isWeatherCheck = i.includes("weather") && (i.includes("tomorrow") || i.includes("today") || i.includes("look"));
  if (!isWeatherQ && !isWeatherCheck) return false;

  // Check if they have a booking
  const wBkr = await supabase.from("bookings").select("id, slots(start_time), tours(name)")
    .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
    .order("created_at", { ascending: false }).limit(1).single();
  let bkInfo = "";
  let bkTime = "";
  if (wBkr.data) {
    const wSlot = (wBkr.data as any).slots;
    const wTour = (wBkr.data as any).tours;
    if (wSlot) {
      bkInfo = "Your *" + (wTour?.name || "tour") + "* is on " + fmtTime(tenant, wSlot.start_time) + ".\n\n";
      bkTime = wSlot.start_time;
    }
  }

  const defaultWeatherSpot = { lat: -33.908, lon: 18.398 };
  const configuredWeatherSpot = Array.isArray(tenant.business.weather_widget_locations) && tenant.business.weather_widget_locations.length > 0
    ? tenant.business.weather_widget_locations[0]
    : defaultWeatherSpot;
  const weatherLat = Number(configuredWeatherSpot?.lat ?? defaultWeatherSpot.lat);
  const weatherLon = Number(configuredWeatherSpot?.lon ?? defaultWeatherSpot.lon);

  // Fetch live weather from Open-Meteo for the tenant's configured weather spot.
  let weatherMsg = "";
  try {
    // L12: Calculate the day index based on the booking's slot start_time relative to today
    let weatherDayIndex = 1; // default to tomorrow
    if (bkTime) {
      const bkDate = new Date(bkTime);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      weatherDayIndex = Math.max(0, Math.floor((bkDate.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000)));
    }
    const forecastDays = Math.max(weatherDayIndex + 1, 2);
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + weatherDayIndex);
    const dateStr = targetDate.toISOString().split("T")[0];
    const wUrl = "https://api.open-meteo.com/v1/forecast?latitude=" + weatherLat + "&longitude=" + weatherLon + "&daily=wind_speed_10m_max,wind_direction_10m_dominant,weather_code&hourly=wind_speed_10m,wind_direction_10m,visibility,temperature_2m&timezone=" + encodeURIComponent(tenantTimeZone(tenant)) + "&forecast_days=" + forecastDays;
    const mUrl = "https://marine-api.open-meteo.com/v1/marine?latitude=" + weatherLat + "&longitude=" + weatherLon + "&daily=wave_height_max,wave_period_max&timezone=" + encodeURIComponent(tenantTimeZone(tenant)) + "&forecast_days=" + forecastDays;
    const [wRes, mRes] = await Promise.all([fetch(wUrl), fetch(mUrl)]);
    const wData = await wRes.json();
    const mData = await mRes.json();

    // L12: Use the correct day index for the booking day
    const maxWind = wData?.daily?.wind_speed_10m_max?.[weatherDayIndex] || 0;
    const windDir = wData?.daily?.wind_direction_10m_dominant?.[weatherDayIndex] || 0;
    const swell = mData?.daily?.wave_height_max?.[weatherDayIndex] || 0;
    const weatherCode = wData?.daily?.weather_code?.[weatherDayIndex] || 0;

    // Check visibility at tour hours (7-9am = indices 7-9) on the booking day
    const minVis = 99999;
    const hourlyVis = wData?.hourly?.visibility || [];
    const hourlyTimes = wData?.hourly?.time || [];
    for (let hi = 0; hi < hourlyTimes.length; hi++) {
      if (hourlyTimes[hi].startsWith(dateStr) && hi % 24 >= 6 && hi % 24 <= 10) {
        if (hourlyVis[hi] < minVis) minVis = hourlyVis[hi];
      }
    }
    const foggy = minVis < 1000; // less than 1km visibility

    // Wind direction name
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const dirName = dirs[Math.round(windDir / 22.5) % 16];
    const isSE = dirName.includes("SE");
    const windLimit = isSE ? 25 : 20;
    const windBad = maxWind > windLimit;
    const swellBad = swell > 2.6;

    const concerns: string[] = [];
    if (swellBad) concerns.push("swell is " + swell.toFixed(1) + "m (above 2.6m)");
    if (windBad) concerns.push("wind gusts up to " + Math.round(maxWind) + "km/h " + dirName + (isSE ? " (limit 25km/h for SE)" : " (limit 20km/h)"));
    if (foggy) concerns.push("low visibility/fog expected");

    const weatherDayLabel = weatherDayIndex === 0 ? "today" : weatherDayIndex === 1 ? "tomorrow" : "your trip day";
    if (concerns.length > 0) {
      weatherMsg = "Looking at " + weatherDayLabel + "\u2019s forecast, conditions may be challenging \u26A0\uFE0F\n\n" + concerns.map(function (c) { return "\u2022 " + c; }).join("\n") + "\n\nWe\u2019ll let you know for sure on the morning of the trip, about an hour before. Please keep your phone nearby \u{1F4F1}\n\nIf we cancel, you get a *full refund or free reschedule*.";
    } else {
      weatherMsg = weatherDayLabel.charAt(0).toUpperCase() + weatherDayLabel.slice(1) + "\u2019s looking good! \u2600\uFE0F\n\n\u{1F30A} Swell: " + swell.toFixed(1) + "m\n\u{1F4A8} Wind: " + Math.round(maxWind) + "km/h " + dirName + "\n\nConditions look favourable for your trip. We\u2019ll still confirm on the morning of your trip about an hour before. Keep your phone nearby \u{1F4F1}";
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
  const i = input.toLowerCase();
  const hasTime = i.includes("tomorrow") || i.includes("today") || i.includes("weekend") || i.includes("next week") || i.includes("morning") || i.includes("afternoon") || i.includes("evening") || ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].some(function (d) { return i.includes(d); }) || /\d{1,2}(st|nd|rd|th)/.test(i) || /\d{1,2}\s*(am|pm)/.test(i);
  const hasIntent = i.includes("available") || i.includes("space") || i.includes("slot") || i.includes("open") || i.includes("spot") || i.includes("can i") || i.includes("do you have") || i.includes("any tour") || i.includes("what time") || i.includes("book for") || i.includes("free") || i.includes("which") || i.includes("what");
  return hasTime && hasIntent;
}
async function handleSmartAvail(tenant: TenantContext, phone: string, input: string): Promise<boolean> {
  const timeRef = parseTimeRef(tenant, input);
  if (!timeRef) return false;

  // No hard slot limits; pull all within the boundaries user asked for
  const r = await supabase.from("slots").select("id, start_time, capacity_total, booked, held, tour_id, tours(name, base_price_per_person)")
    .eq("business_id", tenant.business.id).eq("status", "OPEN")
    .gte("start_time", timeRef.start.toISOString())
    .lt("start_time", timeRef.end.toISOString())
    .order("start_time", { ascending: true });
  const slots = (r.data || []).filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) > 0; });
  if (slots.length === 0) {
    await sendText(tenant, phone, "I checked and unfortunately there aren't any slots generated or available for " + timeRef.label + ". \u{1F614}\n\nWe usually publish slots a month or two in advance. Let me know if you want to look at another date!");
    await sendButtons(tenant, phone, "Options:", [{ id: "AVAIL", title: "\u{1F4C5} Look at other dates" }, { id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "IDLE", title: "\u2B05 Menu" }]);
    return true;
  }

  // Slice to a readable amount for WhatsApp UX, but tell them to hit book if they want more
  const displaySlots = slots.slice(0, 8);
  let msg = "Here\u2019s what\u2019s available for *" + timeRef.label + "*:\n\n";
  for (let si = 0; si < displaySlots.length; si++) {
    const s = displaySlots[si]; const tour = (s as any).tours;
    const avail = s.capacity_total - s.booked - (s.held || 0);
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
  const i = input.toLowerCase();
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
  const i = input.toLowerCase();

  // Fast path for exact keywords to save API calls
  if (i === "book" || i === "reserve") return "BOOK";
  if (i === "menu" || i === "start" || i === "restart") return "MENU";
  if (i === "reschedule") return "RESCHEDULE";
  if (i === "cancel") return "CANCEL";

  // Use Gemini for natural language intent classification
  if (!GK) return null; // Fallback if no API key

  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, {
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
    const d = await r.json();
    if (d.candidates?.[0]?.content?.parts?.[0]) {
      const intent = d.candidates[0].content.parts[0].text.trim().toUpperCase();
      if (["BOOK", "AVAIL", "MY_BOOKINGS", "VOUCHER", "HUMAN", "THANKS"].includes(intent)) {
        return intent;
      }
    }
  } catch (e) { console.error("Intent classification failed", e); }

  return null;
}


async function handleMsg(tenant: TenantContext, phone: any, text: any, msgType: any, interactive?: any) {
  try {
    const convo = await getConvo(tenant, phone);
    if (!convo) return;
    // Log incoming message before HUMAN check
    const _rt = (text || "").trim();
    const _ri = (msgType === "interactive" && interactive) ? ((interactive.button_reply && interactive.button_reply.id) || (interactive.list_reply && interactive.list_reply.id) || "") : "";
    try {
      const cmRes = await supabase.from("chat_messages").insert({ business_id: convo.business_id || tenant.business.id, phone: phone, direction: "IN", body: _rt || _ri || "[non-text]", sender: convo.customer_name || phone });
      if (cmRes.error) await logE(tenant, "CHAT_ERROR_RES", cmRes.error);
    } catch (e: any) {
      await logE(tenant, "CHAT_ERROR_CATCH", { msg: e.message });
    }

    // ── Drain any queued cancellation follow-ups ────────────────────────────
    // When weather-cancel (or any cancel flow using sendWhatsappWithWindowReopen)
    // couldn't send a free-form message because the 24h window was closed, it
    // queued the full message in outbox with status='WAITING_WINDOW' and sent a
    // reopener template. The customer just replied → window is now open → send
    // the queued messages right away using this tenant's own WA credentials.
    try {
      const { data: queuedMsgs } = await supabase
        .from("outbox")
        .select("id, message_body")
        .eq("status", "WAITING_WINDOW")
        .eq("business_id", tenant.business.id)
        .eq("phone", phone);
      for (const qm of (queuedMsgs || [])) {
        try {
          const drainRes = await sendWhatsappFreeformOrSignal(tenant, phone, (qm as any).message_body);
          if (drainRes.ok) {
            await supabase.from("outbox").update({
              status: "SENT",
              sent_at: new Date().toISOString(),
              attempts: 1,
            }).eq("id", (qm as any).id);
          } else {
            // Window somehow still closed (shouldn't happen after a real inbound) — retry later.
            await supabase.from("outbox").update({ attempts: 1 }).eq("id", (qm as any).id);
          }
        } catch (drainErr: any) {
          console.error("CANCEL_FOLLOWUP_SEND_ERR", drainErr?.message || drainErr);
        }
      }
    } catch (drainQueryErr: any) {
      console.error("CANCEL_FOLLOWUP_DRAIN_QUERY_ERR", drainQueryErr?.message || drainQueryErr);
    }
    // ─────────────────────────────────────────────────────────────────────────
    const input = (text || "").trim().toLowerCase();
    const rawText = (text || "").trim();
    let rid = "";
    if (msgType === "interactive" && interactive) {
      rid = (interactive.button_reply && interactive.button_reply.id) || (interactive.list_reply && interactive.list_reply.id) || "";
    }

    // Marketing opt-out stop words — always processed regardless of conversation state
    const STOP_WORDS = ["stop", "unsubscribe", "opt out"];
    if (STOP_WORDS.includes(input)) {
      // Set marketing_opt_in = false on all bookings for this phone number
      await supabase.from("bookings")
        .update({ marketing_opt_in: false })
        .eq("business_id", tenant.business.id)
        .eq("phone", phone);
      await sendText(tenant, phone,
        "You've been unsubscribed from marketing messages. You'll still receive booking confirmations."
      );
      return;
    }

    // Allow "menu"/"start"/"restart" to escape HUMAN mode so the user can always get the bot back
    const isResetKeyword = (input === "menu" || input === "start" || input === "restart" || input === "back" || input === "home" || input === "main menu" || input === "start over");
    if (convo.status === "HUMAN") {
      if (isResetKeyword) {
        await setConvo(convo.id, { status: "BOT", current_state: "IDLE", state_data: {} });
      } else {
        return; // Still in human-handled mode, bot stays silent
      }
    }

    let state = convo.current_state || "IDLE";
    let sd = convo.state_data || {};
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
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const cb = await supabase.from("bookings").select("id, status, cancellation_reason, slot_id, qty, total_amount, tour_id, refund_status")
        .eq("business_id", tenant.business.id)
        .eq("phone", phone)
        .eq("status", "CANCELLED")
        .gt("cancelled_at", yesterday)
        .order("cancelled_at", { ascending: false }).limit(1).single();

      if (cb.data && cb.data.cancellation_reason && cb.data.cancellation_reason.includes("Weather")) {
        const choiceDesc = "";
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
    const isPaymentIssue = false;
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

    // ===== PHOTO LINK REQUEST =====
    // When we send a photo-ready notification via template, we ask customers to reply "YES".
    // This handler detects that reply and sends them the actual photo URLs.
    // L7: Only trigger photo sending if last conversation involved photo-related keywords
    const _lastMsgs = await supabase.from("chat_messages").select("body").eq("business_id", tenant.business.id).eq("phone", phone).order("created_at", { ascending: false }).limit(5);
    const _recentPhotoContext = (_lastMsgs.data || []).some(function (m: any) { const mb = (m.body || "").toLowerCase(); return mb.includes("photo") || mb.includes("picture") || mb.includes("pics") || mb.includes("trip photos"); });
    if ((input === "yes" || input === "yes!" || input === "yeah" || input === "yep") && (state === "IDLE" || state === "MENU") && _recentPhotoContext) {
      // Check if this customer has a recent booking with trip photos
      const recentBk = await supabase.from("bookings")
        .select("id, slot_id")
        .eq("business_id", tenant.business.id)
        .eq("phone", phone)
        .in("status", ["PAID", "CONFIRMED", "COMPLETED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentBk.data?.slot_id) {
        const photos = await supabase.from("trip_photos")
          .select("photo_url")
          .eq("slot_id", recentBk.data.slot_id)
          .eq("business_id", tenant.business.id)
          .order("uploaded_at", { ascending: false });
        if (photos.data && photos.data.length > 0) {
          const photoUrls = photos.data.map(function (p: any) { return p.photo_url; });
          await typingDelay();
          await sendText(tenant, phone, "Here are your trip photos! 📸\n\n" + photoUrls.join("\n") + "\n\nShare this link with your group and enjoy the memories! 🛶");
          return;
        }
      }
      // No photos found — fall through to normal processing
    }

    // ===== NATURAL LANGUAGE FROM ANY STATE =====
    if (state === "IDLE" || state === "MENU") {
      // Check smart availability first
      if (!rid && detectAvailQuery(input)) {
        const handled = await handleSmartAvail(tenant, phone, input);
        if (handled) { await setConvo(convo.id, { current_state: "MENU" }); return; }
      }

      // Check FAQ
      const faqKey = matchFAQ(input);
      if (faqKey && !rid) {
        const faqAnswer = getFaqAnswer(tenant, faqKey);
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
      const intent = rid ? null : await detectIntent(tenant, input, phone);
      if (intent === "THANKS" && !rid) {
        await sendText(tenant, phone, "You\u2019re welcome! \u{1F60A} Feel free to ask anything else or type *menu* to see your options.");
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }
      if (intent && !rid) { rid = intent; }
    }

    // ===== IDLE =====
    if (state === "IDLE") {
      const lc = await getLoyaltyCount(tenant, phone);
      const hasBookings = await hasActiveBookings(tenant, phone);
      let welcome = "";

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
      const c = rid || input;

      // BOOK
      if (c === "BOOK" || c.includes("book")) {
        const tours = await getActiveTours(tenant);
        if (tours.length === 0) { await sendText(tenant, phone, "No tours available at the moment \u2014 check back soon!"); await setConvo(convo.id, { current_state: "IDLE" }); return; }
        if (tours.length === 1) {
          await sendText(tenant, phone, "How many people will be joining? (1\u201330)");
          await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { tour_id: tours[0].id } });
        } else {
          const trows: any[] = [];
          for (let ti = 0; ti < tours.length; ti++) {
            const tr = tours[ti];
            trows.push({ id: "TOUR_" + tr.id, title: tr.name, description: "R" + tr.base_price_per_person + "/pp \u2022 " + tr.duration_minutes + " min" });
          }
          await sendText(tenant, phone, "Awesome, let\u2019s get you booked!\n\nWhich tour catches your eye?");
          await sendList(tenant, phone, "We have " + tours.length + " incredible options:", "Choose a Tour", [{ title: "Our Tours", rows: trows }]);
          await setConvo(convo.id, { current_state: "PICK_TOUR", state_data: {} });
        }
      }

      // AVAILABILITY
      else if (c === "AVAIL" || c.includes("avail")) {
        const tours2 = await getActiveTours(tenant);
        if (tours2.length <= 1) {
          const slots = await getAvailSlots(tenant, 8);
          if (slots.length === 0) { await sendText(tenant, phone, "Nothing open right now, but check back soon \u2014 we add new slots regularly!"); await setConvo(convo.id, { current_state: "IDLE" }); }
          else {
            let msg = "Here\u2019s what\u2019s coming up:\n\n";
            for (let ai = 0; ai < slots.length; ai++) {
              const as2 = slots[ai]; const aav = as2.capacity_total - as2.booked - (as2.held || 0); const apr = await getSlotPrice(as2);
              msg += "\u2022 " + fmtTime(tenant, as2.start_time) + " \u2014 " + aav + " spots \u2014 R" + apr + "/pp\n";
            }
            await sendButtons(tenant, phone, msg, [{ id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "IDLE", title: "\u2B05 Back" }]);
          }
        } else {
          let availMsg = "Here\u2019s what\u2019s available:\n\n";
          for (let ati = 0; ati < tours2.length; ati++) {
            const at2 = tours2[ati];
            const atSlots = await getAvailSlotsForTour(tenant, at2.id, 3);
            availMsg += "*" + at2.name + "* (R" + at2.base_price_per_person + "/pp)\n";
            if (atSlots.length === 0) { availMsg += "  Fully booked for now\n\n"; }
            else {
              for (let asi = 0; asi < atSlots.length; asi++) {
                const ats = atSlots[asi]; availMsg += "  \u2022 " + fmtTime(tenant, ats.start_time) + " \u2014 " + (ats.capacity_total - ats.booked - (ats.held || 0)) + " spots\n";
              }
              availMsg += "\n";
            }
          }
          await sendButtons(tenant, phone, availMsg, [{ id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "IDLE", title: "\u2B05 Back" }]);
        }
      }

      // MY BOOKINGS / RESCHEDULE / CANCEL
      else if (c === "MY_BOOKINGS" || c === "RESCHEDULE" || c === "CANCEL" || c.includes("my booking") || c.includes("manage") || c.includes("reschedule") || c.includes("cancel")) {
        const bkr = await supabase.from("bookings").select("id, status, qty, total_amount, slot_id, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED", "CANCELLED"])
          .order("created_at", { ascending: false }).limit(5);
        const bookings = bkr.data || [];
        if (bookings.length === 0) {
          await sendText(tenant, phone, "You don\u2019t have any active bookings at the moment.");
          await sendButtons(tenant, phone, "Want to book your next adventure?", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Main Menu" }]);
          await setConvo(convo.id, { current_state: "MENU" });
        } else {
          let bmsg = "Here are your bookings:\n\n"; const brows: any[] = [];
          for (let bi = 0; bi < bookings.length; bi++) {
            const b = bookings[bi]; const bslot = (b as any).slots; const btour = (b as any).tours;
            const bref = b.id.substring(0, 8).toUpperCase(); const btime = bslot ? fmtTime(tenant, bslot.start_time) : "TBC";
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
        const tours = await getActiveTours(tenant);
        const trows = [];
        for (let ti = 0; ti < tours.length; ti++) {
          const tr = tours[ti];
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

      // HUMAN
      // REFERRAL
      else if (c === "REFERRAL" || (c.includes("refer") && !c.includes("refund"))) {
        const cname = convo.customer_name || "Friend";
        const ref = await getOrCreateReferral(tenant, phone, cname);
        if (ref) {
          await sendText(tenant, phone, "\u{1F91D} *Share the adventure!*\n\nHere\u2019s your personal referral code:\n\n\u{1F3AF} Code: *" + ref.referral_code + "*\n\n\u2022 Your friend gets *5% off* their first booking\n\u2022 You get *5% off* your next booking\n\nJust tell them to mention your code when booking!\n\nShare this message:\n_Hey! Use my code *" + ref.referral_code + "* to get 5% off a booking with " + businessName(tenant) + "._");
          await sendButtons(tenant, phone, "Anything else?", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        } else {
          await sendText(tenant, phone, "Something went wrong generating your code. Type *speak to us* for help.");
        }
      }

      // REPEAT BOOKING
      else if (c === "BOOK_AGAIN") {
        const lastBk = await getLastCompletedBooking(tenant, phone);
        if (lastBk) {
          const lbTour = lastBk.tours;
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
        const gemReply = await gemFallback(tenant, input || rawText);
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
      const tourId = rid ? rid.replace("TOUR_", "") : "";
      if (!tourId) { await sendText(tenant, phone, "Please pick a tour from the list above."); return; }
      const tourInfo = await supabase.from("tours").select("*").eq("id", tourId).single();
      if (!tourInfo.data) { await sendText(tenant, phone, "Hmm, can\u2019t find that tour. Let\u2019s try again."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      const t = tourInfo.data;
      await sendText(tenant, phone, "*" + t.name + "* \u{1F6F6}\n\n" + t.description + "\n\n\u23F1 " + t.duration_minutes + " minutes\n\u{1F4B0} R" + t.base_price_per_person + " per person\n\nHow many people will be joining?");
      await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { tour_id: tourId } });
    }

    // ===== MY BOOKINGS LIST =====
    else if (state === "MY_BOOKINGS_LIST") {
      const bookingId = rid ? rid.replace("BK_", "") : "";
      if (!bookingId) { await sendText(tenant, phone, "Please select a booking from the list."); return; }
      const bkd = await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("id", bookingId).single();
      if (!bkd.data) { await sendText(tenant, phone, "Can\u2019t find that booking."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      const bk = bkd.data; const bkref = bk.id.substring(0, 8).toUpperCase();
      const bkslot = (bk as any).slots; const bktour = (bk as any).tours;
      const bkhrs = bkslot ? (new Date(bkslot.start_time).getTime() - Date.now()) / (1000 * 60 * 60) : 0;
      const bkUnitPrice = Number(bk.unit_price || (bk.qty > 0 ? bk.total_amount / bk.qty : 0));
      let detail = "*Booking " + bkref + "*\n\n\u{1F6F6} " + (bktour?.name || "Tour") + "\n\u{1F4C5} " + (bkslot ? fmtTime(tenant, bkslot.start_time) : "TBC") + "\n\u{1F465} " + bk.qty + " people\n\u{1F4B0} R" + bk.total_amount + "\n\u{1F4CC} " + bk.status;
      // Show special request if exists
      if (bk.custom_fields && bk.custom_fields.special_requests) detail += "\n\u{1F4DD} Request: " + bk.custom_fields.special_requests;
      detail += "\n\nWhat would you like to do?";
      let actRows: any[] = [];
      if (bk.status === "CANCELLED") {
        if (bk.cancellation_reason && bk.cancellation_reason.includes("Weather")) {
          if (bk.refund_status === "REQUESTED" || bk.refund_status === "PROCESSED") {
            detail += "\n\n\u2705 100% Refund has already been requested.";
            await sendButtons(tenant, phone, detail, [{ id: "IDLE", title: "\u2B05 Back" }]);
            await setConvo(convo.id, { current_state: "BOOKING_ACTIONS", state_data: { booking_id: bk.id, slot_id: bk.slot_id, qty: bk.qty, total: bk.total_amount, unit_price: bkUnitPrice, hours_before: bkhrs, tour_id: bk.tour_id, is_weather: true } });
            return;
          } else if (bk.converted_to_voucher_id) {
            detail += "\n\n\u2705 Already converted to a voucher.";
            await sendButtons(tenant, phone, detail, [{ id: "IDLE", title: "\u2B05 Back" }]);
            await setConvo(convo.id, { current_state: "BOOKING_ACTIONS", state_data: { booking_id: bk.id, slot_id: bk.slot_id, qty: bk.qty, total: bk.total_amount, unit_price: bkUnitPrice, hours_before: bkhrs, tour_id: bk.tour_id, is_weather: true } });
            return;
          } else {
            actRows = [
              { id: "ACT_RESCH_" + bk.id, title: "\u{1F504} Reschedule", description: "Move to a new date" },
              { id: "ACT_VOUCHER_" + bk.id, title: "\u{1F39F} Convert to Voucher", description: "Get a gift voucher" },
              { id: "ACT_WX_REFUND_" + bk.id, title: "\u{1F4B8} 100% Refund", description: "Full weather refund" },
            ];
          }
        } else {
          await sendButtons(tenant, phone, detail, [{ id: "IDLE", title: "\u2B05 Back" }]);
          await setConvo(convo.id, { current_state: "BOOKING_ACTIONS", state_data: { booking_id: bk.id, slot_id: bk.slot_id, qty: bk.qty, total: bk.total_amount, unit_price: bkUnitPrice, hours_before: bkhrs, tour_id: bk.tour_id, is_weather: false } });
          return;
        }
      } else if (["PAID", "CONFIRMED"].includes(bk.status)) {
        // >24h: full self-service
        if (bkhrs >= 24) {
          actRows = [
            { id: "ACT_RESCH_" + bk.id, title: "\u{1F504} Reschedule", description: "Move to another date" },
            { id: "ACT_GUESTS_" + bk.id, title: "\u{1F465} Edit Guests", description: "Add or remove people" },
            { id: "ACT_REQUEST_" + bk.id, title: "\u{1F4DD} Special Request", description: "Dietary, celebrations, etc" },
            { id: "ACT_CONTACT_" + bk.id, title: "\u{1F4F1} Contact Details", description: "Update name, email, phone" },
            { id: "ACT_CANCEL_" + bk.id, title: "\u274C Cancel Booking", description: "Get refund or voucher" },
          ];
        }
        // 12-24h: limited changes
        else if (bkhrs >= 12) {
          actRows = [
            { id: "ACT_GUESTS_" + bk.id, title: "\u{1F465} Add Guests", description: "Add more people" },
            { id: "ACT_REQUEST_" + bk.id, title: "\u{1F4DD} Special Request", description: "Dietary, celebrations, etc" },
            { id: "ACT_CONTACT_" + bk.id, title: "\u{1F4F1} Contact Details", description: "Update name, email, phone" },
            { id: "ACT_TEAM_" + bk.id, title: "\u{1F4AC} Contact Our Team", description: "Request other changes" },
          ];
        }
        // <12h: locked, team review
        else {
          actRows = [
            { id: "ACT_REQUEST_" + bk.id, title: "\u{1F4DD} Special Request", description: "Last-minute requests" },
            { id: "ACT_TEAM_" + bk.id, title: "\u{1F4AC} Contact Our Team", description: "Request changes" },
          ];
        }
      } else {
        // HELD / PENDING
        actRows = [
          { id: "ACT_CANCEL_" + bk.id, title: "\u274C Cancel Booking", description: "Cancel this booking" },
        ];
      }
      await sendList(tenant, phone, detail, "Manage Booking", [{ title: "Actions", rows: actRows }]);
      await setConvo(convo.id, { current_state: "BOOKING_ACTIONS", state_data: { booking_id: bk.id, slot_id: bk.slot_id, qty: bk.qty, total: bk.total_amount, unit_price: bkUnitPrice, hours_before: bkhrs, tour_id: bk.tour_id, is_weather: bk.cancellation_reason && bk.cancellation_reason.includes("Weather") } });
    }

    // ===== BOOKING ACTIONS =====
    else if (state === "BOOKING_ACTIONS") {
      const action = rid || "";

      // ── CANCEL ──
      if (action.startsWith("ACT_CANCEL_")) {
        if (sd.hours_before >= 24) {
          const rAmt = Math.round(Number(sd.total) * 0.95 * 100) / 100;
          await sendText(tenant, phone, "How would you like to cancel?\n\n*Option 1: Gift Voucher* \u{1F39F}\nR" + sd.total + " voucher \u2022 No fees \u2022 Valid 3 years\n\n*Option 2: Refund* \u{1F4B8}\nR" + rAmt + " (5% processing fee) \u2022 5-7 business days");
          await sendButtons(tenant, phone, "Choose an option:", [
            { id: "CANCEL_VOUCHER", title: "\u{1F39F} Voucher (best)" },
            { id: "CANCEL_REFUND", title: "\u{1F4B8} Refund" },
            { id: "IDLE", title: "\u274C Keep Booking" },
          ]);
          await setConvo(convo.id, { current_state: "CANCEL_CHOICE" });
        } else {
          await sendButtons(tenant, phone, "Are you sure? This booking is within 24 hours, so unfortunately *no refund* is available.", [{ id: "CONFIRM_CANCEL_NOREFUND", title: "\u2705 Yes, Cancel" }, { id: "IDLE", title: "\u274C Keep It" }]);
          await setConvo(convo.id, { current_state: "CONFIRM_CANCEL_ACTION" });
        }
      }

      // ── RESCHEDULE ──
      else if (action.startsWith("ACT_RESCH_")) {
        if (!sd.is_weather && sd.hours_before < 24) { await sendText(tenant, phone, "Sorry, rescheduling is only available more than 24 hours before your tour."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
        const cbk2 = await supabase.from("bookings").select("reschedule_count").eq("id", sd.booking_id).single();
        if (cbk2.data && cbk2.data.reschedule_count >= 2) { await sendText(tenant, phone, "You\u2019ve already rescheduled twice. Let me connect you to our team for help."); await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" }); return; }
        await typingDelay();
        await sendText(tenant, phone, "No problem! \ud83d\udcc5 Simply type the new date you want to reschedule to (e.g., 'Tomorrow' or '1 September')");
        await setConvo(convo.id, { current_state: "PICK_DATE", state_data: { ...sd, is_reschedule: true, reschedule_count: cbk2.data?.reschedule_count || 0 } });
      }

      // ── EDIT GUESTS ──
      else if (action.startsWith("ACT_GUESTS_")) {
        const canRemove = sd.hours_before >= 24;
        if (canRemove) {
          await sendText(tenant, phone, "You currently have *" + sd.qty + " people* on this booking (R" + sd.unit_price + "/pp).\n\nType the *new total number* of guests:");
        } else {
          await sendText(tenant, phone, "You currently have *" + sd.qty + " people* on this booking (R" + sd.unit_price + "/pp).\n\nYou can add more guests. Type the *new total number* of guests (must be " + (sd.qty + 1) + " or more):");
        }
        await setConvo(convo.id, { current_state: "EDIT_GUESTS_QTY", state_data: { ...sd, can_remove: canRemove } });
      }

      // ── SPECIAL REQUEST ──
      else if (action.startsWith("ACT_REQUEST_")) {
        await sendText(tenant, phone, "Tell us about any special requirements \u{1F4DD}\n\nExamples:\n\u2022 Birthday celebration\n\u2022 Dietary needs\n\u2022 Wheelchair access\n\u2022 Photography requests\n\nJust type your request:");
        await setConvo(convo.id, { current_state: "SPECIAL_REQUEST_INPUT" });
      }

      // ── CONTACT DETAILS ──
      else if (action.startsWith("ACT_CONTACT_")) {
        await sendButtons(tenant, phone, "What would you like to update?", [
          { id: "CONTACT_NAME", title: "\u{1F464} Name" },
          { id: "CONTACT_EMAIL", title: "\u{1F4E7} Email" },
          { id: "CONTACT_PHONE", title: "\u{1F4F1} Phone" },
        ]);
        await setConvo(convo.id, { current_state: "UPDATE_CONTACT_FIELD" });
      }

      // ── WEATHER REFUND ──
      else if (action.startsWith("ACT_WX_REFUND_")) {
        await sendButtons(tenant, phone, "Are you sure you want to request a 100% full refund for this weather cancellation?", [{ id: "CONFIRM_WX_REFUND", title: "\u2705 Yes, Refund" }, { id: "IDLE", title: "\u274C Go Back" }]);
        await setConvo(convo.id, { current_state: "CONFIRM_WX_REFUND_ACTION", state_data: sd });
      }

      // ── WEATHER VOUCHER ──
      else if (action.startsWith("ACT_VOUCHER_")) {
        if (!sd.is_weather && sd.hours_before < 24) { await sendText(tenant, phone, "Voucher conversion is only available more than 24 hours before the tour."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
        await sendButtons(tenant, phone, "Convert this booking to a *gift voucher*?\n\nYou\u2019ll get a voucher code for *R" + sd.total + "* on any tour. Valid for 3 years.\n\nYour current seats will be released.", [{ id: "CONFIRM_VOUCHER", title: "\u2705 Yes, Convert" }, { id: "IDLE", title: "\u274C Keep Booking" }]);
        await setConvo(convo.id, { current_state: "CONFIRM_VOUCHER_CONVERT" });
      }

      // ── CONTACT TEAM ──
      else if (action.startsWith("ACT_TEAM_")) {
        const teamHrs = Math.round(sd.hours_before);
        await supabase.from("chat_messages").insert({
          business_id: tenant.business.id, phone: phone, direction: "IN",
          body: "[REQUEST] Customer wants to modify booking " + sd.booking_id.substring(0, 8).toUpperCase() + " (Trip in " + teamHrs + "h). " + convo.customer_name,
          sender: convo.customer_name || phone,
        });
        await sendText(tenant, phone, "I\u2019ve notified our team about your request. They\u2019ll get back to you shortly! \u{1F64F}\n\nType *menu* anytime to start over.");
        await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
      }

      else { await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); await handleMsg(tenant, phone, "hi", "text"); }
    }

    // ===== CANCEL CHOICE (refund or voucher) =====
    else if (state === "CANCEL_CHOICE") {
      if (rid === "CANCEL_VOUCHER" || input === "voucher") {
        const cvcode = genVoucherCode();
        const cvTotal = Number(sd.total);
        const cvr = await insertVoucherWithRetry({ business_id: tenant.business.id, code: cvcode, status: "ACTIVE", type: "CREDIT", value: cvTotal, current_balance: cvTotal, source_booking_id: sd.booking_id, expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString() });
        if (cvr.error) { await sendText(tenant, phone, "Something went wrong. Let me connect you to our team."); await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" }); return; }
        await supabase.from("bookings").update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: "Converted to voucher " + cvcode, converted_to_voucher_id: cvr.data.id }).eq("id", sd.booking_id);
        if (sd.slot_id) { const svr2 = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single(); if (svr2.data) await supabase.from("slots").update({ booked: Math.max(0, svr2.data.booked - sd.qty) }).eq("id", sd.slot_id); }
        await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", sd.booking_id).eq("status", "ACTIVE");
        await logE(tenant, "booking_cancelled_voucher", { booking_id: sd.booking_id, code: cvcode, amount: cvTotal }, sd.booking_id);
        // Email voucher
        try {
          const cvEmail = await supabase.from("bookings").select("email, customer_name").eq("id", sd.booking_id).single();
          if (cvEmail.data?.email) {
            await fetch(SUPABASE_URL + "/functions/v1/send-email", {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
              body: JSON.stringify({ type: "CANCELLATION", data: { business_id: tenant.business.id, email: cvEmail.data.email, customer_name: cvEmail.data.customer_name, ref: sd.booking_id.substring(0, 8).toUpperCase(), tour_name: "Tour", reason: "Converted to voucher via WhatsApp", voucher_code: cvcode, voucher_amount: cvTotal.toFixed(2), total_amount: cvTotal.toFixed(2), is_partial: false } }),
            });
          }
        } catch (e) { console.log("cancel voucher email err"); }
        await sendText(tenant, phone, "Done! Your booking has been cancelled and converted to a voucher:\n\n\u{1F39F} Code: *" + cvcode + "*\n\u{1F4B0} Value: *R" + cvTotal + "*\n\u{1F4C5} Valid for: *3 years*\n\nUse it anytime \u2014 type *menu* and select *Redeem Voucher* when you\u2019re ready!");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      }
      else if (rid === "CANCEL_REFUND" || input === "refund") {
        const crTotal = Number(sd.total);
        // C4: Check if booking was paid by voucher — issue a new voucher instead of requesting Yoco refund
        const crBkCheck = await supabase.from("bookings").select("yoco_payment_id, payment_method, voucher_deduction").eq("id", sd.booking_id).single();
        const crIsVoucherPaid = crBkCheck.data && (
          (crBkCheck.data.yoco_payment_id && String(crBkCheck.data.yoco_payment_id).startsWith("VOUCHER_")) ||
          crBkCheck.data.payment_method === "VOUCHER" ||
          crBkCheck.data.payment_method === "GIFT_VOUCHER"
        );
        if (crIsVoucherPaid) {
          // Voucher-paid booking: create a new voucher for the full amount instead of Yoco refund
          const crVCode = genVoucherCode();
          const crVResult = await insertVoucherWithRetry({ business_id: tenant.business.id, code: crVCode, status: "ACTIVE", type: "CREDIT", value: crTotal, current_balance: crTotal, source_booking_id: sd.booking_id, expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString() });
          if (crVResult.error) { await sendText(tenant, phone, "Something went wrong. Let me connect you to our team."); await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" }); return; }
          await supabase.from("bookings").update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: "Customer cancelled — voucher refund (originally voucher-paid)", converted_to_voucher_id: crVResult.data.id }).eq("id", sd.booking_id);
          if (sd.slot_id) { const slrV = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single(); if (slrV.data) await supabase.from("slots").update({ booked: Math.max(0, slrV.data.booked - sd.qty) }).eq("id", sd.slot_id); }
          await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", sd.booking_id).eq("status", "ACTIVE");
          await logE(tenant, "booking_cancelled_voucher_refund", { booking_id: sd.booking_id, code: crVCode, amount: crTotal }, sd.booking_id);
          await sendText(tenant, phone, "Done! Your booking has been cancelled.\n\nSince you paid with a voucher, we\u2019ve issued a new voucher:\n\n\u{1F39F} Code: *" + crVCode + "*\n\u{1F4B0} Value: *R" + crTotal + "*\n\u{1F4C5} Valid for: *3 years*\n\nUse it anytime \u2014 type *menu* and select *Redeem Voucher* when you\u2019re ready!");
          await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        } else {
          // M7: Split-tender refund math — check if booking has voucher_deduction > 0
          const crVoucherDeduction = Number(crBkCheck.data?.voucher_deduction || 0);
          let crRefund: number;
          let crRefundMsg: string;
          if (crVoucherDeduction > 0) {
            // Restore full voucher amount
            const crSplitVCode = genVoucherCode();
            const crSplitVResult = await insertVoucherWithRetry({ business_id: tenant.business.id, code: crSplitVCode, status: "ACTIVE", type: "CREDIT", value: crVoucherDeduction, current_balance: crVoucherDeduction, source_booking_id: sd.booking_id, expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString() });
            // Calculate 5% fee on total, subtract from cash portion only
            const crCashPaid = crTotal; // total_amount is the cash portion after voucher deduction
            crRefund = Math.round(crCashPaid * 0.95 * 100) / 100;
            crRefundMsg = "Done! Your booking has been cancelled.\n\nA refund of *R" + crRefund + "* has been submitted \u2014 expect it within 5\u20137 business days.";
            if (crSplitVResult.data) {
              crRefundMsg += "\n\n\u{1F39F} Your voucher credit of *R" + crVoucherDeduction + "* has been restored: *" + crSplitVCode + "*";
            }
          } else {
            crRefund = Math.round(crTotal * 0.95 * 100) / 100;
            crRefundMsg = "Done! Your booking has been cancelled.\n\nA refund of *R" + crRefund + "* has been submitted \u2014 expect it within 5\u20137 business days.";
          }
          await supabase.from("bookings").update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: "Customer cancelled — refund", refund_status: "REQUESTED", refund_amount: crRefund, refund_notes: "95% refund via WhatsApp" }).eq("id", sd.booking_id);
          // TODO: Replace with atomic increment RPC for slot decrement
          if (sd.slot_id) { const slr2 = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single(); if (slr2.data) await supabase.from("slots").update({ booked: Math.max(0, slr2.data.booked - sd.qty) }).eq("id", sd.slot_id); }
          await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", sd.booking_id).eq("status", "ACTIVE");
          await logE(tenant, "booking_cancelled_refund", { booking_id: sd.booking_id, amount: crRefund }, sd.booking_id);
          // Email cancellation
          try {
            const crEmail = await supabase.from("bookings").select("email, customer_name, tours(name), slots(start_time)").eq("id", sd.booking_id).single();
            if (crEmail.data?.email) {
              await fetch(SUPABASE_URL + "/functions/v1/send-email", {
                method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
                body: JSON.stringify({ type: "CANCELLATION", data: { business_id: tenant.business.id, email: crEmail.data.email, customer_name: crEmail.data.customer_name, ref: sd.booking_id.substring(0, 8).toUpperCase(), tour_name: (crEmail.data as any).tours?.name || "Tour", start_time: (crEmail.data as any).slots?.start_time || "", reason: "Cancelled via WhatsApp — refund requested", total_amount: crTotal.toFixed(2), is_partial: false } }),
              });
            }
          } catch (e) { console.log("cancel refund email err"); }
          const crLoc = tenant.business.location_phrase;
          await sendText(tenant, phone, crRefundMsg + "\n\n" + (crLoc ? "We\u2019d love to have you back " + crLoc + " soon!" : "We\u2019d love to have you back soon!"));
          await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        }
      }
      else { await sendText(tenant, phone, "Great, your booking is safe! \u{1F389}"); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); }
    }

    // ===== CONFIRM CANCEL NO REFUND (<24h) =====
    else if (state === "CONFIRM_CANCEL_ACTION") {
      if (rid === "CONFIRM_CANCEL_NOREFUND" || rid === "CONFIRM_CANCEL" || input === "yes") {
        await supabase.from("bookings").update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: "Customer cancelled (no refund)" }).eq("id", sd.booking_id);
        if (sd.slot_id) { const slr = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single(); if (slr.data) await supabase.from("slots").update({ booked: Math.max(0, slr.data.booked - sd.qty) }).eq("id", sd.slot_id); }
        await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", sd.booking_id).eq("status", "ACTIVE");
        await logE(tenant, "booking_cancelled_no_refund", { booking_id: sd.booking_id }, sd.booking_id);
        // Email
        try {
          const cbkData = await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("id", sd.booking_id).single();
          if (cbkData.data?.email) {
            await fetch(SUPABASE_URL + "/functions/v1/send-email", {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
              body: JSON.stringify({ type: "CANCELLATION", data: { business_id: tenant.business.id, email: cbkData.data.email, customer_name: cbkData.data.customer_name, ref: sd.booking_id.substring(0, 8).toUpperCase(), tour_name: (cbkData.data as any).tours?.name || "Tour", start_time: (cbkData.data as any).slots?.start_time || "", reason: "Cancelled within 24h — no refund", total_amount: String(sd.total), is_partial: false } }),
            });
          }
        } catch (e) { console.log("cancel email err"); }
        await sendText(tenant, phone, "Your booking has been cancelled.\n\nAs it was within 24 hours, no refund is available per our policy.\n\nHope to see you again! \u{1F6F6}");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      } else { await sendText(tenant, phone, "Great, your booking is safe! \u{1F389}"); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); }
    }

    // ===== CONFIRM WX REFUND =====
    else if (state === "CONFIRM_WX_REFUND_ACTION") {
      if (rid === "CONFIRM_WX_REFUND" || input === "yes") {
        const refAmt = sd.total;
        await supabase.from("bookings").update({ refund_status: "ACTION_REQUIRED", refund_amount: refAmt, refund_notes: "100% weather refund" }).eq("id", sd.booking_id);
        await logE(tenant, "refund_requested", { booking_id: sd.booking_id, amount: refAmt }, sd.booking_id);
        const frLoc = tenant.business.location_phrase;
        await sendText(tenant, phone, "Done! A full refund of *R" + refAmt + "* has been submitted \u2014 expect it within 5\u20137 business days.\n\n" + (frLoc ? "We\u2019d love to have you back " + frLoc + " soon!" : "We\u2019d love to have you back soon!"));
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      } else {
        await sendText(tenant, phone, "No worries, your booking remains cancelled and untouched. You can manage it again from the My Bookings menu.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      }
    }

    // ===== CONFIRM VOUCHER (weather bookings) =====
    else if (state === "CONFIRM_VOUCHER_CONVERT") {
      if (rid === "CONFIRM_VOUCHER" || input === "yes") {
        const vcode = genVoucherCode();
        const vTotal = Number(sd.total);
        const vr = await insertVoucherWithRetry({ business_id: tenant.business.id, code: vcode, status: "ACTIVE", type: "CREDIT", value: vTotal, current_balance: vTotal, source_booking_id: sd.booking_id, expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString() });
        if (vr.error) { await sendText(tenant, phone, "Something went wrong. Let me connect you to our team."); await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" }); return; }
        await supabase.from("bookings").update({ status: "CANCELLED", cancelled_at: new Date().toISOString(), cancellation_reason: "Converted to voucher " + vcode, converted_to_voucher_id: vr.data.id }).eq("id", sd.booking_id);
        if (sd.slot_id) { const svr = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single(); if (svr.data) await supabase.from("slots").update({ booked: Math.max(0, svr.data.booked - sd.qty) }).eq("id", sd.slot_id); }
        await logE(tenant, "voucher_from_booking", { booking_id: sd.booking_id, code: vcode, amount: vTotal }, sd.booking_id);
        // Email voucher
        try {
          const vEmail = await supabase.from("bookings").select("email, customer_name").eq("id", sd.booking_id).single();
          if (vEmail.data?.email) {
            await fetch(SUPABASE_URL + "/functions/v1/send-email", {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
              body: JSON.stringify({ type: "CANCELLATION", data: { business_id: tenant.business.id, email: vEmail.data.email, customer_name: vEmail.data.customer_name, ref: sd.booking_id.substring(0, 8).toUpperCase(), tour_name: "Tour", reason: "Converted to voucher via WhatsApp", voucher_code: vcode, voucher_amount: vTotal.toFixed(2), total_amount: vTotal.toFixed(2), is_partial: false } }),
            });
          }
        } catch (e) { console.log("voucher email err"); }
        await sendText(tenant, phone, "All done! Here\u2019s your voucher:\n\n\u{1F39F} Code: *" + vcode + "*\n\u{1F4B0} Value: *R" + vTotal + "*\n\u{1F4C5} Valid for: *3 years*\n\nShare it with a friend or use it yourself \u2014 just type *menu* and select *Redeem Voucher* when you\u2019re ready!");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      } else { await sendText(tenant, phone, "No worries, your booking stays as is! \u{1F389}"); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); }
    }

    // ===== EDIT GUESTS — ask for new number =====
    else if (state === "EDIT_GUESTS_QTY") {
      const newQty = parseInt(input);
      if (isNaN(newQty) || newQty < 1 || newQty > 30) { await sendText(tenant, phone, "Please type a number between 1 and 30."); return; }
      if (newQty === sd.qty) { await sendText(tenant, phone, "That\u2019s the same as your current booking! No changes needed. \u{1F60A}"); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }

      if (newQty > sd.qty) {
        // Adding guests — use atomic capacity check via RPC (H2: don't update slot before payment)
        const addCount = newQty - sd.qty;
        const addCost = addCount * Number(sd.unit_price);
        await sendText(tenant, phone, "Adding " + addCount + " guest" + (addCount !== 1 ? "s" : "") + "...");
        // H2: Create hold via atomic RPC instead of directly updating slots.booked
        const addHoldRes = await supabase.rpc("create_hold_with_capacity_check", {
          p_booking_id: sd.booking_id,
          p_slot_id: sd.slot_id,
          p_qty: addCount,
          p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        if (addHoldRes.error || !addHoldRes.data?.success) {
          await sendText(tenant, phone, addHoldRes.data?.error || "Sorry, not enough spots left for " + addCount + " more. Try a smaller number.");
          return;
        }
        const addNewTotal = newQty * Number(sd.unit_price);
        // M8: Invalidate waiver on guest addition
        await supabase.from("bookings").update({ waiver_status: "PENDING", waiver_token: crypto.randomUUID() }).eq("id", sd.booking_id);
        await logE(tenant, "guests_added_wa", { booking_id: sd.booking_id, old_qty: sd.qty, new_qty: newQty, additional_cost: addCost }, sd.booking_id);
        // Create checkout for extra payment — booking qty/total updated by webhook on payment success
        try {
          const coRes = await fetch(SUPABASE_URL + "/functions/v1/create-checkout", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({ amount: addCost, booking_id: sd.booking_id, business_id: tenant.business.id, type: "BOOKING",
              metadata: { hold_id: addHoldRes.data.hold_id, add_qty: addCount, new_qty: newQty, new_total: addNewTotal } }),
          });
          const coData = await coRes.json();
          if (coData?.redirectUrl) {
            await sendText(tenant, phone, "\u{1F465} *" + addCount + " extra guest" + (addCount !== 1 ? "s" : "") + " reserved!*\n\nNew total will be: " + newQty + " people (R" + addNewTotal + ")\n\nPlease pay the extra *R" + addCost + "* to confirm:\n" + coData.redirectUrl + "\n\n\u23F0 Spots held for 15 minutes.");
          } else {
            // Fallback: update booking directly since checkout failed
            await supabase.from("bookings").update({ qty: newQty, total_amount: addNewTotal }).eq("id", sd.booking_id);
            await sendText(tenant, phone, "\u2705 *" + addCount + " guest" + (addCount !== 1 ? "s" : "") + " added!*\n\nNew total: " + newQty + " people (R" + addNewTotal + ")\n\nA payment link for R" + addCost + " will be sent to your email.");
          }
        } catch (e) {
          // Fallback: update booking directly since checkout failed
          await supabase.from("bookings").update({ qty: newQty, total_amount: addNewTotal }).eq("id", sd.booking_id);
          await sendText(tenant, phone, "\u2705 Guests added! A payment link for R" + addCost + " will be sent shortly.");
        }
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      }
      else {
        // Removing guests
        if (!sd.can_remove) { await sendText(tenant, phone, "Removing guests is only available more than 24 hours before the trip. You can add more guests, or contact our team for help."); return; }
        const rmCount = sd.qty - newQty;
        const rmAmount = rmCount * (Number(sd.total) / Number(sd.qty));
        await sendText(tenant, phone, "Removing " + rmCount + " guest" + (rmCount !== 1 ? "s" : "") + " frees up *R" + rmAmount + "*.\n\nHow would you like your credit?");
        await sendButtons(tenant, phone, "Choose an option:", [
          { id: "GUEST_VOUCHER", title: "\u{1F39F} Voucher (R" + rmAmount + ")" },
          { id: "GUEST_REFUND", title: "\u{1F4B8} Refund (R" + (rmAmount * 0.95).toFixed(0) + ")" },
          { id: "IDLE", title: "\u274C Keep Booking" },
        ]);
        await setConvo(convo.id, { current_state: "EDIT_GUESTS_EXCESS", state_data: { ...sd, new_qty: newQty, rm_count: rmCount, rm_amount: rmAmount } });
      }
    }

    // ===== EDIT GUESTS — refund or voucher for removed guests =====
    else if (state === "EDIT_GUESTS_EXCESS") {
      if (rid === "GUEST_VOUCHER" || input === "voucher") {
        const gvNewTotal = sd.new_qty * Number(sd.unit_price);
        await supabase.from("bookings").update({ qty: sd.new_qty, total_amount: gvNewTotal }).eq("id", sd.booking_id);
        // Release slot capacity
        const gvSlot = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single();
        if (gvSlot.data) await supabase.from("slots").update({ booked: Math.max(0, (gvSlot.data.booked || 0) - sd.rm_count) }).eq("id", sd.slot_id);
        // Create voucher
        const gvCode = genVoucherCode();
        const gvResult = await insertVoucherWithRetry({ business_id: tenant.business.id, code: gvCode, status: "ACTIVE", type: "CREDIT", value: sd.rm_amount, current_balance: sd.rm_amount, source_booking_id: sd.booking_id, expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString() });
        if (gvResult.data) gvCode = gvResult.data.code;
        await logE(tenant, "guests_removed_voucher_wa", { booking_id: sd.booking_id, old_qty: sd.qty, new_qty: sd.new_qty, voucher: gvCode, amount: sd.rm_amount }, sd.booking_id);
        await sendText(tenant, phone, "\u2705 *Updated to " + sd.new_qty + " guest" + (sd.new_qty !== 1 ? "s" : "") + "*\n\nHere\u2019s your voucher:\n\u{1F39F} Code: *" + gvCode + "*\n\u{1F4B0} Value: *R" + sd.rm_amount + "*\n\u{1F4C5} Valid for 3 years");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      }
      else if (rid === "GUEST_REFUND" || input === "refund") {
        const grNewTotal = sd.new_qty * Number(sd.unit_price);
        const grRefund = Math.round(sd.rm_amount * 0.95 * 100) / 100;
        await supabase.from("bookings").update({ qty: sd.new_qty, total_amount: grNewTotal, refund_status: "REQUESTED", refund_amount: grRefund, refund_notes: "Guest removal refund (95%)" }).eq("id", sd.booking_id);
        const grSlot = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single();
        if (grSlot.data) await supabase.from("slots").update({ booked: Math.max(0, (grSlot.data.booked || 0) - sd.rm_count) }).eq("id", sd.slot_id);
        await logE(tenant, "guests_removed_refund_wa", { booking_id: sd.booking_id, old_qty: sd.qty, new_qty: sd.new_qty, refund: grRefund }, sd.booking_id);
        await sendText(tenant, phone, "\u2705 *Updated to " + sd.new_qty + " guest" + (sd.new_qty !== 1 ? "s" : "") + "*\n\nRefund of *R" + grRefund + "* submitted (5% processing fee). Expect it within 5\u20137 business days.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      }
      else { await sendText(tenant, phone, "No changes made. Your booking stays at " + sd.qty + " people. \u{1F389}"); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); }
    }

    // ===== SPECIAL REQUEST INPUT =====
    else if (state === "SPECIAL_REQUEST_INPUT") {
      if (!rawText || rawText.length < 2) { await sendText(tenant, phone, "Please type your special request (e.g., 'birthday celebration' or 'vegetarian')."); return; }
      const srFields = await supabase.from("bookings").select("custom_fields").eq("id", sd.booking_id).single();
      const srExisting = (srFields.data?.custom_fields && typeof srFields.data.custom_fields === "object") ? srFields.data.custom_fields : {};
      srExisting.special_requests = rawText.substring(0, 500);
      await supabase.from("bookings").update({ custom_fields: srExisting }).eq("id", sd.booking_id);
      await logE(tenant, "special_request_wa", { booking_id: sd.booking_id, request: rawText.substring(0, 500) }, sd.booking_id);
      await sendText(tenant, phone, "\u2705 *Special request saved!*\n\n_\"" + rawText.substring(0, 100) + (rawText.length > 100 ? "..." : "") + "\"_\n\nOur team will do their best to accommodate your request. Type *menu* for more options.");
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
    }

    // ===== UPDATE CONTACT — pick field =====
    else if (state === "UPDATE_CONTACT_FIELD") {
      const contactField = rid || "";
      if (contactField === "CONTACT_NAME") {
        await sendText(tenant, phone, "Type the *new name* for this booking:");
        await setConvo(convo.id, { current_state: "UPDATE_CONTACT_VALUE", state_data: { ...sd, contact_field: "customer_name" } });
      }
      else if (contactField === "CONTACT_EMAIL") {
        await sendText(tenant, phone, "Type the *new email address*:");
        await setConvo(convo.id, { current_state: "UPDATE_CONTACT_VALUE", state_data: { ...sd, contact_field: "email" } });
      }
      else if (contactField === "CONTACT_PHONE") {
        await sendText(tenant, phone, "Type the *new phone number* (with country code, e.g. 27812345678):");
        await setConvo(convo.id, { current_state: "UPDATE_CONTACT_VALUE", state_data: { ...sd, contact_field: "phone" } });
      }
      else { await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); await handleMsg(tenant, phone, "hi", "text"); }
    }

    // ===== UPDATE CONTACT — set new value =====
    else if (state === "UPDATE_CONTACT_VALUE") {
      if (!rawText || rawText.length < 2) { await sendText(tenant, phone, "Please type a valid value."); return; }
      const ucField = sd.contact_field;
      const ucValue = rawText.trim();
      // Validation
      if (ucField === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ucValue)) { await sendText(tenant, phone, "That doesn\u2019t look like a valid email. Please try again:"); return; }
      if (ucField === "phone") { ucValue = ucValue.replace(/\D/g, ""); if (ucValue.length < 9) { await sendText(tenant, phone, "Phone number seems too short. Please include country code (e.g. 27812345678):"); return; } }
      const ucUpdate: any = {};
      ucUpdate[ucField] = ucValue;
      await supabase.from("bookings").update(ucUpdate).eq("id", sd.booking_id);
      await logE(tenant, "contact_updated_wa", { booking_id: sd.booking_id, field: ucField, new_value: ucValue }, sd.booking_id);
      const fieldLabel = ucField === "customer_name" ? "Name" : ucField === "email" ? "Email" : "Phone";
      await sendText(tenant, phone, "\u2705 *" + fieldLabel + " updated!*\n\nNew " + fieldLabel.toLowerCase() + ": *" + ucValue + "*\n\nType *menu* for more options.");
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
    }

    // ===== FAQ LIST =====
    else if (state === "FAQ_LIST") {
      const faqMap: any = { FAQ_MEET: "meeting_point", FAQ_BRING: "what_to_bring", FAQ_CANCEL: "cancellation", FAQ_DURATION: "duration", FAQ_SAFE: "safety", FAQ_WEATHER: "weather", FAQ_PRICE: "pricing", FAQ_AGE: "age", FAQ_PARKING: "parking", FAQ_EXPECT: "what_to_expect" };
      const key = faqMap[rid];
      const keyAnswer = key ? getFaqAnswer(tenant, key) : null;
      if (key && keyAnswer) {
        await sendText(tenant, phone, keyAnswer);
        await sendText(tenant, phone, "Anything else? Just ask, or:");
        await sendButtons(tenant, phone, "Quick actions:", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "FAQ_LIST", title: "\u2753 More Questions" }, { id: "IDLE", title: "\u2B05 Main Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
      } else {
        // Try natural language match even in FAQ state
        const fk = matchFAQ(input);
        const fkAnswer = fk ? getFaqAnswer(tenant, fk) : null;
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
      const qty = parseInt(input);
      if (isNaN(qty) || qty < 1 || qty > 30) { await sendText(tenant, phone, "Just need a number between 1 and 30 \u{1F60A}"); return; }

      // Check if there are ANY valid slots left in general (just to catch waitlist cases)
      const tourSlots = sd.tour_id ? await getAvailSlotsForTour(tenant, sd.tour_id, 60) : await getAvailSlots(tenant, 60);
      const fitting = tourSlots.filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) >= qty; });

      if (fitting.length === 0) {
        await sendText(tenant, phone, "Ah, we are fully booked for " + qty + " people right now. Want me to add you to the waitlist? I\u2019ll message you as soon as a spot opens up!");
        await sendButtons(tenant, phone, "Options:", [{ id: "WAITLIST_YES", title: "\u{1F4CB} Join Waitlist" }, { id: "BOOK", title: "\u{1F6F6} Try Another Tour" }, { id: "IDLE", title: "\u2B05 Back" }]);
        await setConvo(convo.id, { current_state: "WAITLIST_OFFER", state_data: { ...sd, qty: qty } });
        return;
      }

      await typingDelay();
      // Show upcoming dates preview so user doesn't have to guess
      const previewMsg = qty + " " + (qty === 1 ? "person" : "people") + " \u2014 nice! \u{1F4C5}\n\nHere\u2019s what\u2019s coming up:\n";
      try {
        const previewSlots = await supabase.from("slots").select("start_time, capacity_total, booked, held, status, tour_id")
          .eq("business_id", tenant.business.id).gt("start_time", new Date().toISOString())
          .lte("start_time", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
          .order("start_time", { ascending: true });
        const pvSlots = previewSlots.data || [];
        // Group by date
        const pvDays: any = {};
        for (let pvi = 0; pvi < pvSlots.length; pvi++) {
          const pvs = pvSlots[pvi];
          const pvDate = formatDateOnly(tenant, pvs.start_time, { weekday: "short", day: "numeric", month: "short" });
          if (!pvDays[pvDate]) pvDays[pvDate] = { open: 0, closed: 0, full: 0 };
          if (pvs.status !== "OPEN") { pvDays[pvDate].closed++; }
          else if (pvs.capacity_total - pvs.booked - (pvs.held || 0) < qty) { pvDays[pvDate].full++; }
          else { pvDays[pvDate].open++; }
        }
        const pvKeys = Object.keys(pvDays);
        let pvShown = 0;
        for (let pvk = 0; pvk < pvKeys.length && pvShown < 5; pvk++) {
          const pvd = pvDays[pvKeys[pvk]];
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
      const pickedDate = "";

      // Attempt Natural Language Date Parsing if they typed it instead of clicking
      if (rawText) {
        if (GK) {
          try {
            const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, {
              method: "POST", headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(5000),
              body: JSON.stringify({
                system_instruction: { parts: [{ text: `You are a date extractor. The user is asking for a date. Today is ${new Date().toISOString().split("T")[0]}. Return exactly one YYYY-MM-DD date string based on their input, or "INVALID" if no date is found. Examples: "Tomorrow" -> next date. "1 September" -> 2026-09-01.` }] },
                contents: [{ role: "user", parts: [{ text: rawText }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 15 }
              })
            });
            const d = await r.json();
            if (d.candidates?.[0]?.content?.parts?.[0]) {
              const extracted = d.candidates[0].content.parts[0].text.trim();
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
      const startIso = zonedDateTimeToUtcIso(tenant, pickedDate, 0, 0);
      const endIso = zonedDateTimeToUtcIso(tenant, pickedDate, 24, 0);

      const slotQ = supabase.from("slots").select("id, start_time, capacity_total, booked, held, status, is_peak, price_per_person_override, tour_id, tours(name, base_price_per_person)")
        .eq("business_id", tenant.business.id)
        .gte("start_time", startIso)
        .lt("start_time", endIso)
        .order("start_time", { ascending: true });

      // Don't filter by tour_id — show ALL activities for the date so user can see all options

      const { data: dbSlots } = await slotQ;

      const pdFormatted = formatDateOnly(tenant, zonedDateTimeToUtcIso(tenant, pickedDate, 12, 0), { weekday: "long", day: "numeric", month: "short" });

      if (!dbSlots || dbSlots.length === 0) {
        await sendText(tenant, phone, "We don\u2019t have any trips scheduled for " + pdFormatted + " yet. Try a date in the next 2 weeks! \u{1F4C5}");
        return;
      }

      const openSlots = [];
      let allClosed = true;
      let hasOpenButFull = false;

      for (const ts of dbSlots) {
        if (ts.status === "OPEN") {
          allClosed = false;
          const t_avail = ts.capacity_total - ts.booked - (ts.held || 0);
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
      const maxDisplay = 10;
      let timeTxt = pdFormatted + " \u2014 pick a time (reply with a number):\n\n";
      const slotMap: any = {};
      const displayCount = Math.min(openSlots.length, maxDisplay);
      for (let ti = 0; ti < displayCount; ti++) {
        const os = openSlots[ti];
        const oavl = os.capacity_total - os.booked - (os.held || 0);
        const opri = os.price_per_person_override || os.tours?.base_price_per_person || 600;
        const otime = formatTimeOnly(tenant, os.start_time, { hour: "2-digit", minute: "2-digit" });
        const tName = os.tours?.name ? os.tours.name + " \u2022 " : "";
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
      let slotId = "";
      const num = parseInt(input.replace(/[^\d]/g, ""));
      if (!isNaN(num) && sd.slot_map && sd.slot_map[num]) {
        slotId = sd.slot_map[num];
      }
      if (!slotId) { await sendText(tenant, phone, "Please reply with a valid number from the list."); return; }
      const sr2 = await supabase.from("slots").select("*").eq("id", slotId).single();
      const slot = sr2.data;
      if (!slot) { await sendText(tenant, phone, "That slot is no longer available. Let\u2019s pick another date \u2014 type a date to try again!"); await setConvo(convo.id, { current_state: "PICK_DATE" }); return; }
      if (slot.status !== "OPEN") { await sendText(tenant, phone, "That slot has been closed (possibly due to weather). Let\u2019s pick another date \u2014 type a new date!"); await setConvo(convo.id, { current_state: "PICK_DATE" }); return; }
      // M5: 60-min cutoff check at slot selection
      const slotStartMs = new Date(slot.start_time).getTime();
      if (slotStartMs - Date.now() < 60 * 60 * 1000) { await sendText(tenant, phone, "Sorry, bookings close 60 minutes before the trip starts. Please pick a later time or another date!"); await setConvo(convo.id, { current_state: "PICK_DATE" }); return; }
      const slotAvailRes = await supabase.rpc("slot_available_capacity", { p_slot_id: slotId });
      const slotAvail = Number(slotAvailRes.data || 0);
      if (slotAvail < sd.qty) { await sendText(tenant, phone, "Not enough spots left on that trip for " + sd.qty + " people (only " + slotAvail + " left). Try another option from the list or type a new date!"); await setConvo(convo.id, { current_state: "PICK_DATE" }); return; }

      if (sd.is_reschedule) {
        await sendText(tenant, phone, "Processing your change... \u23F3");
        const { data: rbData, error: rbErr } = await supabase.functions.invoke("rebook-booking", {
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

      const price = await getSlotPrice(slot);
      const baseTotal = price * sd.qty;
      const disc = await calcDiscount(tenant, sd.qty, phone);
      let finalTotal = baseTotal; const discountMsg = "";
      if (disc.percent > 0) {
        const saving = Math.round(baseTotal * disc.percent / 100); finalTotal = baseTotal - saving;
        if (disc.type === "GROUP") discountMsg = "\n\u{1F389} *5% group discount applied!* You save R" + saving;
        if (disc.type === "LOYALTY") discountMsg = "\n\u{1F31F} *10% loyalty discount!* You save R" + saving;
      }
      // Check if voucher booking — subtract voucher value from total
      // Supports FREE_TRIP pax limit (only covers pax_limit guests) and peak arbitrage
      let voucherDeduction = 0;
      if (sd.voucher_id) {
        const voucherValue = Number(sd.voucher_value || 0);
        if (sd.voucher_type === "FREE_TRIP") {
          const coveredPax = Math.min(sd.voucher_pax_limit || 1, sd.qty);
          const slotCost = price * coveredPax;
          const purchaseVal = Number(sd.voucher_purchase_value || voucherValue);
          // Peak arbitrage: if slot price > purchase_value, treat as credit for purchase_value
          if (slotCost > purchaseVal) {
            voucherDeduction = Math.min(purchaseVal, finalTotal);
          } else {
            voucherDeduction = Math.min(voucherValue, slotCost, finalTotal);
          }
        } else {
          voucherDeduction = Math.min(voucherValue, finalTotal);
        }
        finalTotal = Math.max(0, finalTotal - voucherDeduction);
        if (finalTotal === 0) {
          discountMsg = "\n\u{1F39F} *Voucher applied \u2014 this trip is on us!*";
        } else {
          discountMsg = "\n\u{1F39F} *Voucher applied \u2014 R" + voucherDeduction + " off!*";
        }
      }
      const tourName2 = await supabase.from("tours").select("name").eq("id", slot.tour_id).single();
      let summary = "Here\u2019s your booking summary:\n\n\u{1F6F6} *" + (tourName2.data?.name || "Tour") + "*\n\u{1F4C5} " + fmtTime(tenant, slot.start_time) + "\n\u{1F465} " + sd.qty + " " + (sd.qty === 1 ? "person" : "people") + "\n\u{1F4B0} R" + price + " \u00D7 " + sd.qty + " = R" + baseTotal;
      if (sd.voucher_id && finalTotal === 0) summary += discountMsg + "\n*Total: FREE*";
      else if (sd.voucher_id && finalTotal > 0) summary += discountMsg + "\n*Remaining: R" + finalTotal + "*";
      else if (disc.percent > 0) summary += discountMsg + "\n*Total: R" + finalTotal + "*";
      else summary += "\n*Total: R" + finalTotal + "*";
      summary += "\n\nLook good?";
      const confirmBtns = [{ id: "CONFIRM", title: finalTotal > 0 ? "\u2705 Pay R" + finalTotal : "\u2705 Confirm (FREE)" }, { id: "IDLE", title: "\u274C Cancel" }];
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
      const dParts = rawText.split(/[,;\n]+/).map(function (p) { return p.trim(); }).filter(function (p) { return p.length > 0; });
      // Restore any partial data saved from a previous message in this state
      const dName = sd.partial_name || "";
      const dEmail = sd.partial_email || "";
      for (const dp of dParts) {
        const dc = dp.replace(/^(name|email)[:\-\s]*/i, "").trim();
        if (!dc) continue;
        // Use regex to extract just the email address, handles trailing text like "john@email.com but ..."
        const emailMatch = dc.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
        if (emailMatch && !dEmail) { dEmail = emailMatch[0].toLowerCase(); }
        else if (!emailMatch && dc.match(/[a-zA-Z]/) && !dName) { dName = dc; }
      }

      if (!dName || !dEmail) {
        const dMiss = []; if (!dName) dMiss.push("full name"); if (!dEmail) dMiss.push("email address");
        // Save whatever was valid so the next message doesn't start from scratch
        await setConvo(convo.id, { state_data: { ...sd, partial_name: dName || sd.partial_name || "", partial_email: dEmail || sd.partial_email || "" } });
        const missMsg = dMiss.length === 1
          ? "Got it! I just need your " + dMiss[0] + " now:"
          : "I still need your " + dMiss.join(" and ") + ".\n\nPlease send them together, e.g.:\n*John Smith, john@email.com*";
        await sendText(tenant, phone, missMsg);
        return;
      }
      const customDefs = await getBookingCustomFields(tenant);
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
      const defs = Array.isArray(sd.custom_field_defs) ? sd.custom_field_defs : [];
      const values = { ...(sd.custom_fields || {}) };
      const currentField = nextCustomField(defs, values);
      if (!currentField) {
        await setConvo(convo.id, { current_state: "FINALIZE_BOOKING", state_data: { ...sd, custom_fields: values } });
        await typingDelay();
        await handleMsg(tenant, phone, "internal_proceed", "text", null);
        return;
      }

      const fieldValue = rawText.trim();
      if (!fieldValue && currentField.required) {
        await sendText(tenant, phone, "I still need this before I can lock in the booking:\n\n" + promptForCustomField(currentField));
        return;
      }

      values[currentField.key] = fieldValue;
      const upcomingField = nextCustomField(defs, values);
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
      // M5: Final 60-min cutoff check before creating the booking
      const finalSlotCheck = await supabase.from("slots").select("start_time").eq("id", sd.slot_id).single();
      if (finalSlotCheck.data && new Date(finalSlotCheck.data.start_time).getTime() - Date.now() < 60 * 60 * 1000) {
        await sendText(tenant, phone, "Sorry, bookings close 60 minutes before the trip starts. This slot is no longer available. Please type *menu* to start a new booking.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }
      const email = sd.email;
      const br2 = await supabase.from("bookings").insert({
        business_id: tenant.business.id, tour_id: sd.tour_id, slot_id: sd.slot_id,
        customer_name: sd.customer_name, phone: phone, email: email,
        qty: sd.qty, unit_price: sd.unit_price, total_amount: sd.total,
        original_total: sd.base_total, discount_type: sd.discount_type || null, discount_percent: sd.discount_percent || 0,
        status: "PENDING", source: "WHATSAPP", custom_fields: sd.custom_fields || {},
        marketing_opt_in: null, total_captured: 0, total_refunded: 0,
      }).select().single();
      if (br2.error || !br2.data) { console.error("Err:", JSON.stringify(br2.error)); await sendText(tenant, phone, "Something went wrong. Let me connect you to our team."); await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" }); return; }
      const booking = br2.data;

      // VOUCHER BOOKING — skip payment
      if (sd.voucher_id && sd.total <= 0) {
        await supabase.from("bookings").update({ status: "PAID", yoco_payment_id: "VOUCHER_" + sd.voucher_code }).eq("id", booking.id);
        // Deduct voucher balances — sequential drain using atomic RPC (prevents double-spend)
        const allVIds = sd.voucher_ids || [sd.voucher_id];
        let waRemainingCost = Number(sd.voucher_deduction || sd.original_total || sd.base_total || 0);
        for (let vi = 0; vi < allVIds.length; vi++) {
          if (!allVIds[vi] || waRemainingCost <= 0) continue;
          // Atomic deduction via RPC — drains Voucher A to R0 first, then Voucher B
          const waRpcRes = await supabase.rpc("deduct_voucher_balance", { p_voucher_id: allVIds[vi], p_amount: waRemainingCost });
          if (waRpcRes.data?.success) {
            const waDeducted = Number(waRpcRes.data.deducted);
            const waNewBal = Number(waRpcRes.data.remaining);
            waRemainingCost -= waDeducted;
            await supabase.from("vouchers").update({ redeemed_booking_id: booking.id, redeemed_by_phone: phone }).eq("id", allVIds[vi]);
            if (waNewBal > 0) {
              // Notify about remaining balance via WhatsApp
              const waVCode = await supabase.from("vouchers").select("code").eq("id", allVIds[vi]).single();
              try { await sendText(tenant, phone, "\u{1F39F} Your voucher *" + (waVCode.data?.code || allVIds[vi]) + "* has *R" + waNewBal + "* remaining. Use it on your next booking!"); } catch (e) { }
            }
          } else {
            // Fallback: mark as redeemed if RPC fails (voucher may not exist)
            await supabase.from("vouchers").update({ status: "REDEEMED", redeemed_at: new Date().toISOString(), redeemed_by_phone: phone, redeemed_booking_id: booking.id }).eq("id", allVIds[vi]);
          }
        }
        // H1: Atomic slot update for voucher bookings via RPC
        const vHoldRes = await supabase.rpc("create_hold_with_capacity_check", {
          p_booking_id: booking.id,
          p_slot_id: sd.slot_id,
          p_qty: sd.qty,
          p_expires_at: new Date(Date.now() + 1 * 60 * 1000).toISOString(), // Short hold, already confirmed
        });
        if (vHoldRes.error || !vHoldRes.data?.success) {
          await supabase.from("bookings").update({ status: "CANCELLED", cancellation_reason: "No capacity" }).eq("id", booking.id);
          await sendText(tenant, phone, vHoldRes.data?.error || "Sorry, those spots were just taken! Please try another time slot.");
          await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
          return;
        }
        const vref = booking.id.substring(0, 8).toUpperCase();
        const vslot = await supabase.from("slots").select("start_time").eq("id", sd.slot_id).single();
        const vtour = await supabase.from("tours").select("name").eq("id", sd.tour_id).single();
        const waiverLink = resolveWaiverLink(tenant.business, booking.id, (booking as any).waiver_token);
        await logE(tenant, "voucher_booking_confirmed", { booking_id: booking.id, voucher_code: sd.voucher_code }, booking.id);
        // Upsell second trip
        const otherTours2 = (await getActiveTours(tenant)).filter(function (t: any) { return t.id !== sd.tour_id; });
        if (otherTours2.length > 0) {
          const upsellTour = otherTours2[0];
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
          "\u{1F4CD} *Meeting Point:* " + (tenant.business.directions || "Check your confirmation details from " + businessName(tenant) + " for arrival instructions.") + "\n\n" +
          ((tenant.business as any).what_to_bring ? "\u{1F392} *Bring:* " + (tenant.business as any).what_to_bring + "\n\n" : "") +
          (tenant.business.location_phrase ? "See you " + tenant.business.location_phrase + "!" : "See you soon!")
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

      // PAID BOOKING — atomic capacity check + hold creation to prevent overbooking
      const holdRes = await supabase.rpc("create_hold_with_capacity_check", {
        p_booking_id: booking.id,
        p_slot_id: sd.slot_id,
        p_qty: sd.qty,
        p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      if (holdRes.error || !holdRes.data?.success) { await supabase.from("bookings").update({ status: "CANCELLED", cancellation_reason: "No capacity" }).eq("id", booking.id); await sendText(tenant, phone, holdRes.data?.error || "Sorry, those spots were just taken! Please try another time slot."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      await supabase.from("bookings").update({ status: "HELD" }).eq("id", booking.id);
      await logE(tenant, "hold_created", { booking_id: booking.id }, booking.id);

      const bookingSiteUrls = await getBusinessSiteUrls(tenant);
      console.log("YOCO_CALL: key_len=" + tenant.credentials.yocoSecretKey.length + " amount=" + Math.round(sd.total * 100)); const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
        method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Math.round(sd.total * 100), currency: tenant.business.currency || "ZAR",
          successUrl: withQuery(bookingSiteUrls.bookingSuccessUrl, { ref: booking.id }),
          cancelUrl: bookingSiteUrls.bookingCancelUrl,
          failureUrl: bookingSiteUrls.bookingCancelUrl,
          metadata: { booking_id: booking.id, customer_name: sd.customer_name, qty: String(sd.qty) },
        }),
      });
      const yocoData = await yocoRes.json();
      console.log("YOCO:" + JSON.stringify(yocoData));
      let payUrl = "";
      if (yocoData && yocoData.id && yocoData.redirectUrl) {
        await supabase.from("bookings").update({ yoco_checkout_id: yocoData.id }).eq("id", booking.id);
        payUrl = yocoData.redirectUrl;
      } else { payUrl = "Payment link unavailable \u2014 type *speak to us* for help"; }
      const ref = booking.id.substring(0, 8).toUpperCase();
      await sendText(tenant, phone, "Almost there, " + sd.customer_name.split(" ")[0] + "! \u{1F389}\n\n\u{1F4CB} Ref: " + ref + "\n\u{1F4B0} Total: R" + sd.total + "\n\nComplete your payment here:\n" + payUrl + "\n\n\u23F0 Your spots are held for 15 minutes.");
      await setConvo(convo.id, { current_state: "AWAITING_PAYMENT", state_data: { booking_id: booking.id }, last_booking_id: booking.id, customer_name: sd.customer_name, email: email });
      await logE(tenant, "payment_link_sent", { booking_id: booking.id }, booking.id);
    }

    // ===== AWAITING_PAYMENT =====
    else if (state === "AWAITING_PAYMENT") {
      // L9: Check if hold has expired
      if (sd.booking_id) {
        const awHold = await supabase.from("holds").select("status, expires_at").eq("booking_id", sd.booking_id).eq("status", "ACTIVE").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (awHold.data && new Date(awHold.data.expires_at) < new Date()) {
          await sendText(tenant, phone, "Your hold has expired and the spots have been released. \u{1F614}\n\nNo worries \u2014 type *book* to start a new booking and grab fresh spots!");
          await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
          return;
        }
        if (!awHold.data) {
          // No active hold found — check if booking is still HELD
          const awBk = await supabase.from("bookings").select("status").eq("id", sd.booking_id).single();
          if (awBk.data && awBk.data.status !== "HELD" && awBk.data.status !== "PAID") {
            await sendText(tenant, phone, "Your booking hold has expired. Type *book* to start a new booking!");
            await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
            return;
          }
        }
      }
      if (input === "help" || input === "speak" || input === "human" || input.includes("speak to")) { await sendText(tenant, phone, "Connecting you to our team..."); await setConvo(convo.id, { status: "HUMAN" }); }
      else { await sendText(tenant, phone, "Just waiting for your payment to come through! \u{1F4B3}\n\nAlready paid? It can take a moment to process.\n\nNeed help? Type *speak to us*\nStart over? Type *menu*"); }
    }

    // ===== REDEEM VOUCHER =====

    // ===== GIFT VOUCHER PURCHASE =====
    else if (state === "GV_PICK_TOUR") {
      const tourId = rid ? rid.replace("GV_", "") : "";
      if (!tourId) { await sendText(tenant, phone, "Please pick a tour from the list."); return; }
      const tourInfo = await supabase.from("tours").select("*").eq("id", tourId).single();
      if (!tourInfo.data) { await sendText(tenant, phone, "Can't find that tour. Let's try again."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      const t = tourInfo.data;
      await sendText(tenant, phone, "\u{1F381} *" + t.name + " Gift Voucher*\nValue: R" + t.base_price_per_person + "\n\nWho is this voucher for? Type their name (e.g. Sarah):");
      await setConvo(convo.id, { current_state: "GV_RECIPIENT_NAME", state_data: { tour_id: tourId, tour_name: t.name, value: t.base_price_per_person } });
    }

    else if (state === "GV_RECIPIENT_NAME") {
      if (rawText.length < 1) { await sendText(tenant, phone, "Please type the recipient's name:"); return; }
      await sendText(tenant, phone, "Nice! And would you like to add a personal message?\n\nType your message (e.g. \"Happy Birthday! Enjoy the adventure!\")\n\nOr type *skip* to skip:");
      await setConvo(convo.id, { current_state: "GV_MESSAGE", state_data: { ...sd, recipient_name: rawText } });
    }

    else if (state === "GV_MESSAGE") {
      const giftMsg = (input === "skip" || input === "no") ? "" : rawText;
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
      const buyerEmail = rawText.toLowerCase();
      let summary = "\u{1F381} *Gift Voucher Summary*\n\n" +
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
        const vcode = genVoucherCode();
        const vr = await insertVoucherWithRetry({
          business_id: tenant.business.id, code: vcode, status: "PENDING", type: "FREE_TRIP",
          recipient_name: sd.recipient_name, gift_message: sd.gift_message || null,
          buyer_name: sd.buyer_name, buyer_email: sd.buyer_email, buyer_phone: phone,
          tour_name: sd.tour_name, value: sd.value, purchase_amount: sd.value, current_balance: sd.value,
          pax_limit: 1, purchase_value: sd.value,
          expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        });

        if (vr.error || !vr.data) {
          console.error("GV_ERR:", JSON.stringify(vr.error));
          await sendText(tenant, phone, "Something went wrong. Let me connect you to our team.");
          await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
          return;
        }

        // Create Yoco checkout
        // Uses global tenant.credentials.yocoSecretKey
        const voucherSiteUrls = await getBusinessSiteUrls(tenant);
        const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
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
        const yocoData = await yocoRes.json();
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
      const code = rawText.toUpperCase().replace(/\s/g, "");
      if (code.length !== 8) { await sendText(tenant, phone, "Voucher codes are 8 characters long. Double-check and try again:"); return; }
      const vr2 = await supabase.from("vouchers").select().eq("code", code).eq("status", "ACTIVE").eq("business_id", tenant.business.id).single();
      if (!vr2.data) {
        // Check if redeemed
        const vUsed = await supabase.from("vouchers").select("status").eq("code", code).eq("business_id", tenant.business.id).single();
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

      // Get voucher value + type metadata for FREE_TRIP pax limit and peak arbitrage
      const vVal = Number(vr2.data.current_balance || vr2.data.value || vr2.data.purchase_amount || 0);
      const vType = vr2.data.type || "CREDIT";
      const vPaxLimit = vr2.data.pax_limit || 1;
      const vPurchaseValue = Number(vr2.data.purchase_value || vr2.data.purchase_amount || vr2.data.value || 0);
      const tours3 = await getActiveTours(tenant);
      if (tours3.length === 1) {
        await sendText(tenant, phone, "\u{1F389} Voucher accepted! (R" + vVal + " credit)\n\nHow many people will be joining?");
        await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { voucher_code: code, voucher_id: vr2.data.id, voucher_value: vVal, voucher_type: vType, voucher_pax_limit: vPaxLimit, voucher_purchase_value: vPurchaseValue, tour_id: tours3[0].id } });
      } else {
        const vtrows: any[] = [];
        for (let vti = 0; vti < tours3.length; vti++) {
          const vtr = tours3[vti];
          vtrows.push({ id: "TOUR_" + vtr.id, title: vtr.name, description: vtr.duration_minutes + " min \u2022 normally R" + vtr.base_price_per_person + "/pp" });
        }
        await sendText(tenant, phone, "\u{1F389} Voucher accepted! (R" + vVal + " credit)\n\nWhich tour would you like?");
        await sendList(tenant, phone, "Pick your adventure:", "Choose Tour", [{ title: "Tours", rows: vtrows }]);
        await setConvo(convo.id, { current_state: "PICK_TOUR", state_data: { voucher_code: code, voucher_id: vr2.data.id, voucher_value: vVal, voucher_type: vType, voucher_pax_limit: vPaxLimit, voucher_purchase_value: vPurchaseValue } });
      }
    }


    // ===== ADD EXTRA VOUCHER =====
    else if (state === "ADD_EXTRA_VOUCHER") {
      const xcode = rawText.toUpperCase().replace(/\s/g, "");
      if (xcode.length !== 8) { await sendText(tenant, phone, "Voucher codes are 8 characters long. Try again:"); return; }
      const xvr = await supabase.from("vouchers").select().eq("code", xcode).eq("status", "ACTIVE").eq("business_id", tenant.business.id).single();
      if (!xvr.data) {
        const xUsed = await supabase.from("vouchers").select("status").eq("code", xcode).eq("business_id", tenant.business.id).single();
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
      const xVal = Number(xvr.data.current_balance || xvr.data.value || xvr.data.purchase_amount || 0);
      const existingVoucherValue = Number(sd.voucher_value || 0);
      const newVoucherValue = existingVoucherValue + xVal;
      // Store multiple voucher codes and IDs
      const vCodes = (sd.voucher_codes || [sd.voucher_code].filter(Boolean));
      vCodes.push(xcode);
      const vIds = (sd.voucher_ids || [sd.voucher_id].filter(Boolean));
      vIds.push(xvr.data.id);
      // Recalculate total
      const newDeduction = Math.min(newVoucherValue, Number(sd.base_total));
      let newTotal = Math.max(0, Number(sd.base_total) - newDeduction);
      // Apply any other discounts too
      if (sd.discount_percent > 0 && !sd.voucher_id) {
        const discSaving = Math.round(Number(sd.base_total) * sd.discount_percent / 100);
        newTotal = Math.max(0, newTotal - discSaving);
      }
      const xMsg = "\u{1F39F} *Second voucher applied!* (R" + xVal + " credit)\n\n";
      if (newTotal === 0) xMsg += "Your trip is now *completely FREE!*";
      else xMsg += "Remaining balance: *R" + newTotal + "*";
      await sendText(tenant, phone, xMsg);
      const updatedSd = { ...sd, voucher_value: newVoucherValue, voucher_codes: vCodes, voucher_ids: vIds, voucher_deduction: newDeduction, total: newTotal };
      const cBtns = [{ id: "CONFIRM", title: newTotal > 0 ? "\u2705 Pay R" + newTotal : "\u2705 Confirm (FREE)" }, { id: "IDLE", title: "\u274C Cancel" }];
      if (newTotal > 0) cBtns.splice(1, 0, { id: "ADD_VOUCHER", title: "\u{1F39F} Add Voucher" });
      await sendButtons(tenant, phone, "Ready to proceed?", cBtns);
      await setConvo(convo.id, { current_state: "CONFIRM_BOOKING", state_data: updatedSd });
    }


    // ===== ASK MODE =====
    else if (state === "ASK_MODE") {
      // Smart context-aware answering with database lookups
      await typingDelay();

      // PRIORITY 1: Check booking-related intents first (before FAQ!)
      const wantReschedule = input.includes("reschedule") || input.includes("move") && (input.includes("booking") || input.includes("trip")) || (input.includes("change") && (input.includes("date") || input.includes("time") || input.includes("booking") || input.includes("day")));
      const wantCancel = (input.includes("cancel") && !input.includes("cancellation") && !input.includes("policy")) || (input.includes("refund") && input.includes("my"));
      const wantMyBooking = input.includes("my booking") || input.includes("my trip") || input.includes("my tour") || (input.includes("booking") && (input.includes("today") || input.includes("made") || input.includes("check") || input.includes("status") || input.includes("when") || input.includes("detail") || input.includes("info"))) || (input.includes("when") && (input.includes("my") || input.includes("trip") || input.includes("tour") || input.includes("paddle"))) || (input.includes("what time") && input.includes("my")) || (input.includes("how many") && input.includes("my")) || (input.includes("ref") && (input.includes("my") || input.includes("booking")));
      const wantBook = input.includes("book") && (input.includes("want") || input.includes("like") || input.includes("can i"));
      const wantAddPeople = (input.includes("add") || input.includes("more") || input.includes("extra")) && (input.includes("people") || input.includes("person") || input.includes("pax") || input.includes("guest") || input.includes("friend"));
      const wantReducePeople = (input.includes("reduce") || input.includes("remove") || input.includes("less") || input.includes("fewer")) && (input.includes("people") || input.includes("person") || input.includes("pax"));
      const wantChangeTour = (input.includes("change") || input.includes("switch") || input.includes("swap")) && (input.includes("tour") || input.includes("sea") || input.includes("sunset"));
      const wantChangeName = (input.includes("change") || input.includes("update") || input.includes("wrong")) && (input.includes("name") || input.includes("person"));
      const wantPaymentLink = input.includes("payment") && (input.includes("link") || input.includes("pay") || input.includes("again") || input.includes("new")) || (input.includes("didn") && input.includes("pay")) || input.includes("resend");
      const wantConfirmEmail = (input.includes("email") || input.includes("confirmation")) && (input.includes("resend") || input.includes("again") || input.includes("didn") || input.includes("not received") || input.includes("haven"));
      const wantReceipt = input.includes("receipt") || input.includes("invoice") || input.includes("proof") && input.includes("payment");
      const wantWrongDate = (input.includes("wrong") && (input.includes("date") || input.includes("day") || input.includes("time"))) || (input.includes("booked") && input.includes("wrong"));

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
        const addBkr = await supabase.from("bookings").select("id, qty, total_amount, unit_price, slot_id, tour_id, slots(start_time, capacity_total, booked, held), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (addBkr.data) {
          const addBk = addBkr.data; const addRef = addBk.id.substring(0, 8).toUpperCase();
          const addSlot = (addBk as any).slots; const addTour = (addBk as any).tours;
          const addAvail = addSlot ? addSlot.capacity_total - addSlot.booked - (addSlot.held || 0) : 0;
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
        const redBkr = await supabase.from("bookings").select("id, qty, total_amount, unit_price, slot_id, tour_id, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (redBkr.data) {
          const redBk = redBkr.data; const redRef = redBk.id.substring(0, 8).toUpperCase();
          const redSlot = (redBk as any).slots; const redTour = (redBk as any).tours;
          const redHrs = redSlot ? (new Date(redSlot.start_time).getTime() - Date.now()) / (1000 * 60 * 60) : 0;
          const refundNote = redHrs >= 24 ? "You\u2019ll get a refund for the difference." : "As it\u2019s within 24 hours, the refund policy applies.";
          await sendText(tenant, phone, "Your booking *" + redRef + "* has " + redBk.qty + " people on " + (redTour?.name || "Tour") + ".\n\n" + refundNote + "\n\nHow many people total would you like? (Currently " + redBk.qty + ")");
          await setConvo(convo.id, { current_state: "MODIFY_QTY", state_data: { booking_id: redBk.id, slot_id: redBk.slot_id, tour_id: redBk.tour_id, current_qty: redBk.qty, unit_price: redBk.unit_price, max_avail: 30, hours_before: redHrs } });
        } else {
          await sendText(tenant, phone, "No active booking found. Try My Bookings.");
          await setConvo(convo.id, { current_state: "MENU" });
        }
        return;
      }

      if (wantChangeTour) {
        const ctBkr = await supabase.from("bookings").select("id, qty, total_amount, unit_price, slot_id, tour_id, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (ctBkr.data) {
          const ctBk = ctBkr.data; const ctRef = ctBk.id.substring(0, 8).toUpperCase();
          const ctTour = (ctBk as any).tours;
          const ctSlot = (ctBk as any).slots;
          const tours = await getActiveTours(tenant);
          const otherTours = tours.filter(function (t: any) { return t.id !== ctBk.tour_id; });
          if (otherTours.length > 0) {
            await sendText(tenant, phone, "Your booking *" + ctRef + "* is for *" + (ctTour?.name || "Tour") + "* on " + (ctSlot ? fmtTime(tenant, ctSlot.start_time) : "TBC") + ".\n\nWhich tour would you like to switch to?");
            const ctRows = otherTours.map(function (t: any) { return { id: "CHTOUR_" + t.id, title: t.name, description: "R" + t.base_price_per_person + "/pp \u2022 " + t.duration_minutes + " min" }; });
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
        const nmBkr = await supabase.from("bookings").select("id, customer_name, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (nmBkr.data) {
          const nmBk = nmBkr.data; const nmRef = nmBk.id.substring(0, 8).toUpperCase();
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
        const payBkr = await supabase.from("bookings").select("id, status, total_amount, yoco_checkout_id, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["HELD", "PENDING"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (payBkr.data && payBkr.data.yoco_checkout_id) {
          // Create new checkout
          const rpBk = payBkr.data;
          const rpRef = rpBk.id.substring(0, 8).toUpperCase();
          const resendSiteUrls = await getBusinessSiteUrls(tenant);
          const rpYoco = await fetch("https://payments.yoco.com/api/checkouts", {
            method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: Math.round(Number(rpBk.total_amount) * 100), currency: tenant.business.currency || "ZAR",
              successUrl: withQuery(resendSiteUrls.bookingSuccessUrl, { ref: rpBk.id }),
              cancelUrl: resendSiteUrls.bookingCancelUrl,
              failureUrl: resendSiteUrls.bookingCancelUrl,
              metadata: { booking_id: rpBk.id, type: "RESEND" },
            }),
          });
          const rpYocoData = await rpYoco.json();
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
        const emBkr = await supabase.from("bookings").select("id, email, customer_name, qty, total_amount, status, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (emBkr.data) {
          const emBk = emBkr.data; const emRef = emBk.id.substring(0, 8).toUpperCase();
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
      const wantSplit = (input.includes("split") && input.includes("pay")) || (input.includes("separate") && input.includes("pay"));
      if (wantSplit) {
        const spBkr = await supabase.from("bookings").select("id, total_amount, status")
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
      const wantCash = input.includes("cash") || (input.includes("deposit") && !input.includes("refund"));
      if (wantCash) {
        const cashBkr = await supabase.from("bookings").select("id, total_amount, status")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["HELD", "PENDING"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (cashBkr.data) {
          const depAmount = Math.round(Number(cashBkr.data.total_amount) * 0.5);
          const depositSiteUrls = await getBusinessSiteUrls(tenant);
          const depYoco = await fetch("https://payments.yoco.com/api/checkouts", {
            method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: Math.round(depAmount * 100), currency: tenant.business.currency || "ZAR",
              successUrl: withQuery(depositSiteUrls.bookingSuccessUrl, { ref: cashBkr.data.id }),
              cancelUrl: depositSiteUrls.bookingCancelUrl,
              metadata: { booking_id: cashBkr.data.id, type: "DEPOSIT_50" },
            }),
          });
          const depData = await depYoco.json();
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
        const weatherHandled = await checkWeatherConcern(tenant, phone, input);
        if (weatherHandled) { await setConvo(convo.id, { current_state: "MENU" }); return; }
      }

      // Check smart availability before FAQ
      if (!wantReschedule && !wantCancel && !wantMyBooking && detectAvailQuery(input)) {
        const askHandled = await handleSmartAvail(tenant, phone, input);
        if (askHandled) { await setConvo(convo.id, { current_state: "MENU" }); return; }
      }

      if (wantReschedule || wantCancel || wantMyBooking) {
        // Look up their bookings
        const askBkr = await supabase.from("bookings").select("id, status, qty, total_amount, slot_id, tour_id, created_at, slots(start_time), tours(name)")
          .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(5);
        const askBookings = askBkr.data || [];

        if (askBookings.length === 0) {
          await sendText(tenant, phone, "I couldn\u2019t find any active bookings linked to this phone number. If you booked with a different number, try the My Bookings page on our website with your email.");
          await sendButtons(tenant, phone, "What else?", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "ASK", title: "\u2753 Another Question" }, { id: "IDLE", title: "\u2B05 Menu" }]);
          await setConvo(convo.id, { current_state: "MENU" });
          return;
        }

        // If they want to reschedule
        if (wantReschedule) {
          if (askBookings.length === 1) {
            const rb = askBookings[0]; const rbSlot = (rb as any).slots; const rbTour = (rb as any).tours;
            const rbRef = rb.id.substring(0, 8).toUpperCase();
            const rbHrs = rbSlot ? (new Date(rbSlot.start_time).getTime() - Date.now()) / (1000 * 60 * 60) : 0;

            if (rbHrs < 24) {
              await sendText(tenant, phone, "Your booking *" + rbRef + "* for " + (rbTour?.name || "the tour") + " on " + (rbSlot ? fmtTime(tenant, rbSlot.start_time) : "TBC") + " is within 24 hours, so rescheduling isn\u2019t available anymore. You can contact our team for help.");
              await sendButtons(tenant, phone, "Options:", [{ id: "HUMAN", title: "\u{1F4AC} Speak to Team" }, { id: "IDLE", title: "\u2B05 Menu" }]);
              await setConvo(convo.id, { current_state: "MENU" });
              return;
            }

            // Check reschedule count
            const rCount = await supabase.from("bookings").select("reschedule_count").eq("id", rb.id).single();
            if (rCount.data && rCount.data.reschedule_count >= 2) {
              await sendText(tenant, phone, "You\u2019ve already rescheduled this booking twice. Let me connect you to our team.");
              await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
              return;
            }

            // Load slots for reschedule
            const askRSlots = rb.tour_id ? await getAvailSlotsForTour(tenant, rb.tour_id, 60) : await getAvailSlots(tenant, 60);
            const askRFitting = askRSlots.filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) >= rb.qty && s.id !== rb.slot_id; });

            if (askRFitting.length === 0) {
              await sendText(tenant, phone, "No alternative slots with enough space right now. Let me connect you to our team.");
              await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
              return;
            }

            await sendText(tenant, phone, "Sure! I found your booking:\n\n\u{1F6F6} *" + (rbTour?.name || "Tour") + "*\n\u{1F4C5} " + (rbSlot ? fmtTime(tenant, rbSlot.start_time) : "TBC") + "\n\u{1F465} " + rb.qty + " people\n\nPick a new date:");

            // Group by week
            const askRGroups: any = {};
            for (let ari = 0; ari < askRFitting.length; ari++) {
              const ars = askRFitting[ari]; const arsDate = new Date(ars.start_time);
              const arwStart = new Date(arsDate); arwStart.setDate(arwStart.getDate() - arwStart.getDay());
              const arwLabel = formatDateOnly(tenant, arwStart.toISOString(), { day: "numeric", month: "short" });
              const arwKey = arwStart.toISOString().split("T")[0];
              if (!askRGroups[arwKey]) askRGroups[arwKey] = { label: "Week of " + arwLabel, rows: [] };
              if (askRGroups[arwKey].rows.length < 10) {
                askRGroups[arwKey].rows.push({ id: "RSLOT_" + ars.id, title: fmtTime(tenant, ars.start_time).substring(0, 24), description: (ars.capacity_total - ars.booked - (ars.held || 0)) + " spots" });
              }
            }
            const askRSecs: any[] = []; const askRKeys = Object.keys(askRGroups).sort(); const askRTotal = 0;
            for (let ark = 0; ark < askRKeys.length && askRTotal < 10; ark++) {
              const arg = askRGroups[askRKeys[ark]]; const arRem = 10 - askRTotal;
              if (arg.rows.length > arRem) arg.rows = arg.rows.slice(0, arRem);
              askRTotal += arg.rows.length; askRSecs.push({ title: arg.label.substring(0, 24), rows: arg.rows });
            }
            await sendList(tenant, phone, "Scroll through weeks:", "View Dates", askRSecs);
            await setConvo(convo.id, { current_state: "RESCHEDULE_PICK", state_data: { booking_id: rb.id, slot_id: rb.slot_id, qty: rb.qty, total: rb.total_amount, tour_id: rb.tour_id, reschedule_count: rCount.data?.reschedule_count || 0 } });
            return;
          } else {
            // Multiple bookings — let them pick
            let rbMsg = "I found " + askBookings.length + " active bookings. Which one do you want to reschedule?\n\n";
            const rbRows: any[] = [];
            for (let rbi = 0; rbi < askBookings.length; rbi++) {
              const rbb = askBookings[rbi]; const rbbSlot = (rbb as any).slots; const rbbTour = (rbb as any).tours;
              const rbbRef = rbb.id.substring(0, 8).toUpperCase();
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
            const cb = askBookings[0]; const cbSlot = (cb as any).slots; const cbTour = (cb as any).tours;
            const cbRef = cb.id.substring(0, 8).toUpperCase();
            const cbHrs = cbSlot ? (new Date(cbSlot.start_time).getTime() - Date.now()) / (1000 * 60 * 60) : 0;
            let cbDetail = "I found your booking:\n\n\u{1F6F6} *" + (cbTour?.name || "Tour") + "*\n\u{1F4C5} " + (cbSlot ? fmtTime(tenant, cbSlot.start_time) : "TBC") + "\n\u{1F465} " + cb.qty + " people\n\n";
            if (cbHrs >= 24) {
              // M4: Transition to CANCEL_CHOICE so user can pick voucher vs refund
              const cbRefund = Math.round(Number(cb.total_amount) * 0.95 * 100) / 100;
              cbDetail += "How would you like to cancel?\n\n*Option 1: Gift Voucher* \u{1F39F}\nR" + cb.total_amount + " voucher \u2022 No fees \u2022 Valid 3 years\n\n*Option 2: Refund* \u{1F4B8}\nR" + cbRefund + " (5% processing fee) \u2022 5-7 business days";
              await sendButtons(tenant, phone, cbDetail, [
                { id: "CANCEL_VOUCHER", title: "\u{1F39F} Voucher (best)" },
                { id: "CANCEL_REFUND", title: "\u{1F4B8} Refund" },
                { id: "IDLE", title: "\u274C Keep Booking" },
              ]);
              await setConvo(convo.id, { current_state: "CANCEL_CHOICE", state_data: { booking_id: cb.id, slot_id: cb.slot_id, qty: cb.qty, total: cb.total_amount, hours_before: cbHrs } });
            } else {
              cbDetail += "This is within 24 hours so *no refund* is available. Still cancel?";
              await sendButtons(tenant, phone, cbDetail, [{ id: "CONFIRM_CANCEL", title: "\u2705 Yes, Cancel" }, { id: "IDLE", title: "\u274C Keep It" }]);
              await setConvo(convo.id, { current_state: "CONFIRM_CANCEL_ACTION", state_data: { booking_id: cb.id, slot_id: cb.slot_id, qty: cb.qty, total: cb.total_amount, hours_before: cbHrs } });
            }
            return;
          } else {
            // Multiple — show list
            const cbMsg = "Which booking do you want to cancel?\n\n";
            const cbRows: any[] = [];
            for (let cbi = 0; cbi < askBookings.length; cbi++) {
              const cbb = askBookings[cbi]; const cbbSlot = (cbb as any).slots; const cbbTour = (cbb as any).tours;
              const cbbRef = cbb.id.substring(0, 8).toUpperCase();
              cbRows.push({ id: "BK_" + cbb.id, title: cbbRef + " - " + (cbbTour?.name || "").substring(0, 15), description: cbbSlot ? fmtTime(tenant, cbbSlot.start_time).substring(0, 24) : "TBC" });
            }
            await sendList(tenant, phone, cbMsg, "Select Booking", [{ title: "Your Bookings", rows: cbRows }]);
            await setConvo(convo.id, { current_state: "MY_BOOKINGS_LIST" });
            return;
          }
        }

        // General booking inquiry
        let bMsg = "Here are your active bookings:\n\n";
        for (let abi = 0; abi < askBookings.length; abi++) {
          const ab = askBookings[abi]; const abSlot = (ab as any).slots; const abTour = (ab as any).tours;
          bMsg += "\u{1F6F6} *" + (abTour?.name || "Tour") + "*\n\u{1F4C5} " + (abSlot ? fmtTime(tenant, abSlot.start_time) : "TBC") + "\n\u{1F465} " + ab.qty + " people \u2022 " + ab.status + "\nRef: " + ab.id.substring(0, 8).toUpperCase() + "\n\n";
        }
        bMsg += "Need to change anything?";
        await sendButtons(tenant, phone, bMsg, [{ id: "MY_BOOKINGS", title: "\u{1F4CB} Manage Bookings" }, { id: "ASK", title: "\u2753 Another Question" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // PRIORITY 2: Check FAQ (after booking intents)
      const askFaq = matchFAQ(input);
      const askFaqAnswer = askFaq ? getFaqAnswer(tenant, askFaq) : null;
      if (askFaq && askFaqAnswer) {
        await sendText(tenant, phone, askFaqAnswer);
        await sendButtons(tenant, phone, "Anything else?", [{ id: "ASK", title: "\u2753 Another Question" }, { id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // PRIORITY 3: Try Gemini with database context
      let gemContext = "";
      // Get their bookings for context
      const ctxBkr = await supabase.from("bookings").select("id, status, qty, total_amount, slots(start_time), tours(name)")
        .eq("phone", phone).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED"])
        .order("created_at", { ascending: false }).limit(3);
      const ctxBookings = ctxBkr.data || [];
      if (ctxBookings.length > 0) {
        gemContext = "\nUser has these active bookings: ";
        for (let ci = 0; ci < ctxBookings.length; ci++) {
          const cb2 = ctxBookings[ci]; const cb2Slot = (cb2 as any).slots; const cb2Tour = (cb2 as any).tours;
          gemContext += (cb2Tour?.name || "Tour") + " on " + (cb2Slot ? fmtTime(tenant, cb2Slot.start_time) : "TBC") + " (" + cb2.qty + " ppl, " + cb2.status + "), ";
        }
      }

      // Get next available slots for context
      const ctxSlots = await getAvailSlots(tenant, 5);
      if (ctxSlots.length > 0) {
        gemContext += "\nNext available: ";
        for (let csi = 0; csi < ctxSlots.length; csi++) {
          const cs = ctxSlots[csi];
          gemContext += fmtTime(tenant, cs.start_time) + " (" + (cs.capacity_total - cs.booked - (cs.held || 0)) + " spots), ";
        }
      }

      // Call Gemini with full context
      if (GK) {
        try {
          const ctxR = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: buildGeminiInstruction(tenant, gemContext) }] },
              contents: [{ role: "user", parts: [{ text: rawText }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 200 }
            })
          });
          const ctxD = await ctxR.json();
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
      const newQty = parseInt(input);
      if (isNaN(newQty) || newQty < 1 || newQty > 30) { await sendText(tenant, phone, "Just need a number between 1 and 30:"); return; }
      if (newQty === sd.current_qty) { await sendText(tenant, phone, "That\u2019s the same as your current booking! No changes needed \u{1F60A}"); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      if (newQty > sd.max_avail) { await sendText(tenant, phone, "Only " + sd.max_avail + " spots available. Try a smaller number:"); return; }
      // M3: Block guest removal within 24 hours
      const qtyDiff = newQty - sd.current_qty;
      if (qtyDiff < 0 && sd.hours_before !== undefined && sd.hours_before < 24) {
        await sendText(tenant, phone, "Guest removal isn\u2019t available within 24 hours of the trip. You can contact our team for help.");
        await sendButtons(tenant, phone, "Options:", [{ id: "HUMAN", title: "\u{1F4AC} Speak to Team" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }
      // Recalculate discount for new qty (group discount threshold may change)
      const mqDisc = await calcDiscount(tenant, newQty, phone);
      const mqBaseTotal = newQty * Number(sd.unit_price);
      const newTotal = mqBaseTotal;
      if (mqDisc.percent > 0) { newTotal = mqBaseTotal - Math.round(mqBaseTotal * mqDisc.percent / 100); }
      const oldTotal = sd.current_qty * Number(sd.unit_price);
      const oldDisc = await calcDiscount(tenant, sd.current_qty, phone);
      if (oldDisc.percent > 0) { oldTotal = oldTotal - Math.round(oldTotal * oldDisc.percent / 100); }
      const diffAmount = Math.abs(newTotal - oldTotal);
      if (qtyDiff > 0) {
        // Added people — use atomic capacity check via RPC
        const mqHoldRes = await supabase.rpc("create_hold_with_capacity_check", {
          p_booking_id: sd.booking_id,
          p_slot_id: sd.slot_id,
          p_qty: qtyDiff,
          p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        if (mqHoldRes.error || !mqHoldRes.data?.success) {
          await sendText(tenant, phone, mqHoldRes.data?.error || "Sorry, not enough spots left. Try a smaller number.");
          return;
        }
        // Update booking
        await supabase.from("bookings").update({ qty: newQty, total_amount: newTotal, discount_type: mqDisc.type || null, discount_percent: mqDisc.percent || 0 }).eq("id", sd.booking_id);
        // M8: Invalidate waiver on guest addition
        await supabase.from("bookings").update({ waiver_status: "PENDING", waiver_token: crypto.randomUUID() }).eq("id", sd.booking_id);
        // Need additional payment
        const addSiteUrls = await getBusinessSiteUrls(tenant);
        const addYoco = await fetch("https://payments.yoco.com/api/checkouts", {
          method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Math.round(diffAmount * 100), currency: tenant.business.currency || "ZAR",
            successUrl: withQuery(addSiteUrls.bookingSuccessUrl, { ref: sd.booking_id }),
            cancelUrl: addSiteUrls.bookingCancelUrl,
            failureUrl: addSiteUrls.bookingCancelUrl,
            metadata: { booking_id: sd.booking_id, type: "ADD_PEOPLE", hold_id: mqHoldRes.data.hold_id, add_qty: qtyDiff, new_qty: newQty },
          }),
        });
        const addYocoData = await addYoco.json();
        if (addYocoData?.redirectUrl) {
          await sendText(tenant, phone, "Updated to " + newQty + " people! \u2705\n\nYou need to pay an extra *R" + diffAmount + "* for the " + qtyDiff + " additional " + (qtyDiff === 1 ? "person" : "people") + ":\n\n" + addYocoData.redirectUrl);
        } else {
          await sendText(tenant, phone, "Updated to " + newQty + " people! Please contact our team to arrange the additional payment of R" + diffAmount + ".");
        }
      } else {
        // Reduced people — update booking and release slot capacity
        // TODO: Replace with atomic increment RPC for slot decrement
        await supabase.from("bookings").update({ qty: newQty, total_amount: newTotal, discount_type: mqDisc.type || null, discount_percent: mqDisc.percent || 0 }).eq("id", sd.booking_id);
        const mqSlot = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single();
        if (mqSlot.data) await supabase.from("slots").update({ booked: Math.max(0, mqSlot.data.booked + qtyDiff) }).eq("id", sd.slot_id);
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
      const newTourId = rid ? rid.replace("CHTOUR_", "") : "";
      if (!newTourId) { await sendText(tenant, phone, "Please pick a tour from the list."); return; }
      const newTourInfo = await supabase.from("tours").select("*").eq("id", newTourId).single();
      if (!newTourInfo.data) { await sendText(tenant, phone, "Can\u2019t find that tour."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      const nt = newTourInfo.data;
      // Find a slot for the new tour on a similar date
      const newSlots = await getAvailSlotsForTour(tenant, newTourId, 60);
      const fitting2 = newSlots.filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) >= sd.qty; });
      if (fitting2.length === 0) { await sendText(tenant, phone, "No available slots for " + nt.name + " with " + sd.qty + " spots. Contact our team for help."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      // Group by week
      const ctGroups: any = {};
      for (let cti = 0; cti < fitting2.length; cti++) {
        const cts = fitting2[cti]; const ctsDate = new Date(cts.start_time);
        const ctwStart = new Date(ctsDate); ctwStart.setDate(ctwStart.getDate() - ctwStart.getDay());
        const ctwLabel = formatDateOnly(tenant, ctwStart.toISOString(), { day: "numeric", month: "short" });
        const ctwKey = ctwStart.toISOString().split("T")[0];
        if (!ctGroups[ctwKey]) ctGroups[ctwKey] = { label: "Week of " + ctwLabel, rows: [] };
        if (ctGroups[ctwKey].rows.length < 10) {
          ctGroups[ctwKey].rows.push({ id: "CTSLOT_" + cts.id, title: fmtTime(tenant, cts.start_time).substring(0, 24), description: (cts.capacity_total - cts.booked - (cts.held || 0)) + " spots" });
        }
      }
      const ctSecs: any[] = []; const ctKeys2 = Object.keys(ctGroups).sort(); const ctTotal2 = 0;
      for (let ctk = 0; ctk < ctKeys2.length && ctTotal2 < 10; ctk++) {
        const ctg = ctGroups[ctKeys2[ctk]]; const ctRem = 10 - ctTotal2;
        if (ctg.rows.length > ctRem) ctg.rows = ctg.rows.slice(0, ctRem);
        ctTotal2 += ctg.rows.length; ctSecs.push({ title: ctg.label.substring(0, 24), rows: ctg.rows });
      }
      await sendText(tenant, phone, "Switching to *" + nt.name + "* (R" + nt.base_price_per_person + "/pp). Pick a date:");
      await sendList(tenant, phone, "Available times:", "View Dates", ctSecs);
      await setConvo(convo.id, { current_state: "CHANGE_TOUR_SLOT", state_data: { ...sd, new_tour_id: newTourId, new_tour_name: nt.name, new_price: nt.base_price_per_person } });
    }

    // ===== CHANGE TOUR SLOT =====
    else if (state === "CHANGE_TOUR_SLOT") {
      const ctSlotId = rid ? rid.replace("CTSLOT_", "") : "";
      if (!ctSlotId) { await sendText(tenant, phone, "Please pick a slot."); return; }
      // TODO: Replace with atomic increment RPC for slot decrement/increment
      // Release old slot
      const oldSlotR = await supabase.from("slots").select("booked").eq("id", sd.slot_id).single();
      if (oldSlotR.data) await supabase.from("slots").update({ booked: Math.max(0, oldSlotR.data.booked - sd.qty) }).eq("id", sd.slot_id);
      // Book new slot
      const newSlotR = await supabase.from("slots").select("booked, start_time").eq("id", ctSlotId).single();
      if (newSlotR.data) await supabase.from("slots").update({ booked: newSlotR.data.booked + sd.qty }).eq("id", ctSlotId);
      const newTotal2 = sd.qty * Number(sd.new_price);
      await supabase.from("bookings").update({ tour_id: sd.new_tour_id, slot_id: ctSlotId, unit_price: sd.new_price, total_amount: newTotal2 }).eq("id", sd.booking_id);
      const tsLoc = tenant.business.location_phrase;
      await sendText(tenant, phone, "All done! \u2705 Switched to *" + sd.new_tour_name + "* on " + (newSlotR.data ? fmtTime(tenant, newSlotR.data.start_time) : "TBC") + ".\n\n" + (tsLoc ? "See you " + tsLoc + "!" : "See you soon!"));
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
      const splitCount = parseInt(input);
      if (isNaN(splitCount) || splitCount < 2 || splitCount > 10) { await sendText(tenant, phone, "How many payment links do you need? (2-10)"); return; }
      const splitAmount = Math.round(Number(sd.split_total) / splitCount * 100) / 100;
      const splitLinks = "";
      for (let spi = 0; spi < splitCount; spi++) {
        const splitSiteUrls = await getBusinessSiteUrls(tenant);
        const spYoco = await fetch("https://payments.yoco.com/api/checkouts", {
          method: "POST", headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Math.round(splitAmount * 100), currency: tenant.business.currency || "ZAR",
            successUrl: withQuery(splitSiteUrls.bookingSuccessUrl, { ref: sd.booking_id }),
            cancelUrl: splitSiteUrls.bookingCancelUrl,
            metadata: { booking_id: sd.booking_id, type: "SPLIT_" + (spi + 1) + "_OF_" + splitCount },
          }),
        });
        const spData = await spYoco.json();
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
        const wlName = convo.customer_name || null;
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
      const rSlotId = rid ? rid.replace("RSLOT_", "") : "";
      if (!rSlotId) { await sendText(tenant, phone, "Please pick a slot from the list."); return; }
      // Re-fetch and validate the slot
      const rSlotR = await supabase.from("slots").select("*, tours(name)").eq("id", rSlotId).single();
      const rSlot = rSlotR.data;
      if (!rSlot) { await sendText(tenant, phone, "That slot is no longer available. Let\u2019s try again — type *reschedule* to start over."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      if (rSlot.status !== "OPEN") { await sendText(tenant, phone, "That slot has been closed (possibly due to weather). Try *reschedule* again for updated options."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      const rAvail = rSlot.capacity_total - rSlot.booked - (rSlot.held || 0);
      if (rAvail < sd.qty) { await sendText(tenant, phone, "Not enough spots left on that slot for " + sd.qty + " people. Try *reschedule* again."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      // Call rebook-booking
      await sendText(tenant, phone, "Processing your reschedule... \u23F3");
      const { data: rbkData, error: rbkErr } = await supabase.functions.invoke("rebook-booking", {
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
      const wrBkId = rid.replace("WEATHER_REFUND_", "");
      const wrBk = await supabase.from("bookings").select("id, total_amount, slot_id, qty").eq("id", wrBkId).single();
      if (wrBk.data) {
        await supabase.from("bookings").update({ status: "CANCELLED", cancellation_reason: "Weather cancellation", refund_status: "ACTION_REQUIRED", refund_amount: wrBk.data.total_amount }).eq("id", wrBkId);
        if (wrBk.data.slot_id) {
          const wrSl = await supabase.from("slots").select("booked").eq("id", wrBk.data.slot_id).single();
          if (wrSl.data) await supabase.from("slots").update({ booked: Math.max(0, wrSl.data.booked - wrBk.data.qty) }).eq("id", wrBk.data.slot_id);
        }
        await sendText(tenant, phone, "Full refund of R" + wrBk.data.total_amount + " submitted \u2705 Expect it back on your card within 5-7 business days.\n\nWe\u2019d love to have you back when the weather plays along! Type *book* anytime \u{1F30A}");
      }
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
    }

    // ===== FALLBACK =====
    else {
      // Try FAQ match from any state
      const fallbackFaq = matchFAQ(input);
      const fallbackFaqAnswer = fallbackFaq ? getFaqAnswer(tenant, fallbackFaq) : null;
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
  const url = new URL(req.url);
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode"); const token = url.searchParams.get("hub.verify_token"); const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method === "POST") {
    try {
      // ── 1. Read raw body for signature verification ──
      const rawBody = await req.text();
      const signature = req.headers.get("x-hub-signature-256");
      const verified = await verifyMetaSignature(rawBody, signature);
      if (!verified) {
        console.warn("WA webhook rejected — invalid or missing signature");
        return new Response("Invalid signature", { status: 401 });
      }

      const body = JSON.parse(rawBody);
      const tenant = await resolveTenantByWhatsappPayload(supabase, body);
      const message = body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0];
      if (!message) return new Response("OK", { status: 200 });

      // ── 2. Idempotency: dedup via processed_wa_messages (id TEXT PK) ──
      const msgId = message.id || "";
      if (msgId) {
        try {
          const dedupRes = await supabase
            .from("processed_wa_messages")
            .insert({ id: msgId });
          if (dedupRes.error) {
            // Unique violation = already processed → ack and skip
            if (String(dedupRes.error.code) === "23505" || /duplicate key|unique constraint/i.test(String(dedupRes.error.message || ""))) {
              console.log("WA dedup skip — already processed message id:" + msgId);
              return new Response("OK", { status: 200 });
            }
            // Non-uniqueness errors (e.g. table missing) → log and continue, do not block
            console.error("WA dedup non-fatal error:", dedupRes.error);
          }
        } catch (dedupErr) {
          console.error("WA dedup exception (continuing):", dedupErr);
        }
      }

      const ph = message.from; const mt = message.type; const txt = ""; const inter = null;
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
