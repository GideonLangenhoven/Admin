import { operationalCancellationFollowup } from "../_shared/marketing-outbox.ts";
// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  getBusinessDisplayName,
  resolveBusinessSiteUrls,
  resolveManageBookingsUrl,
  resolveTenantByWhatsappPayload,
  sendWhatsappFreeformOrSignal,
  sendWhatsappTemplate,
  recordWaMessage,
  type TenantContext,
} from "../_shared/tenant.ts";
import { resolveWaiverLink } from "../_shared/waiver.ts";
import { formatDuration } from "../_shared/duration.ts";
import { shouldBotReply } from "../_shared/bot-gate.ts";
import { getSubscriptionState } from "../_shared/subscription.ts";
import { llmText, withinAiQuota } from "../_shared/llm.ts";
import { retrieveKb, retrieveKbContext } from "../_shared/kb.ts";
import { assembleBotSystem, buildBlockB, buildBlockC, cancellationPolicyPrompt } from "../_shared/bot-prompt.ts";
import { hashedUserKey } from "../_shared/openrouter-provider.ts";
import { botReply, type BotOut, type BotUsage } from "../_shared/bot-llm.ts";
import { calculateChatBookingPricing, rands, verifyChatBookingPricing } from "../_shared/chat-booking-pricing.ts";
import { applicableBookingQuestions, captureQuestionFields, validateQuestionAnswers } from "../_shared/booking-custom-fields.ts";
import { genVoucherCode, getPaidPortions } from "../_shared/vouchers.ts";
import { PLATFORM_INVARIANTS } from "../_shared/platform-invariants.ts";
import { formatTourMeetingPoints, gateInbound, gateOutbound, isAvailabilityQuery, MEDIA_FALLBACK_REPLY } from "../_shared/bot-guards.ts";

const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_APP_SECRET = Deno.env.get("WA_APP_SECRET") || "";
const BOOKING_SUCCESS_URL = Deno.env.get("BOOKING_SUCCESS_URL") || "";
const BOOKING_CANCEL_URL = Deno.env.get("BOOKING_CANCEL_URL") || "";
const VOUCHER_SUCCESS_URL = Deno.env.get("VOUCHER_SUCCESS_URL") || "";
const supabase = createServiceClient();

async function requestCheckout(body: Record<string, unknown>) {
  const response = await fetch(SUPABASE_URL + "/functions/v1/create-checkout", {
    method: "POST",
    headers: { Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, skip_notifications: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { error: data?.reason || data?.error || "Payment link unavailable" };
  return data;
}

// ───────── Meta x-hub-signature-256 verification (HMAC-SHA256) ─────────
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
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

// ── Local natural-language date parsing ───────────────────────────────────
// The date step must NEVER depend on an LLM call: when Gemini was down the
// bot rejected every date (including its own suggested "Tomorrow") and
// customers looped forever. Handles the common phrasings locally, in the
// tenant's timezone; Gemini remains a fallback for exotic input only.
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTH_INDEX: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

function tenantTodayKey(tenant: TenantContext): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tenantTimeZone(tenant), year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function tenantDateKey(tenant: TenantContext, iso: any): string {
  // en-CA gives YYYY-MM-DD (same trick as tenantTodayKey)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tenantTimeZone(tenant), year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12)); // noon UTC avoids DST edges
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split("T")[0];
}

function keyFromParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  // reject overflow like 31 Feb
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return dt.toISOString().split("T")[0];
}

function parseLocalDate(tenant: TenantContext, raw: string): string | null {
  const todayKey = tenantTodayKey(tenant);
  const s = String(raw || "").toLowerCase().trim()
    .replace(/[?!.,]+/g, " ")
    .replace(/\b(please|pls|plz|on|the|for|of|we|want|would|like|to|go|book|a|an)\b/g, " ")
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  if (/\btoday\b|\btonight\b|\bnow\b/.test(s)) return todayKey;
  if (/\bday after tomorrow\b|\bovermorrow\b/.test(s)) return addDaysToKey(todayKey, 2);
  if (/\btom+or+ow\b|\btmrw\b|\btomorow\b|\btommorow\b|\btmr\b/.test(s)) return addDaysToKey(todayKey, 1);

  // ISO YYYY-MM-DD
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return keyFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Weekday (optionally "next monday" → the occurrence after the coming one
  // only when today IS that weekday; otherwise the coming occurrence)
  const wd = s.match(/\b(?:next\s+|this\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/);
  if (wd) {
    const target = WEEKDAY_INDEX[wd[1]];
    const [ty, tm, td] = todayKey.split("-").map(Number);
    const todayDow = new Date(Date.UTC(ty, tm - 1, td, 12)).getUTCDay();
    let diff = (target - todayDow + 7) % 7;
    if (diff === 0) diff = 7; // "monday" said on a Monday → next week's
    return addDaysToKey(todayKey, diff);
  }

  const todayYear = Number(todayKey.split("-")[0]);
  const monthNames = Object.keys(MONTH_INDEX).sort((a, b) => b.length - a.length).join("|");

  // "6 july [2026]" / "6 jul"
  let m = s.match(new RegExp("\\b(\\d{1,2})\\s+(" + monthNames + ")(?:\\s+(\\d{4}))?\\b"));
  let day = 0, mon = 0, yr = 0;
  if (m) { day = Number(m[1]); mon = MONTH_INDEX[m[2]]; yr = m[3] ? Number(m[3]) : 0; }
  else {
    // "july 6 [2026]"
    m = s.match(new RegExp("\\b(" + monthNames + ")\\s+(\\d{1,2})(?:\\s+(\\d{4}))?\\b"));
    if (m) { mon = MONTH_INDEX[m[1]]; day = Number(m[2]); yr = m[3] ? Number(m[3]) : 0; }
  }
  if (!m) {
    // numeric "6/7[/2026]" or "06-07" — day/month (ZA convention)
    const n = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (n) {
      day = Number(n[1]); mon = Number(n[2]);
      yr = n[3] ? (n[3].length === 2 ? 2000 + Number(n[3]) : Number(n[3])) : 0;
    }
  }
  if (day && mon) {
    let key = keyFromParts(yr || todayYear, mon, day);
    if (!key) return null;
    // no explicit year and the date already passed → they mean next year
    if (!yr && key < todayKey) key = keyFromParts(todayYear + 1, mon, day);
    return key;
  }

  return null;
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

async function getFaqAnswer(tenant: TenantContext, key: string, query = "") {
  const faqJson = tenant.business.faq_json || {};
  if (faqJson && typeof faqJson === "object" && !Array.isArray(faqJson) && typeof faqJson[key] === "string") {
    return faqJson[key];
  }
  if (key === "cancellation" && String(tenant.business.refund_policy_text || "").trim()) return String(tenant.business.refund_policy_text).trim();
  if (key === "meeting_point") {
    const address = String(tenant.business.meeting_point_address || tenant.business.directions || "").trim();
    const arrival = String(tenant.business.arrival_instructions || "").trim();
    if (address || arrival) {
      const location = address ? "📍 " + address : "";
      return [location, arrival].filter(Boolean).join("\n");
    }
    return formatTourMeetingPoints(await getActiveTours(tenant), query);
  }
  return null;
}

function buildGeminiInstruction(tenant: TenantContext, extraContext?: string) {
  const sections = [
    PLATFORM_INVARIANTS,
    String(tenant.business.ai_system_prompt || "").trim(),
    "Use the tenant FAQ and terminology below. Keep replies short and factual.",
  ];

  const terminologyText = serializeTerminology(tenant.business.terminology);
  if (terminologyText) sections.push("Terminology: " + terminologyText);

  const policy = cancellationPolicyPrompt(tenant.business);
  if (policy) sections.push(policy);

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
  const data = await res.json().catch(() => ({ error: { message: "HTTP " + res.status } }));
  console.log("WA:" + JSON.stringify(data));

  const auditBody = body?.text?.body || body?.interactive?.body?.text || null;

  // Outside the 24 hour window (Meta code 131047): send the reopen template instead.
  // Matching "24" in the message text also caught unrelated errors ("1024 characters").
  if (!res.ok && data.error?.code === 131047) {
    console.log("Outside 24h window, sending template fallback...");
    const templateRes = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + tenant.credentials.waToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: {
          // Set WA_REOPEN_TEMPLATE to an approved WhatsApp template name from
          // Meta Business Suite; hello_world is only a dev fallback.
          name: Deno.env.get("WA_REOPEN_TEMPLATE") || "hello_world",
          language: { code: "en_US" }
        }
      })
    });
    const reopenTemplateName = Deno.env.get("WA_REOPEN_TEMPLATE") || "hello_world";
    const templateData = await templateRes.json().catch(() => ({}));
    await recordWaMessage(tenant.business.id, { to: to, kind: "template", templateName: reopenTemplateName, body: auditBody, status: templateRes.ok ? "SENT" : "FAILED", providerMessageId: templateData?.messages?.[0]?.id || null, error: templateRes.ok ? null : String(templateData?.error?.message || reopenTemplateName + " template failed") });
    return templateData;
  }

  await recordWaMessage(tenant.business.id, { to: to, kind: "text", body: auditBody, status: res.ok ? "SENT" : "FAILED", providerMessageId: data?.messages?.[0]?.id || null, error: res.ok ? null : String(data?.error?.message || "WhatsApp send failed") });

  if (res.ok && auditBody) {
    await supabase.from("chat_messages").insert({ business_id: tenant.business.id, phone: to, direction: "OUT", body: auditBody, sender: "Bot", auto_replied: true });
  }

  return data;
}
async function sendText(tenant: TenantContext, to: any, t: any) { return sendWA(tenant, to, { type: "text", text: { body: t } }); }
// Meta rejects an interactive message that breaks its limits and the guest
// gets nothing, so the helpers enforce them for every caller. Lengths count
// UTF-16 units (the stricter reading) and never split an emoji.
function clip(text: any, max: number) {
  const s = String(text ?? "").trim();
  if (s.length <= max) return s;
  let out = "";
  for (const ch of s) { if (out.length + ch.length > max - 1) break; out += ch; }
  return out.trimEnd() + "\u2026";
}
// An interactive body holds 1024 characters; a longer one goes out as text first.
async function interactiveBody(tenant: TenantContext, to: any, text: any, short: string) {
  if (String(text).length <= 1024) return text;
  await sendText(tenant, to, text);
  return short;
}
async function sendButtons(tenant: TenantContext, to: any, bt: any, btns: any) {
  const body = await interactiveBody(tenant, to, bt, "Choose an option:");
  return sendWA(tenant, to, { type: "interactive", interactive: { type: "button", body: { text: body }, action: { buttons: btns.slice(0, 3).map(function (b: any) { return { type: "reply", reply: { id: b.id, title: clip(b.title, 20) } }; }) } } });
}
async function askBookingWhatsappConsent(tenant: TenantContext, phone: string, repeat = false) {
  const operator = getBusinessDisplayName(tenant.business);
  const prompt = repeat
    ? "Please choose whether you want booking-related WhatsApp updates from " + operator + "."
    : "May " + operator + " send booking-related WhatsApp updates, including how to use My Bookings? No promotions. Reply STOP any time to opt out.";
  return sendButtons(tenant, phone, prompt, [{ id: "WA_UPDATES_YES", title: "Yes, send updates" }, { id: "WA_UPDATES_NO", title: "No thanks" }]);
}
async function sendList(tenant: TenantContext, to: any, bt: any, btnTxt: any, secs: any) {
  const body = await interactiveBody(tenant, to, bt, "Choose from the list:");
  let room = 10; // rows across all sections
  // ponytail: a tenant with more than 10 tours loses the rest from the list; typing the name still works.
  const sections = secs.map(function (sec: any) {
    const rows = sec.rows.slice(0, Math.max(room, 0)); room -= rows.length;
    return { ...(sec.title ? { title: clip(sec.title, 24) } : {}), rows: rows.map(function (r: any) { return { id: r.id, title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}) }; }) };
  }).filter(function (sec: any) { return sec.rows.length > 0; });
  return sendWA(tenant, to, { type: "interactive", interactive: { type: "list", body: { text: body }, action: { button: clip(btnTxt, 20), sections: sections } } });
}
async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function typingDelay() { await delay(800 + Math.floor(Math.random() * 1200)); }
// On the summary, before the guest taps Confirm: a voucher-paid booking completes on that tap.
function waTermsNotice(tenant: TenantContext) {
  const base = String(tenant.business.booking_site_url || "").replace(/\/+$/, "");
  return base ? "\n\nBy completing this booking you accept our Terms & Privacy Policy: " + base + "/terms" : "";
}
// The same screen web chat applies: a reply that quotes the prompt becomes a refusal.
function screenReply(text: string) {
  const out = gateOutbound(text);
  if (out.leakDetected) console.warn("WA_LLM_LEAK:" + out.matches.join(","));
  return out.reply;
}
// Web chat's inbound screen: an injection attempt gets the refusal and never reaches the model.
function injectionRefusal(text: string): string | null {
  const gate = gateInbound(text);
  if (gate.safe) return null;
  console.warn("WA_INJECTION:" + gate.reason);
  return gate.reply || null;
}
async function gemFallback(tenant: TenantContext, msg: string, phone?: any, extraContext?: string): Promise<string | null> {
  const refusal = injectionRefusal(msg);
  if (refusal) return refusal;
  // Ground the answer in the tenant's vector KB (returns "" when nothing relevant)
  const kbCtx = await retrieveKbContext(supabase, tenant.business.id, msg);
  const ctx = [kbCtx, extraContext].filter(Boolean).join("\n\n") || undefined;
  const reply = await llmText({
    system: buildGeminiInstruction(tenant, ctx),
    user: msg,
    maxTokens: 400,
    temperature: 0.2,
    timeoutMs: 8000,
    label: "wa-faq",
    quota: true,
    businessId: tenant.business.id,
    userKey: phone ? await hashedUserKey(tenant.business.id, String(phone)) : undefined,
  });
  return reply ? screenReply(reply) : reply;
}
async function getConvo(tenant: TenantContext, phone: any) {
  const r = await supabase.from("conversations").select().eq("business_id", tenant.business.id).eq("phone", phone).single();
  if (r.data) return r.data;
  const r2 = await supabase.from("conversations").insert({ business_id: tenant.business.id, phone: phone, status: "BOT", current_state: "IDLE", state_data: {} }).select().single();
  return r2.data;
}
async function setConvo(id: any, u: any) { await supabase.from("conversations").update({ ...u, updated_at: new Date().toISOString() }).eq("id", id); }
// Chat self-service for existing bookings (view/reschedule/cancel/change qty/swap tour) is
// retired — bugs there (duplicate sends, lock-ups) led to routing everything through the
// dedicated /my-bookings page instead. Call this instead of entering the old flow states.
async function sendManageBookingsRedirect(tenant: TenantContext, phone: any, convoId: any) {
  const manageUrl = resolveManageBookingsUrl(tenant.business);
  const msg = "To view, reschedule, cancel, or change your booking, please use the *My Bookings* tab on our website" + (manageUrl ? ": " + manageUrl : ".") + "\n\nIt\u2019s the quickest way to manage your booking directly.";
  await sendText(tenant, phone, msg);
  await setConvo(convoId, { current_state: "MENU", state_data: {} });
}
async function logE(tenant: TenantContext, evt: any, p?: any, bid?: any) { await supabase.from("logs").insert({ business_id: tenant.business.id, booking_id: bid, event: evt, payload: p }); }
function fmtTime(tenant: TenantContext, iso: any) { return formatDateTime(tenant, iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }

async function getSlotPrice(slot: any) {
  if (slot.price_per_person_override) return Number(slot.price_per_person_override);
  const t = await supabase.from("tours").select("base_price_per_person").eq("id", slot.tour_id).single();
  // Never quote a made-up price: a failed lookup ends the turn with the retry message.
  const price = Number(t.data?.base_price_per_person);
  if (t.error || !(price > 0)) throw new Error("PRICE_UNAVAILABLE tour=" + slot.tour_id);
  return price;
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
  const r = await supabase.from("tours").select("id, name, description, base_price_per_person, duration_minutes, meeting_point, hidden")
    .eq("business_id", tenant.business.id).eq("active", true).order("sort_order", { ascending: true });
  return (r.data || []).filter(function (t: any) { return !t.name.includes("Private") && !t.hidden; });
}
async function getBookableTours(tenant: TenantContext) {
  // Booking flows only offer tours with at least one open slot in the next 14
  // days — gift vouchers still use getActiveTours (no slot needed to buy one).
  const [tours, slots] = await Promise.all([getActiveTours(tenant), getAvailSlots(tenant, 14)]);
  const withSlots = new Set(slots.map(function (s: any) { return s.tour_id; }));
  return tours.filter(function (t: any) { return withSlots.has(t.id); });
}
// The booking questions for this tour, by the same rules create-checkout validates with.
async function getBookingCustomFields(tenant: TenantContext, tourId: string) {
  const r = await supabase.from("businesses").select("booking_custom_fields").eq("id", tenant.business.id).maybeSingle();
  if (r.error) throw r.error;
  return applicableBookingQuestions(r.data?.booking_custom_fields ?? [], tourId, tenant.business.id);
}
// Choice, date and per-guest questions need the booking form (same rule as web chat).
function needsQuestionForm(questions: any[]) {
  return questions.some(function (q: any) { return q.scope === "participant" || !["text", "textarea", "number"].includes(q.type); });
}
async function sendQuestionFormLink(tenant: TenantContext, phone: any, convoId: string, sd: any) {
  const base = String(tenant.business.booking_site_url || "").replace(/\/+$/, "");
  if (base) await sendText(tenant, phone, "This trip needs a few extra details, which are easiest to fill in on our booking page. Your tour and time are already selected:\n\n" + base + "/book?tour=" + encodeURIComponent(sd.tour_id) + "&slot=" + encodeURIComponent(sd.slot_id));
  else await sendButtons(tenant, phone, "This trip needs a few extra details. Our team can help you finish the booking.", [{ id: "HUMAN", title: "\u{1F4AC} Speak to Our Team" }, { id: "IDLE", title: "\u2B05 Menu" }]);
  await setConvo(convoId, { current_state: "MENU", state_data: {} });
}
function nextCustomField(defs: any[], values: Record<string, unknown>) {
  for (let i = 0; i < (defs || []).length; i++) {
    const field = defs[i];
    if (!field) continue;
    // A skipped optional question is answered; a required one needs a value.
    if (!Object.prototype.hasOwnProperty.call(values || {}, field.key) || (field.required && !String(values?.[field.key] ?? "").trim())) return field;
  }
  return null;
}
function promptForCustomField(field: any) {
  if (!field) return "Please send the next booking detail.";
  return field.label + (field.required ? " *" : " (optional, reply *skip* to leave it out)") + (field.placeholder ? "\n" + field.placeholder : "");
}
async function getLoyaltyCount(tenant: TenantContext, phone: any) {
  try { const r = await supabase.rpc("check_loyalty", { p_phone: phone, p_business_id: tenant.business.id }); return r.data || 0; } catch (e) { return 0; }
}
async function calcDiscount(tenant: TenantContext, qty: any, phone: any) {
  const result = await supabase.rpc("resolve_booking_discount", { p_business_id: tenant.business.id, p_phone: phone, p_qty: Number(qty) });
  if (result.error || !result.data) throw new Error("Could not verify booking discounts");
  return result.data as { type: string; percent: number; label: string };

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
  // WhatsApp sends "27…"; the booking site stores "+27…". Bookings lookups match both.
  const r = await supabase.from("bookings").select("id").in("phone", [phone, "+" + phone]).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED"]).limit(1);
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
  const r = await supabase.from("bookings").select("*, tours(id, name, base_price_per_person)").in("phone", [phone, "+" + phone]).eq("business_id", tenant.business.id).in("status", ["COMPLETED", "PAID"]).order("created_at", { ascending: false }).limit(1).single();
  return r.data;
}

// REVIEW_URL removed — use tenant.business.social_google_reviews (Prompt 23)

// ===== SMART AVAILABILITY =====
function parseTimeRef(tenant: TenantContext, input: string): { start: Date, end: Date, label: string } | null {
  // Every boundary is a wall-clock time in the tenant's timezone.
  const i = input.toLowerCase();
  const todayKey = tenantTodayKey(tenant);
  const at = (key: string, hour: number) => new Date(zonedDateTimeToUtcIso(tenant, key, hour));
  const dow = new Date(todayKey + "T12:00:00Z").getUTCDay();
  if (/\bweekend\b/.test(i)) {
    // On a Saturday or Sunday, "this weekend" is the one under way.
    const sat = addDaysToKey(todayKey, dow === 0 ? -1 : 6 - dow);
    return { start: at(sat, 0), end: at(addDaysToKey(sat, 2), 0), label: "this weekend" };
  }
  if (/\bnext week\b/.test(i)) {
    const mon = addDaysToKey(todayKey, (8 - dow) % 7 || 7);
    return { start: at(mon, 0), end: at(addDaysToKey(mon, 7), 0), label: "next week" };
  }
  let dateKey = /\bthis (morning|afternoon|evening)\b/.test(i) ? todayKey : parseLocalDate(tenant, i);
  const ord = !dateKey && i.match(/\b(\d{1,2})(st|nd|rd|th)\b/);
  if (ord) {
    // "the 21st": this month, or next month once it has passed.
    const [ty, tmo] = todayKey.split("-").map(Number);
    dateKey = keyFromParts(ty, tmo, Number(ord[1]));
    if (dateKey && dateKey < todayKey) dateKey = keyFromParts(tmo === 12 ? ty + 1 : ty, tmo % 12 + 1, Number(ord[1]));
  }
  if (!dateKey) return null;
  let label = dateKey === todayKey ? "today" : dateKey === addDaysToKey(todayKey, 1) ? "tomorrow"
    : formatDateOnly(tenant, at(dateKey, 12), { weekday: "short", day: "numeric", month: "short" });
  let start = at(dateKey, 0); let end = at(addDaysToKey(dateKey, 1), 0);
  if (/\b(morning|early)\b/.test(i)) { start = at(dateKey, 5); end = at(dateKey, 12); label += " morning"; }
  else if (/\bafternoon\b/.test(i)) { start = at(dateKey, 12); end = at(dateKey, 17); label += " afternoon"; }
  else if (/\b(evening|sunset)\b/.test(i)) { start = at(dateKey, 16); end = at(dateKey, 21); label += " evening"; }
  const tm = i.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (tm && Number(tm[1]) >= 1 && Number(tm[1]) <= 12) {
    const hr = Number(tm[1]) % 12 + (tm[2] === "pm" ? 12 : 0);
    start = at(dateKey, hr); end = at(dateKey, hr + 2);
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
    .in("phone", [phone, "+" + phone]).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
    .order("created_at", { ascending: false }).limit(1).single();
  let bkInfo = "";
  if (wBkr.data) {
    const wSlot = (wBkr.data as any).slots;
    const wTour = (wBkr.data as any).tours;
    if (wSlot) {
      bkInfo = "Your *" + (wTour?.name || "tour") + "* is on " + fmtTime(tenant, wSlot.start_time) + ".\n\n";
    }
  }

  // No forecast: the bot can't know each operator's spot or limits, and the go/no-go
  // call is the operator's on the day. The operator's own weather FAQ answer comes first.
  const weatherMsg = (await getFaqAnswer(tenant, "weather")) || "We check conditions before every trip. If the weather means we can\u2019t go out, we\u2019ll message you before your trip to let you know what happens next. Keep your phone nearby \u{1F4F1}";

  await sendText(tenant, phone, bkInfo + weatherMsg);
  await sendButtons(tenant, phone, "Anything else?", [{ id: "ASK", title: "\u2753 Another Question" }, { id: "IDLE", title: "\u2B05 Menu" }]);
  return true;
}

async function handleSmartAvail(tenant: TenantContext, phone: string, input: string): Promise<boolean> {
  const timeRef = parseTimeRef(tenant, input);
  if (!timeRef) return false;

  // No hard slot limits; pull all within the boundaries user asked for
  // Bookings close 60 minutes before departure (same cutoff as the booking flow).
  const from = new Date(Math.max(timeRef.start.getTime(), Date.now() + 60 * 60 * 1000));
  const r = await supabase.from("slots").select("id, start_time, capacity_total, booked, held, tour_id, price_per_person_override, tours(name, base_price_per_person)")
    .eq("business_id", tenant.business.id).eq("status", "OPEN")
    .gte("start_time", from.toISOString())
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
    const pp = (s as any).price_per_person_override ?? tour?.base_price_per_person;
    msg += "   " + fmtTime(tenant, s.start_time) + ", " + avail + (avail === 1 ? " spot" : " spots") + (pp != null ? ", " + rands(pp) + "/pp" : "") + "\n\n";
  }

  if (slots.length > 8) {
    msg += "...and more times. Tap *Book Now* to see them all.\n\nWant to book one of these?";
  } else {
    msg += "Want to book one of these?";
  }
  await sendButtons(tenant, phone, msg, [{ id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "AVAIL", title: "\u{1F4C5} Other Dates" }, { id: "IDLE", title: "\u2B05 Menu" }]);
  return true;
}

function matchFAQ(input: any) {
  const i = input.toLowerCase();
  // Short keywords match whole words only: "rate" isn't in "great", "hen" isn't in "when",
  // "age" isn't in "message", "eft" isn't in "left". Longer stems ("cancel", "swim") stay substrings.
  const wholeWords = new Set(["go", "pin", "map", "age", "rate", "fee", "rand", "deal", "kid", "car", "team", "hen", "pet", "fit", "eat", "rain", "wind", "cost", "park", "wear", "pack", "event", "risk", "eft", "end"]);
  const has = (k: string) => wholeWords.has(k) ? new RegExp("\\b" + k + "(?:s|es|ed|ing|y|er)?\\b").test(i) : i.includes(k);
  // Meeting point
  if (has("where") && (has("meet") || has("go") || has("find") || has("located"))) return "meeting_point";
  if (has("meeting point") || has("location") || has("address") || has("directions") || has("get there")) return "meeting_point";
  if (has("map") || has("pin") || has("gps")) return "meeting_point";
  // What to bring
  if (has("bring") || has("wear") || has("pack") || has("prepare") || has("need to take") || has("what do i need")) return "what_to_bring";
  if (has("clothes") || has("gear") || has("equipment") || has("sunscreen")) return "what_to_bring";
  // Cancellation
  if ((has("cancel") && (has("policy") || has("what if") || has("can i"))) || (has("refund") && !has("my")) || (has("change") && has("mind"))) return "cancellation";
  if (has("money back") || has("get refund")) return "cancellation";
  // Duration
  if (has("how long") || has("duration") || has("how much time") || has("how many hours") || has("how many minutes")) return "duration";
  if (has("what time") && (has("finish") || has("end") || has("done"))) return "duration";
  // Safety
  if (has("safe") || has("danger") || has("risk") || has("drown") || has("scary")) return "safety";
  if (has("swim") || has("experience") && (has("need") || has("require"))) return "safety";
  if (has("beginner") || has("first time") || has("never") && has("before")) return "safety";
  if (has("can't swim") || has("cant swim") || has("nervous")) return "safety";
  // Weather
  if (has("weather") || has("rain") || has("wind") || has("cold") || has("storm")) return "weather";
  if (has("what if") && (has("rain") || has("bad weather") || has("windy"))) return "weather";
  // Pricing
  if (has("price") || has("cost") || has("how much") || has("rate") || has("fee") || has("charge") || has("rand") || has("expensive")) return "pricing";
  if (has("pay") && !has("payment")) return "pricing";
  if (has("discount") || has("special") || has("deal") || has("promo")) return "pricing";
  // Age
  if (has("age") || has("child") || has("kid") || has("baby") || has("toddler") || has("young") || has("old enough")) return "age";
  if (has("family") || has("families") || has("my son") || has("my daughter") || has("my child")) return "age";
  // Parking
  if (has("park") || has("parking") || has("car")) return "parking";
  // Groups
  if (has("group") || has("team") || has("corporate") || has("birthday") || has("party") || has("event") || has("hen") || has("bachelor")) return "groups";
  // What to expect
  if (has("expect") || has("what happens") || has("what is it like") || has("tell me about") || has("describe") || has("what do you do")) return "what_to_expect";
  if (has("itinerary") || has("programme") || (has("schedule") && !has("reschedule")) || has("typical")) return "what_to_expect";
  // Camera / phone
  if (has("camera") || has("gopro") || has("phone") && (has("bring") || has("take") || has("waterproof"))) return "camera";
  if (has("dry bag")) return "camera";
  // Dog / pet
  if (has("dog") || has("pet") || has("animal")) return "dog";
  // Fitness / weight
  if (has("fitness") || has("fit") && has("need") || has("weight") || has("heavy") || has("overweight") || has("disabled") || has("wheelchair") || has("mobility")) return "fitness";
  // Pregnant
  if (has("pregnant") || has("pregnancy") || has("expecting")) return "pregnant";
  // Glasses
  if (has("glasses") || has("spectacles") || has("contact") && has("lens") || has("contacts")) return "glasses";
  // Food / drinks
  if (has("food") || has("eat") || has("drink") || has("hungry") || has("snack") || has("wine") || has("alcohol") || has("bubbly")) return "food";
  // Payment methods
  if (has("cash") || has("eft") || has("transfer") || (has("pay") && (has("how") || has("method") || has("card") || has("international")))) return "payment";
  if (has("deposit") || has("split") && has("pay")) return "payment";
  // Tour differences
  if ((has("difference") || has("compare") || has("which") && has("tour") || has("which one") || has("best tour")) && !has("book")) return "difference";
  // Hours
  if (has("hours") || has("open") || has("operating") || (has("what time") && !has("finish") && !has("end") && !has("my"))) return "hours";
  // Holidays
  if (has("holiday") || has("public holiday") || has("christmas") || has("new year") || has("easter") || has("festive")) return "holidays";
  // Tours overview
  if ((has("what tour") || has("which tour") || has("tour") && has("offer") || has("options") || has("what do you do")) && !has("book")) return "tours_overview";
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

  // Use the LLM for natural language intent classification
  const intentOut = await llmText({
    system: `You are an intent classifier for a tourism activity booking assistant for ${businessName(tenant)}. Read the user's message and reply with EXACTLY ONE of the following keywords based on their intent, or 'UNKNOWN' if it doesn't match any:

BOOK (wants to book a tour)
AVAIL (asking about times, schedule, or availability)
MY_BOOKINGS (wants to manage, view, change, reschedule, or cancel an existing booking)
VOUCHER (wants to buy or redeem a gift voucher)
HUMAN (wants to speak to a human, agent, or team member)
THANKS (saying thank you or goodbye)

Reply ONLY with the keyword, nothing else.`,
    user: input,
    maxTokens: 10,
    temperature: 0.1,
    timeoutMs: 5000,
    reasoning: "off", // one-keyword classifier — thinking would blow the 5s budget
    label: "wa-intent",
    businessId: tenant.business.id,
    userKey: await hashedUserKey(tenant.business.id, String(phone)),
  });
  if (intentOut) {
    const intent = intentOut.trim().toUpperCase();
    if (["BOOK", "AVAIL", "MY_BOOKINGS", "VOUCHER", "HUMAN", "THANKS"].includes(intent)) {
      return intent;
    }
  }

  return null;
}


// ───────── v2 bot brain (three-block cached prompt + JSON contract) ─────────
// Rollout flag WA_BOT_V2 (docs/qa/BOT_V2_ROLLOUT.md):
//   off    → legacy path only
//   shadow → legacy path answers as today; v2 runs after the send, logged to
//            llm_usage, never sent (default while we compare on goldens)
//   on     → v2 answers free-text turns (one message, no trailing buttons);
//            legacy path is the automatic fallback whenever v2 degrades
const WA_BOT_V2 = (Deno.env.get("WA_BOT_V2") || "shadow").toLowerCase();

// Writes to the same llm_usage table _shared/llm.ts meters into (schema from
// 20260803120000, v2 columns from 20260803130000). Best-effort, never throws.
async function logLlmUsage(businessId: string, entry: { label: string; shadow: boolean; usage?: BotUsage | null; out?: BotOut | null; action?: string }) {
  try {
    await supabase.from("llm_usage").insert({
      business_id: businessId,
      fn: entry.label,
      model: entry.usage?.model || "none",
      prompt_tokens: entry.usage?.promptTokens ?? 0,
      completion_tokens: entry.usage?.completionTokens ?? 0,
      cached_tokens: entry.usage?.cachedTokens ?? 0,
      action: entry.action || entry.out?.action || null,
      intent: entry.out?.intent || null,
      grounded: entry.out?.grounded ?? null,
      shadow: entry.shadow,
    });
  } catch (e) { console.error("LLM_USAGE_ERR " + (e instanceof Error ? e.message : String(e))); }
}

async function buildBotSystemForTurn(tenant: TenantContext, phone: string, userText: string): Promise<string> {
  const bizId = tenant.business.id;
  const [tours, kbHits, bkr, slots, cntRes, siteUrls] = await Promise.all([
    getActiveTours(tenant),
    retrieveKb(supabase, bizId, userText),
    supabase.from("bookings").select("id, status, qty, total_amount, slots(start_time), tours(name)")
      .in("phone", [phone, "+" + phone]).eq("business_id", bizId).in("status", ["PAID", "HELD", "CONFIRMED"])
      .order("created_at", { ascending: false }).limit(3),
    getAvailSlots(tenant, 5),
    supabase.from("wa_messages").select("id", { count: "exact", head: true })
      .eq("business_id", bizId).eq("to_phone", String(phone)).eq("status", "SENT")
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    getBusinessSiteUrls(tenant),
  ]);

  const blockB = buildBlockB({
    name: businessName(tenant),
    aiPrompt: tenant.business.ai_system_prompt,
    terminology: tenant.business.terminology,
    faqJson: tenant.business.faq_json,
    refundPolicyTiers: tenant.business.refund_policy_tiers,
    refundPolicyText: tenant.business.refund_policy_text,
    bookingUrl: siteUrls.bookingSiteUrl || null,
    tours: (tours || []).map((t: any) => ({
      name: t.name,
      price: Number(t.base_price_per_person || 0),
      durationMinutes: Number(t.duration_minutes || 0),
      description: t.description,
      meetingPoint: t.meeting_point,
    })),
  });

  const bookings = bkr.data || [];
  const openBookings = bookings.map((b: any) =>
    (b.tours?.name || "Tour") + " on " + (b.slots ? fmtTime(tenant, b.slots.start_time) : "TBC") + " (" + b.qty + " ppl, " + b.status + ")").join("; ");
  const avail = (slots || []).slice(0, 6).map((s: any) =>
    fmtTime(tenant, s.start_time) + " " + (s.tours?.name || "") + " (" + Math.max(0, Number(s.capacity_total || 0) - Number(s.booked || 0) - Number(s.held || 0)) + " spots)").join("\n");

  const nowIso = new Date().toISOString();
  const blockC = buildBlockC({
    nowText: formatDateTime(tenant, nowIso, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    dayName: formatDateTime(tenant, nowIso, { weekday: "long" }),
    windowOpen: true, // we are replying to an inbound message, so the 24h window is open by definition
    outboundCount24h: cntRes.count || 0,
    returning: bookings.length > 0,
    openBookingsSummary: openBookings || null,
    availabilitySummary: avail || null,
    kbHits,
  });

  return assembleBotSystem(blockB, blockC);
}

// Returns true when the turn is fully handled (something sent, or intentionally
// silent). false → caller falls through to the legacy path.
async function botAnswerV2(tenant: TenantContext, phone: any, convo: any, userText: string, mode: "send" | "shadow"): Promise<boolean> {
  try {
    const refusal = injectionRefusal(userText);
    if (refusal) {
      if (mode === "send") await sendText(tenant, phone, refusal);
      return true;
    }
    // The v2 path calls botReply directly, bypassing llmText, so the fair-use
    // ceiling has to be applied here too. Returning false drops the turn to the
    // legacy bot rather than leaving the customer with nothing. Shadow runs are
    // metering, not customer-facing, so they are not capped.
    if (mode === "send" && !(await withinAiQuota(tenant.business.id, "wa-v2"))) return false;

    const system = await buildBotSystemForTurn(tenant, String(phone), userText);
    const label = mode === "shadow" ? "wa-v2-shadow" : "wa-v2";
    const r = await botReply({ system, user: userText, userKey: await hashedUserKey(tenant.business.id, String(phone)), label });
    if (!r) {
      await logLlmUsage(tenant.business.id, { label, shadow: mode === "shadow", action: "parse_fail" });
      return false;
    }
    await logLlmUsage(tenant.business.id, { label, shadow: mode === "shadow", usage: r.usage, out: r.out });
    if (mode === "shadow") return true;

    const out = r.out;
    if (out.message) out.message = screenReply(out.message);
    // HARD RULE: only out.message may ever reach the customer. plan and
    // escalation_reason are internal; a leaked plan is a sev-2.
    switch (out.action) {
      case "silent":
        await setConvo(convo.id, { current_state: "MENU" });
        return true;
      case "escalate": {
        await typingDelay();
        await sendText(tenant, phone, out.message || "Let me get a person on this for you. Our team will reply here shortly.");
        await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
        await logE(tenant, "human_takeover", { phone: phone, reason: out.escalation_reason || "bot_escalate" });
        return true;
      }
      case "flow": {
        await typingDelay();
        if (out.message) await sendText(tenant, phone, out.message);
        if (out.flow_id === "availability_check") {
          const availHandled = await handleSmartAvail(tenant, phone, userText);
          if (availHandled) { await setConvo(convo.id, { current_state: "MENU" }); return true; }
        }
        await handleMsg(tenant, phone, "book", "text"); // existing deterministic booking flow
        return true;
      }
      case "template":
        // ponytail: unreachable while answering an inbound (window is open by
        // definition); the reactive 131047 fallback in sendWA owns real
        // closed-window sends. Log it and stay quiet rather than guess.
        console.error("BOT_V2_UNEXPECTED_TEMPLATE " + tenant.business.id);
        await setConvo(convo.id, { current_state: "MENU" });
        return true;
      case "reply":
      default: {
        if (!out.message) return false;
        await typingDelay();
        // One message, no trailing button prompt (v2 one-message rule).
        await sendText(tenant, phone, out.message);
        await setConvo(convo.id, { current_state: "MENU" });
        return true;
      }
    }
  } catch (e) {
    console.error("BOT_V2_ERR " + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

async function handleMsg(tenant: TenantContext, phone: any, text: any, msgType: any, interactive?: any, quiet = false) {
  try {
    const convo = await getConvo(tenant, phone);
    if (!convo) return;
    // Log incoming message before HUMAN check
    const _rt = (text || "").trim();
    const _ri = (msgType === "interactive" && interactive) ? ((interactive.button_reply && interactive.button_reply.id) || (interactive.list_reply && interactive.list_reply.id) || "") : "";
    let inboundMsgId: string | null = null;
    // internal_proceed is a state-machine token (auto-advance), not a customer
    // message — logging it polluted the inbox thread.
    if (_rt !== "internal_proceed") {
      try {
        const cmRes = await supabase.from("chat_messages").insert({ business_id: convo.business_id || tenant.business.id, phone: phone, direction: "IN", body: _rt || _ri || "[non-text]", sender: convo.customer_name || phone }).select("id").single();
        if (cmRes.error) await logE(tenant, "CHAT_ERROR_RES", cmRes.error);
        else inboundMsgId = cmRes.data?.id || null;
      } catch (e: any) {
        await logE(tenant, "CHAT_ERROR_CATCH", { msg: e.message });
      }
    }

    const input = (text || "").trim().toLowerCase();
    const rawText = (text || "").trim();
    let rid = "";
    if (msgType === "interactive" && interactive) {
      rid = (interactive.button_reply && interactive.button_reply.id) || (interactive.list_reply && interactive.list_reply.id) || "";
    }

    // Marketing opt-out stop words — always processed regardless of conversation state
    const STOP_WORDS = ["stop", "unsubscribe", "opt out"];
    if (STOP_WORDS.includes(input)) {
      // Stop both promotional and booking-related WhatsApp messages.
      const { error: stopError } = await supabase.rpc("stop_optional_whatsapp_messages", {
        p_business_id: tenant.business.id, p_phone: phone,
      });
      if (stopError) console.error("WA_STOP_ERR", tenant.business.id, stopError);
      await sendText(tenant, phone, stopError
        ? "Sorry, we couldn't update your preferences just now. Please send STOP again in a minute."
        : "You've been unsubscribed from optional WhatsApp messages. You'll still receive essential booking confirmations."
      );
      return;
    }

    // Data-deletion keywords (Meta ToS / POPIA) — same always-on path as STOP.
    // Confirm first, then anonymize: chat history is redacted and personal
    // details are wiped from bookings; financial records keep their amounts
    // (5-year tax retention, per the published privacy policy).
    //
    // Anchored and deliberately narrow. The risk is asymmetric: a miss falls
    // through to the bot (which can still hand off to a human), but a false
    // positive destroys a guest's data irreversibly. "delete my booking" is a
    // cancellation and must never reach anonymize_customer — hence the fixed
    // noun list rather than a loose "contains delete" check.
    const DELETE_RE = /^(?:delete|(?:please\s+)?(?:delete|erase|remove)\s+(?:all\s+)?(?:my|our)\s+(?:personal\s+)?(?:data|info|information|details|records))\.?$/;
    if (DELETE_RE.test(input)) {
      await sendText(tenant, phone,
        "Your data deletion request is confirmed. Your messages and personal details will be removed from our records within 30 days. Invoices and payment records are retained for 5 years as required by South African tax law."
      );
      const { error: delErr } = await supabase.rpc("anonymize_customer", {
        p_customer_id: null,
        p_business_id: tenant.business.id,
        p_request_id: null,
        p_admin_id: null,
        p_email: null,
        p_phone: phone,
      });
      if (delErr) {
        await logE(tenant, "DATA_DELETE_ERROR", { phone, msg: delErr.message });
        // The guest was promised removal within 30 days: queue it for the team (Data Requests).
        const { error: queueErr } = await supabase.from("data_subject_requests").insert({
          business_id: tenant.business.id, email: "wa:" + phone, request_type: "DELETION", status: "IN_REVIEW",
          reason: "Requested via WhatsApp DELETE keyword; automatic deletion failed", confirmed_at: new Date().toISOString(),
          metadata: { source: "whatsapp_delete_keyword", phone },
        });
        if (queueErr) console.error("DATA_DELETE_QUEUE_ERR", tenant.business.id, queueErr.message);
      }
      return;
    }

    // ── Drain any queued window-closed follow-ups ───────────────────────────
    // When a sender (weather-cancel/cancel-booking via sendWhatsappWithWindowReopen,
    // admin-reply, broadcast, a failed free-form send) couldn't send because the
    // 24h window was closed, it queued the full message in outbox with
    // status='WAITING_WINDOW' and sent a reopener template. The customer just
    // replied → window is now open → send the queued messages right away using
    // this tenant's own WA credentials. Runs after STOP/DELETE, so an opt-out
    // reply releases nothing.
    try {
      const { data: queuedMsgs } = await supabase
        .from("outbox")
        .select("id, message_body, message_type, booking_id")
        .eq("status", "WAITING_WINDOW")
        .eq("business_id", tenant.business.id)
        .eq("phone", phone)
        // ponytail: a week-old follow-up is stale (trip passed, link expired) and stays held.
        .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
      for (const qm of (queuedMsgs || []) as any[]) {
        const type = String(qm.message_type || "");
        // Only messages whose sender promised delivery on reply; anything else stays held.
        if (!["CANCEL_FOLLOWUP", "ADMIN_FOLLOWUP", "WINDOW_CLOSED_RETRY", "BROADCAST", "BROADCAST_FOLLOWUP"].includes(type)) continue;
        let qb: any = null;
        if (qm.booking_id) {
          const res = await supabase.from("bookings").select("id, business_id, status, whatsapp_booking_updates_opt_in")
            .eq("id", qm.booking_id).eq("business_id", tenant.business.id).maybeSingle();
          if (res.error || !res.data) continue;
          qb = res.data;
        }
        if (type === "CANCEL_FOLLOWUP" && !operationalCancellationFollowup(tenant.business.id, qm, qb)) continue;
        // Departure broadcasts are optional updates: honour a STOP sent since.
        if (type.startsWith("BROADCAST") && !qb?.whatsapp_booking_updates_opt_in) continue;
        // Claim first so two quick replies can't both send it.
        const { data: claimed } = await supabase.from("outbox").update({ status: "SENDING" })
          .eq("id", qm.id).eq("business_id", tenant.business.id).eq("status", "WAITING_WINDOW").select("id");
        if (!claimed?.length) continue;
        const drainRes = await sendWhatsappFreeformOrSignal(tenant, phone, qm.message_body, qm.booking_id);
        await supabase.from("outbox").update(
          drainRes.ok ? { status: "SENT", sent_at: new Date().toISOString(), attempts: 1, error: null }
            // Still closed: wait for the next reply. Otherwise list it under Failed Notifications for a retry.
            : drainRes.windowClosed ? { status: "WAITING_WINDOW", attempts: 1 } : { status: "FAILED", attempts: 1, error: drainRes.error.slice(0, 500) },
        ).eq("id", qm.id).eq("business_id", tenant.business.id);
      }
    } catch (drainQueryErr: any) {
      console.error("OUTBOX_DRAIN_ERR", drainQueryErr?.message || drainQueryErr);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Trading gate ──────────────────────────────────────────────────────────
    // A suspended/paused tenant's storefront is closed and create-checkout
    // rejects payment, so the bot must not engage customers or spend LLM quota.
    // Placed after the DELETE handler (data-deletion stays honored) and before
    // all auto-reply logic. Silent skip: the webhook still returns 200 to Meta.
    const subState = await getSubscriptionState(supabase, tenant.business.id);
    if (!subState.trading) {
      console.warn("WA_BOT_SKIP_NOT_TRADING business=" + tenant.business.id + " status=" + subState.status);
      return;
    }

    // ── Bot mode gate ─────────────────────────────────────────────────────────
    // Check tenant's whatsapp_bot_mode setting. If the bot is disabled (OFF or
    // inside business hours for OUTSIDE_HOURS mode), skip all auto-reply logic.
    // Stop-words (above) and HUMAN-mode routing (below) still work regardless.
    const botGate = await shouldBotReply(supabase, tenant.business.id);
    if (!botGate.active) {
      // Tag the message so analytics can track "would have auto-replied but bot was disabled".
      // PostgREST ignores order/limit on UPDATE, so fetch the latest row's id first —
      // the old chained form stamped EVERY inbound message for this phone.
      try {
        const { data: lastIn } = await supabase.from("chat_messages")
          .select("id")
          .eq("business_id", tenant.business.id)
          .eq("phone", phone)
          .eq("direction", "IN")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastIn?.id) {
          await supabase.from("chat_messages")
            .update({ bot_skipped_reason: botGate.reason })
            .eq("id", lastIn.id).eq("business_id", tenant.business.id);
        }
      } catch { /* non-critical */ }
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Allow "menu"/"start"/"restart" to escape HUMAN mode so the user can always get the bot back
    const isResetKeyword = (input === "menu" || input === "start" || input === "restart" || input === "back" || input === "home" || input === "main menu" || input === "start over");
    if (convo.status === "HUMAN") {
      if (isResetKeyword) {
        await setConvo(convo.id, { status: "BOT", current_state: "IDLE", state_data: {} });
      } else {
        return; // Still in human-handled mode, bot stays silent
      }
    }
    if (quiet) { console.warn("WA_RATE_LIMITED business=" + tenant.business.id); return; }
    // The bot reads text only; the team sees the original in the Inbox.
    if (!["text", "interactive", "button", "image", "document"].includes(msgType)) { await sendText(tenant, phone, MEDIA_FALLBACK_REPLY); return; }

    let state = convo.current_state || "IDLE";
    let sd = convo.state_data || {};
    console.log("S:" + state + " I:" + input + " R:" + rid);

    // Global reset
    if (isResetKeyword) {
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      state = "IDLE"; sd = {};
    }

    // A bare greeting ("hi", "hello there!", "good morning 👋") restarts a flow; mid-booking,
    // "hey, tomorrow?" or "hi, 3 of us" is an answer, not a restart.
    const isGreeting = /^(hi|hello|hey|howzit|hiya|yo|sup|good\s+(morning|afternoon|evening))(\s+(there|all|again|team|guys))?[^\p{L}\p{N}]*$/u.test(input);
    if (isGreeting && state !== "IDLE") {
      await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
      state = "IDLE"; sd = {};
    }

    // Re-check persisted cancellation policy even for old interactive buttons or conversation state.
    const actionBookingId = rid.match(/^(?:BK_|ACT_[A-Z_]+_|WEATHER_REFUND_)([0-9a-f-]{36})$/i)?.[1] || sd.booking_id;
    if (actionBookingId && !isResetKeyword) {
      const managed = await supabase.from("bookings").select("status, cancellation_self_service, cancellation_options")
        .eq("id", actionBookingId).eq("business_id", tenant.business.id).maybeSingle();
      if (managed.error) throw managed.error;
      if (managed.data?.status === "CANCELLED" && managed.data.cancellation_self_service === false) {
        await sendText(tenant, phone, "This cancellation is being handled by our team. Please contact us directly for follow-up.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }
      // A weather cancellation may offer only some outcomes.
      const waOption = /^ACT_RESCH_/.test(rid) ? "RESCHEDULE"
        : /^ACT_VOUCHER_/.test(rid) || state === "CONFIRM_VOUCHER_CONVERT" ? "VOUCHER"
        : /^(ACT_WX_REFUND_|WEATHER_REFUND_)/.test(rid) || state === "CONFIRM_WX_REFUND_ACTION" ? "REFUND" : "";
      if (managed.data?.status === "CANCELLED" && waOption && Array.isArray(managed.data.cancellation_options) && !managed.data.cancellation_options.includes(waOption)) {
        await sendText(tenant, phone, "That option isn’t offered for this cancellation. Type *menu* and open *My Bookings* to see your options.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }
    }

    // Chat self-service for existing bookings is retired (see sendManageBookingsRedirect).
    // A conversation parked in one of its old states, or replaying one of its buttons, goes to My Bookings.
    if (["MY_BOOKINGS_LIST", "BOOKING_ACTIONS", "CANCEL_CHOICE", "CONFIRM_CANCEL_ACTION", "CONFIRM_WX_REFUND_ACTION", "CONFIRM_VOUCHER_CONVERT",
      "EDIT_GUESTS_QTY", "EDIT_GUESTS_EXCESS", "SPECIAL_REQUEST_INPUT", "UPDATE_CONTACT_FIELD", "UPDATE_CONTACT_VALUE", "MODIFY_QTY",
      "CHANGE_TOUR_PICK", "CHANGE_TOUR_SLOT", "SPLIT_PAYMENT_COUNT", "RESCHEDULE_PICK"].includes(state) || sd.is_reschedule || /^(BK_|ACT_|WEATHER_REFUND_)/.test(rid)) {
      await sendManageBookingsRedirect(tenant, phone, convo.id);
      return;
    }

    // A reply to a weather cancellation: the guest settles it in My Bookings, which
    // shows only the options the operator offered and runs them on the server.
    const wxChoices = rid ? [] : ([["RESCHEDULE", /\bresched/], ["VOUCHER", /\bvoucher/], ["REFUND", /\brefund/]] as const)
      .filter(([, re]) => re.test(input)).map(([o]) => o as string);
    if (wxChoices.length && (state === "IDLE" || state === "MENU") && !sd.wx_redirected) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const cb = await supabase.from("bookings").select("cancellation_reason, refund_status, cancellation_self_service, cancellation_options")
        .eq("business_id", tenant.business.id)
        .in("phone", [phone, "+" + phone])
        .eq("status", "CANCELLED")
        .gt("cancelled_at", yesterday)
        .order("cancelled_at", { ascending: false }).limit(1).maybeSingle();

      if (cb.data?.cancellation_reason?.includes("Weather")) {
        if (cb.data.cancellation_self_service === false) {
          await sendText(tenant, phone, "This cancellation is being handled by our team. Please contact us directly for follow-up.");
          await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
          return;
        }
        if (wxChoices.length === 1 && Array.isArray(cb.data.cancellation_options) && !cb.data.cancellation_options.includes(wxChoices[0])) {
          await sendText(tenant, phone, "That option isn’t offered for this cancellation. Type *menu* and open *My Bookings* to see your options.");
          await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
          return;
        }
        // Still waiting for the guest's choice; once settled, this is an ordinary question.
        // Once per conversation, so "voucher" can still mean a gift voucher afterwards.
        if (cb.data.refund_status === "ACTION_REQUIRED") {
          await sendManageBookingsRedirect(tenant, phone, convo.id);
          await setConvo(convo.id, { state_data: { wx_redirected: true } });
          return;
        }
      }
    }

    // POP / Payment Issue Intercept
    let isPaymentIssue = false;
    if (msgType === "document" || msgType === "image") isPaymentIssue = true;
    // Whole words only: "waterproof", "popular" and "can I get a receipt?" are not payment problems.
    if (/\bpop\b|proof of payment|\bpaid it\b|\bjust paid\b/.test(input)) isPaymentIssue = true;
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
        .in("phone", [phone, "+" + phone])
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
      if (!rid && isAvailabilityQuery(input)) {
        const handled = await handleSmartAvail(tenant, phone, input);
        if (handled) { await setConvo(convo.id, { current_state: "MENU" }); return; }
      }

      // Check FAQ
      const faqKey = matchFAQ(input);
      if (faqKey && !rid) {
        const faqAnswer = await getFaqAnswer(tenant, faqKey, input);
        if (faqAnswer) {
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
        // FAQ pattern matched but this tenant hasn't configured that answer.
        // Do NOT dead-end into a silent HUMAN handoff (the bot then ignored
        // everything until "menu" — customers thought it was broken). Fall
        // through: intent routing / menu keywords / gemFallback still get a
        // chance to answer, and the final fallback keeps the bot alive.
      }

      // Check intent (skip if rid already set from button click)
      const intent = rid ? null : await detectIntent(tenant, input, phone);
      if (intent && inboundMsgId) {
        await supabase.from("chat_messages").update({ intent: intent, auto_replied: true }).eq("id", inboundMsgId).eq("business_id", tenant.business.id);
      }
      if (intent === "THANKS" && !rid) {
        if (WA_BOT_V2 === "on") {
          // v2 one-message rule: pure acknowledgements get silence, not a send.
          await setConvo(convo.id, { current_state: "MENU" });
          return;
        }
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

      // BOOK — but never when the customer is talking about an EXISTING booking
      // ("change/cancel/reschedule my booking" used to start a brand-new booking
      // because "booking" contains "book"). Manage-phrases fall through to the
      // MY_BOOKINGS branch below.
      const cManage = /\b(change|resched\w*|cancel\w*|move|edit|manage|update|view)\b/.test(c);
      if (c === "BOOK" || (c.includes("book") && !cManage)) {
        const tours = await getBookableTours(tenant);
        if (tours.length === 0) { await sendText(tenant, phone, "No tours available at the moment. Check back soon!"); await setConvo(convo.id, { current_state: "IDLE" }); return; }
        if (tours.length === 1) {
          await sendText(tenant, phone, "How many people will be joining? (1\u201330)");
          await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { tour_id: tours[0].id } });
        } else {
          const trows: any[] = [];
          for (let ti = 0; ti < tours.length; ti++) {
            const tr = tours[ti];
            trows.push({ id: "TOUR_" + tr.id, title: tr.name, description: rands(tr.base_price_per_person) + "/pp \u2022 " + formatDuration(tr.duration_minutes) });
          }
          await sendText(tenant, phone, "Awesome, let\u2019s get you booked!\n\nWhich tour catches your eye?");
          await sendList(tenant, phone, "We have " + tours.length + " incredible options:", "Choose a Tour", [{ title: "Our Tours", rows: trows }]);
          await setConvo(convo.id, { current_state: "PICK_TOUR", state_data: {} });
        }
      }

      // AVAILABILITY — also catch natural phrasings like "what times do you
      // have", "what's your schedule", "any open slots this week"
      else if (c === "AVAIL" || c.includes("avail") || /\b(times?|schedule|slots?|openings?)\b/.test(c)) {
        const tours2 = await getActiveTours(tenant);
        if (tours2.length <= 1) {
          const slots = await getAvailSlots(tenant, 8);
          if (slots.length === 0) { await sendText(tenant, phone, "Nothing open right now, but check back soon. We add new slots regularly!"); await setConvo(convo.id, { current_state: "IDLE" }); }
          else {
            let msg = "Here\u2019s what\u2019s coming up:\n\n";
            for (let ai = 0; ai < slots.length; ai++) {
              const as2 = slots[ai]; const aav = as2.capacity_total - as2.booked - (as2.held || 0); const apr = await getSlotPrice(as2);
              msg += "\u2022 " + fmtTime(tenant, as2.start_time) + ", " + aav + " spots, " + rands(apr) + "/pp\n";
            }
            await sendButtons(tenant, phone, msg, [{ id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "IDLE", title: "\u2B05 Back" }]);
          }
        } else {
          let availMsg = "Here\u2019s what\u2019s available:\n\n";
          for (let ati = 0; ati < tours2.length; ati++) {
            const at2 = tours2[ati];
            const atSlots = await getAvailSlotsForTour(tenant, at2.id, 3);
            availMsg += "*" + at2.name + "* (" + rands(at2.base_price_per_person) + "/pp)\n";
            if (atSlots.length === 0) { availMsg += "  Fully booked for now\n\n"; }
            else {
              for (let asi = 0; asi < atSlots.length; asi++) {
                const ats = atSlots[asi]; availMsg += "  \u2022 " + fmtTime(tenant, ats.start_time) + ", " + (ats.capacity_total - ats.booked - (ats.held || 0)) + " spots\n";
              }
              availMsg += "\n";
            }
          }
          await sendButtons(tenant, phone, availMsg, [{ id: "BOOK", title: "\u{1F6F6} Book Now" }, { id: "IDLE", title: "\u2B05 Back" }]);
        }
      }

      // MY BOOKINGS / RESCHEDULE / CANCEL
      else if (c === "MY_BOOKINGS" || c === "RESCHEDULE" || c === "CANCEL" || c.includes("my booking") || c.includes("manage") || c.includes("reschedule") || c.includes("cancel") || (cManage && /\bbooking/.test(c))) {
        await sendManageBookingsRedirect(tenant, phone, convo.id);
        return;
      }

      // ASK A QUESTION
      else if (c === "ASK" || c === "ask" || c.includes("question")) {
        await typingDelay();
        await sendText(tenant, phone, "Go ahead, ask me anything! \u{1F60A}\n\nI can answer things like:\n\u2022 \"What should I bring?\"\n\u2022 \"Where do we meet?\"\n\u2022 \"Is it safe for beginners?\"\n\u2022 \"Can I reschedule my booking?\"\n\u2022 \"What\'s available tomorrow?\"\n\nOr ask about your specific booking, I can look it up!");
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
          trows.push({ id: "GV_" + tr.id, title: tr.name, description: rands(tr.base_price_per_person) + " voucher" });
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
        if (WA_BOT_V2 === "on" && await botAnswerV2(tenant, phone, convo, input || rawText, "send")) return;
        await typingDelay();
        const gemReply = await gemFallback(tenant, input || rawText, phone);
        if (gemReply) {
          await sendText(tenant, phone, gemReply);
          await sendButtons(tenant, phone, "Anything else?", [
            { id: "BOOK", title: "\u{1F6F6} Book a Tour" },
            { id: "MORE", title: "\u{1F4AC} More Options" },
          ]);
          if (WA_BOT_V2 === "shadow") await botAnswerV2(tenant, phone, convo, input || rawText, "shadow");
        } else {
          await sendText(tenant, phone, "I\u2019m not quite sure what you mean \u{1F60A} You can ask me things like \"where do we meet\" or \"how much does it cost\". Or pick an option below:");
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
      let tourId = rid ? rid.replace("TOUR_", "") : "";
      // Typed fallback — customers often type the tour name or a number instead
      // of tapping the list (and some WhatsApp clients don't render lists). The
      // rid-only version trapped them in "Please pick a tour from the list above."
      if (!tourId && rawText) {
        const tours = await getBookableTours(tenant);
        const typed = rawText.toLowerCase().trim();
        const num = typed.match(/^(\d{1,2})\.?$/);
        if (num && Number(num[1]) >= 1 && Number(num[1]) <= tours.length) {
          tourId = tours[Number(num[1]) - 1].id;
        } else {
          const matches = tours.filter((tr: any) => {
            const nm = String(tr.name || "").toLowerCase();
            return nm === typed || nm.includes(typed) || typed.includes(nm);
          });
          if (matches.length === 1) tourId = matches[0].id;
        }
        if (!tourId) {
          const tours2 = tours.slice(0, 10);
          let opts = "Which tour would you like? Reply with the name or number:\n\n";
          for (let oi = 0; oi < tours2.length; oi++) opts += (oi + 1) + ". " + tours2[oi].name + "\n";
          await sendText(tenant, phone, opts);
          return;
        }
      }
      if (!tourId) { await sendText(tenant, phone, "Please pick a tour from the list above."); return; }
      const tourInfo = await supabase.from("tours").select("*").eq("id", tourId).eq("business_id", tenant.business.id).eq("active", true).eq("hidden", false).maybeSingle();
      if (!tourInfo.data) { await sendText(tenant, phone, "Hmm, can\u2019t find that tour. Let\u2019s try again."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      const t = tourInfo.data;
      await sendText(tenant, phone, "*" + t.name + "* \u{1F6F6}\n\n" + (t.description ? t.description + "\n\n" : "") + "\u23F1 " + formatDuration(t.duration_minutes) + "\n\u{1F4B0} " + rands(t.base_price_per_person) + " per person\n\nHow many people will be joining?");
      // Keep a redeemed voucher (PICK_TOUR is entered with it when the tenant has several tours).
      await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { ...sd, tour_id: tourId } });
    }

    // ===== FAQ LIST =====
    else if (state === "FAQ_LIST") {
      const faqMap: any = { FAQ_MEET: "meeting_point", FAQ_BRING: "what_to_bring", FAQ_CANCEL: "cancellation", FAQ_DURATION: "duration", FAQ_SAFE: "safety", FAQ_WEATHER: "weather", FAQ_PRICE: "pricing", FAQ_AGE: "age", FAQ_PARKING: "parking", FAQ_EXPECT: "what_to_expect" };
      const key = faqMap[rid];
      const keyAnswer = key ? await getFaqAnswer(tenant, key, input) : null;
      if (key && keyAnswer) {
        await sendText(tenant, phone, keyAnswer);
        await sendText(tenant, phone, "Anything else? Just ask, or:");
        await sendButtons(tenant, phone, "Quick actions:", [{ id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "FAQ_LIST", title: "\u2753 More Questions" }, { id: "IDLE", title: "\u2B05 Main Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
      } else {
        // Try natural language match even in FAQ state
        const fk = matchFAQ(input);
        const fkAnswer = fk ? await getFaqAnswer(tenant, fk, input) : null;
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
      // Accept "We are 2 people" / "2 adults" — extract the first number, not parseInt(raw)
      const qtyMatch = (input || "").match(/\d{1,3}/);
      const qty = qtyMatch ? parseInt(qtyMatch[0], 10) : NaN;
      if (isNaN(qty) || qty < 1 || qty > 30) { await sendText(tenant, phone, "Just need a number between 1 and 30 \u{1F60A}"); return; }

      // Check if there are ANY valid slots left in general (just to catch waitlist cases)
      const tourSlots = sd.tour_id ? await getAvailSlotsForTour(tenant, sd.tour_id, 60) : await getAvailSlots(tenant, 60);
      const fitting = tourSlots.filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) >= qty; });

      if (fitting.length === 0) {
        await sendText(tenant, phone, "Ah, we are fully booked for " + qty + (qty === 1 ? " person" : " people") + " right now. Want me to add you to the waitlist? I\u2019ll message you as soon as a spot opens up!");
        await sendButtons(tenant, phone, "Options:", [{ id: "WAITLIST_YES", title: "\u{1F4CB} Join Waitlist" }, { id: "BOOK", title: "\u{1F6F6} Try Another Tour" }, { id: "IDLE", title: "\u2B05 Back" }]);
        await setConvo(convo.id, { current_state: "WAITLIST_OFFER", state_data: { ...sd, qty: qty } });
        return;
      }

      await typingDelay();
      // Show upcoming dates preview so user doesn't have to guess
      let previewMsg = qty + " " + (qty === 1 ? "person" : "people") + ", nice! \u{1F4C5}\n\nHere\u2019s what\u2019s coming up:\n";
      const dateMap: any = {};
      try {
        let previewQ = supabase.from("slots").select("start_time, capacity_total, booked, held, status, tour_id")
          .eq("business_id", tenant.business.id).gt("start_time", new Date().toISOString())
          .lte("start_time", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
          .order("start_time", { ascending: true });
        // Only count the selected tour's slots — the preview used to count ALL
        // tours, so "1 trip available" could be a different activity entirely.
        if (sd.tour_id) previewQ = previewQ.eq("tour_id", sd.tour_id);
        const previewSlots = await previewQ;
        const pvSlots = previewSlots.data || [];
        // Group by tenant-local date key (chronological via slot ordering)
        const pvDays: any = {};
        for (let pvi = 0; pvi < pvSlots.length; pvi++) {
          const pvs = pvSlots[pvi];
          const pvKey = tenantDateKey(tenant, pvs.start_time);
          if (!pvDays[pvKey]) pvDays[pvKey] = { label: formatDateOnly(tenant, pvs.start_time, { weekday: "short", day: "numeric", month: "short" }), open: 0, closed: 0, full: 0 };
          if (pvs.status !== "OPEN") { pvDays[pvKey].closed++; }
          else if (pvs.capacity_total - pvs.booked - (pvs.held || 0) < qty) { pvDays[pvKey].full++; }
          else { pvDays[pvKey].open++; }
        }
        const pvKeys = Object.keys(pvDays);
        let pvShown = 0;
        // Numbered list + date_map so a customer replying "2" picks option 2
        // (a bare "2" used to fall through to the LLM date extractor, which
        // hallucinated "02 Feb" \u2014 see PICK_DATE bare-number guard).
        for (let pvk = 0; pvk < pvKeys.length && pvShown < 5; pvk++) {
          const pvd = pvDays[pvKeys[pvk]];
          pvShown++;
          dateMap[pvShown] = pvKeys[pvk];
          if (pvd.open > 0) { previewMsg += pvShown + ". " + pvd.label + ": " + pvd.open + " trip" + (pvd.open > 1 ? "s" : "") + " available\n"; }
          else if (pvd.closed > 0 && pvd.open === 0 && pvd.full === 0) { previewMsg += pvShown + ". " + pvd.label + ": \u274C Closed\n"; }
          else { previewMsg += pvShown + ". " + pvd.label + ": Fully booked\n"; }
        }
        if (pvShown > 0) { previewMsg += "\nReply with a number, or type a date (e.g. 'Saturday' or '20 Jul')"; }
        else { previewMsg += "No upcoming trips in the next week. Type any date to check!"; }
      } catch (pvErr) { previewMsg += "\nType a date to see times! (e.g., 'Tomorrow' or '1 September')"; }
      await sendText(tenant, phone, previewMsg);
      await setConvo(convo.id, { current_state: "PICK_DATE", state_data: { ...sd, qty: qty, date_map: dateMap } });
    }

    // ===== PICK DATE (new step) =====
    else if (state === "PICK_DATE") {
      let pickedDate = "";

      // Bare number = pick from the numbered date list (date_map set in ASK_QTY).
      // A bare number must NEVER reach the LLM date extractor: a customer who
      // replied "2" to the list had it hallucinated into "02 Feb".
      const bareNum = rawText ? rawText.trim().match(/^(\d{1,2})\.?$/) : null;
      if (bareNum) {
        const bn = Number(bareNum[1]);
        if (sd.date_map && sd.date_map[bn]) {
          pickedDate = sd.date_map[bn];
        } else {
          await sendText(tenant, phone, "Just to be sure I book the right day, please type the full date. Try 'Tomorrow', a weekday like 'Saturday', or a date like '12 July'.");
          return;
        }
      }

      // Local parsing FIRST — the bot must understand "tomorrow"/"monday"/"6 july"
      // even when the LLM is down (a silent Gemini outage used to reject every
      // date and trap customers in a loop here).
      if (!pickedDate && rawText) {
        pickedDate = parseLocalDate(tenant, rawText) || "";
      }

      // LLM fallback for exotic phrasing only
      if (!pickedDate && rawText) {
        const dateOut = await llmText({
          system: `You are a date extractor. The user is asking for a date. Today is ${tenantTodayKey(tenant)}. Return exactly one YYYY-MM-DD date string based on their input, or "INVALID" if no date is found. Examples: "Tomorrow" -> next date. "1 September" -> 2026-09-01.`,
          user: rawText,
          maxTokens: 15,
          temperature: 0.1,
          timeoutMs: 5000,
          reasoning: "off", // date extractor — thinking would blow the 5s budget
          label: "wa-date",
          businessId: tenant.business.id,
          userKey: await hashedUserKey(tenant.business.id, String(phone)),
        });
        if (dateOut) {
          const extracted = dateOut.trim();
          if (extracted !== "INVALID" && extracted.match(/^\d{4}-\d{2}-\d{2}$/)) pickedDate = extracted;
        }
      }

      if (!pickedDate) {
        await sendText(tenant, phone, "Sorry, I didn't catch that date. Try 'Tomorrow', a weekday like 'Saturday', or a date like '12 July'.");
        return;
      }

      // Sanity guard: the LLM fallback (and explicit typed years) can produce
      // past or absurdly distant dates. Catch them here instead of replying
      // "no trips scheduled for 02 Feb".
      const pdTodayKey = tenantTodayKey(tenant);
      if (pickedDate < pdTodayKey) {
        await sendText(tenant, phone, "That date has already passed. Try 'Tomorrow', a weekday like 'Saturday', or a date like '12 July'.");
        return;
      }
      if (pickedDate > addDaysToKey(pdTodayKey, 365)) {
        await sendText(tenant, phone, "We can only take bookings up to a year ahead. Try a closer date!");
        return;
      }

      // Convert the picked local date into a UTC range using the tenant timezone.
      const startIso = zonedDateTimeToUtcIso(tenant, pickedDate, 0, 0);
      const endIso = zonedDateTimeToUtcIso(tenant, pickedDate, 24, 0);

      let slotQ = supabase.from("slots").select("id, start_time, capacity_total, booked, held, status, is_peak, price_per_person_override, tour_id, tours(name, base_price_per_person)")
        .eq("business_id", tenant.business.id)
        .gte("start_time", startIso)
        .lt("start_time", endIso)
        .order("start_time", { ascending: true });

      // Only offer the tour the customer picked.
      if (sd.tour_id) slotQ = slotQ.eq("tour_id", sd.tour_id);

      const { data: dbSlots } = await slotQ;

      const pdFormatted = formatDateOnly(tenant, zonedDateTimeToUtcIso(tenant, pickedDate, 12, 0), { weekday: "long", day: "numeric", month: "short" });

      if (!dbSlots || dbSlots.length === 0) {
        await sendText(tenant, phone, "We don\u2019t have any trips scheduled for " + pdFormatted + " yet. Try a date in the next 2 weeks! \u{1F4C5}");
        return;
      }

      const openSlots = [];
      let allClosed = true;
      let hasOpenButFull = false;
      let hasCutoffOnly = false;

      const bookingCutoffMs = Date.now() + 60 * 60 * 1000;
      for (const ts of dbSlots) {
        if (ts.status === "OPEN") {
          allClosed = false;
          // Don't offer slots the customer can no longer book (60-min cutoff) —
          // showing them and rejecting the pick afterwards trapped people in a loop.
          if (new Date(ts.start_time).getTime() < bookingCutoffMs) {
            hasCutoffOnly = true;
            continue;
          }
          const t_avail = ts.capacity_total - ts.booked - (ts.held || 0);
          if (t_avail >= sd.qty) {
            openSlots.push(ts);
          } else {
            hasOpenButFull = true;
          }
        }
      }

      if (allClosed) {
        await sendText(tenant, phone, "\u26C5 Unfortunately *" + pdFormatted + "* is closed due to bad weather. Please choose another date. Type a new date to try again!");
        return;
      }

      if (openSlots.length === 0) {
        if (hasCutoffOnly && !hasOpenButFull) {
          await sendText(tenant, phone, "The remaining trips on *" + pdFormatted + "* have already closed for booking (bookings close 60 minutes before the start time). Try another date! \u{1F4C5}");
          return;
        }
        if (hasOpenButFull) {
          await sendText(tenant, phone, "All trips on *" + pdFormatted + "* are fully booked for " + sd.qty + (sd.qty === 1 ? " person" : " people") + ". Try another date or a smaller group! \u{1F4C5}");
        } else {
          await sendText(tenant, phone, "No available trips on *" + pdFormatted + "*. Try another date! \u{1F4C5}");
        }
        return;
      }

      // Multiple or 1 slot — show time picker via numbered text menu (cap at 10)
      const maxDisplay = 10;
      let timeTxt = pdFormatted + ", pick a time (reply with a number):\n\n";
      const slotMap: any = {};
      const displayCount = Math.min(openSlots.length, maxDisplay);
      for (let ti = 0; ti < displayCount; ti++) {
        const os = openSlots[ti];
        const oavl = os.capacity_total - os.booked - (os.held || 0);
        // PostgREST types embedded many-to-one relations as arrays; runtime is an object
        const osTour: any = Array.isArray(os.tours) ? os.tours[0] : os.tours;
        const opri = os.price_per_person_override || osTour?.base_price_per_person;
        const otime = formatTimeOnly(tenant, os.start_time, { hour: "2-digit", minute: "2-digit" });
        const tName = osTour?.name ? osTour.name + " \u2022 " : "";
        timeTxt += (ti + 1) + ". " + tName + otime + " (" + oavl + " spots" + (opri ? ", " + rands(opri) + "/pp" : "") + ")\n";
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
      if (!slotId) {
        // Forgive a typed date here (customers often answer the time list with
        // a new date) — redispatch to PICK_DATE instead of trapping them.
        const psDate = rawText ? parseLocalDate(tenant, rawText) : null;
        if (psDate) { await setConvo(convo.id, { current_state: "PICK_DATE" }); await handleMsg(tenant, phone, rawText, "text"); return; }
        await sendText(tenant, phone, "Please reply with a number from the list, or type a different date.");
        return;
      }
      const sr2 = await supabase.from("slots").select("*").eq("id", slotId).single();
      const slot = sr2.data;
      if (!slot) { await sendText(tenant, phone, "That slot is no longer available. Let\u2019s pick another date. Type a date to try again!"); await setConvo(convo.id, { current_state: "PICK_DATE" }); return; }
      if (slot.status !== "OPEN") { await sendText(tenant, phone, "That trip is no longer open for booking. Let\u2019s pick another date. Type a new date!"); await setConvo(convo.id, { current_state: "PICK_DATE" }); return; }
      // M5: 60-min cutoff check at slot selection
      const slotStartMs = new Date(slot.start_time).getTime();
      if (slotStartMs - Date.now() < 60 * 60 * 1000) { await sendText(tenant, phone, "Sorry, bookings close 60 minutes before the trip starts. Please pick a later time from the list (reply with its number), or type *menu* to start over."); return; }
      const slotAvailRes = await supabase.rpc("slot_available_capacity", { p_slot_id: slotId });
      const slotAvail = Number(slotAvailRes.data || 0);
      // Stay in PICK_SLOT: "another option from the list" must keep working
      // (this used to reset to PICK_DATE, so replying "3" hit the date parser).
      if (slotAvail < sd.qty) { await sendText(tenant, phone, "Not enough spots left on that trip for " + sd.qty + (sd.qty === 1 ? " person" : " people") + " (only " + slotAvail + " left). Try another option from the list or type a new date!"); return; }

      const price = await getSlotPrice(slot);
      const baseTotal = Math.round(price * Number(sd.qty) * 100) / 100;
      const disc = await calcDiscount(tenant, sd.qty, phone);
      let finalTotal = baseTotal; let discountMsg = "";
      if (disc.percent > 0) {
        const priced = calculateChatBookingPricing({ qty: Number(sd.qty), unitPrice: price, groupDiscountPercent: disc.percent, groupDiscountMinQty: 1 });
        const saving = priced.discount; finalTotal = priced.total;
        discountMsg = "\n*" + disc.percent + "% " + disc.label + " applied!* You save " + rands(saving);
      }
      // A voucher, free trips included, is credit up to its balance for any group size.
      let voucherDeduction = 0;
      if (sd.voucher_id) {
        voucherDeduction = Math.min(Number(sd.voucher_value || 0), finalTotal);
        finalTotal = Math.max(0, finalTotal - voucherDeduction);
        if (finalTotal === 0) {
          discountMsg = "\n\u{1F39F} *Voucher applied, this trip is on us!*";
        } else {
          discountMsg = "\n\u{1F39F} *Voucher applied: " + rands(voucherDeduction) + " off!*";
        }
      }
      const tourName2 = await supabase.from("tours").select("name").eq("id", slot.tour_id).single();
      let summary = "Here\u2019s your booking summary:\n\n\u{1F6F6} *" + (tourName2.data?.name || "Tour") + "*\n\u{1F4C5} " + fmtTime(tenant, slot.start_time) + "\n\u{1F465} " + sd.qty + " " + (sd.qty === 1 ? "person" : "people") + "\n\u{1F4B0} " + rands(price) + " \u00D7 " + sd.qty + " = " + rands(baseTotal);
      if (sd.voucher_id && finalTotal === 0) summary += discountMsg + "\n*Total: FREE*";
      else if (sd.voucher_id && finalTotal > 0) summary += discountMsg + "\n*Remaining: " + rands(finalTotal) + "*";
      else if (disc.percent > 0) summary += discountMsg + "\n*Total: " + rands(finalTotal) + "*";
      else summary += "\n*Total: " + rands(finalTotal) + "*";
      summary += waTermsNotice(tenant) + "\n\nLook good?";
      const confirmBtns = [{ id: "CONFIRM", title: finalTotal > 0 ? "\u2705 Pay " + rands(finalTotal) : "\u2705 Confirm (FREE)" }, { id: "IDLE", title: "\u274C Cancel" }];
      if (finalTotal > 0) confirmBtns.splice(1, 0, { id: "ADD_VOUCHER", title: "\u{1F39F} Add Voucher" });
      await sendButtons(tenant, phone, summary, confirmBtns);
      await setConvo(convo.id, { current_state: "CONFIRM_BOOKING", state_data: { ...sd, slot_id: slotId, tour_id: slot.tour_id, unit_price: price, base_total: baseTotal, total: finalTotal, discount_type: disc.type, discount_percent: disc.percent, voucher_deduction: voucherDeduction || 0 } });
    }

    // ===== CONFIRM BOOKING =====
    else if (state === "CONFIRM_BOOKING") {
      if (rid === "IDLE" || /^(no|nope|cancel)\b/.test(input)) { await sendText(tenant, phone, "No worries, cancelled! Type *menu* whenever you\u2019re ready."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      if (rid === "ADD_VOUCHER") {
        await sendText(tenant, phone, "Enter your voucher code:");
        await setConvo(convo.id, { current_state: "ADD_EXTRA_VOUCHER" });
        return;
      }
      if (rid === "CONFIRM" || /^(y|yes|yep|yeah|ok|okay|sure|confirm|pay)\b/.test(input)) {
        // Details already collected (e.g. re-confirm after a price update) —
        // go straight to finalize instead of asking for name/email again.
        if (sd.customer_name && sd.email) {
          if (typeof sd.whatsapp_booking_updates_opt_in !== "boolean") {
            await setConvo(convo.id, { current_state: "ASK_WHATSAPP_UPDATES", state_data: sd });
            await askBookingWhatsappConsent(tenant, phone);
          } else {
            await setConvo(convo.id, { current_state: "FINALIZE_BOOKING", state_data: sd });
            await handleMsg(tenant, phone, "internal_proceed", "text", null);
          }
          return;
        }
        await typingDelay();
        await sendText(tenant, phone, "Brilliant! Just need a couple of details to lock it in.\n\nPlease reply with your:\n- Full Name\n- Email Address\n\n*(You can just send them together in one message!)*");
        await setConvo(convo.id, { current_state: "ASK_DETAILS", state_data: sd });
        return;
      }
      await sendText(tenant, phone, "Reply *yes* to continue, or *no* to cancel.");
    }

    // ===== ASK DETAILS (also handles ASK_NAME_EMAIL) =====
    else if (state === "ASK_DETAILS" || state === "ASK_NAME_EMAIL") {
      const dParts = rawText.split(/[,;\n]+/).map(function (p: string) { return p.trim(); }).filter(function (p: string) { return p.length > 0; });
      // Restore any partial data saved from a previous message in this state
      let dName = sd.partial_name || "";
      let dEmail = sd.partial_email || "";
      for (const dp of dParts) {
        const dc = dp.replace(/^(name|email)[:\-\s]*/i, "").trim();
        if (!dc) continue;
        // Extract the email, then treat the REMAINDER of the same part as the
        // name — "Gideon Langenhoven gids@gmail.com" in one message used to
        // capture only the email and re-ask for the name.
        const emailMatch = dc.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
        if (emailMatch) {
          if (!dEmail) dEmail = emailMatch[0].toLowerCase();
          const rest = dc.replace(emailMatch[0], "").replace(/[<>()\[\]"',;]/g, " ").replace(/\s+/g, " ").trim();
          if (rest && !dName && /\p{L}{2,}/u.test(rest) && !rest.includes("?") && rest.split(" ").length <= 5) dName = rest;
        } else if (/\p{L}/u.test(dc) && !dName && !dc.includes("?") && dc.split(/\s+/).length <= 5) {
          // Question-looking or essay-length text is not a name — re-prompt instead
          // of saving "do you provide wetsuits?" as the customer's name.
          dName = dc;
        }
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
      const customDefs = await getBookingCustomFields(tenant, sd.tour_id);
      if (needsQuestionForm(customDefs)) { await sendQuestionFormLink(tenant, phone, convo.id, sd); return; }
      if (customDefs.length > 0) {
        await setConvo(convo.id, { current_state: "ASK_CUSTOM_FIELDS", state_data: { ...sd, customer_name: dName, email: dEmail, custom_field_defs: customDefs, custom_fields: {}, partial_name: undefined, partial_email: undefined } });
        await typingDelay();
        await sendText(tenant, phone, "Almost done.\n\n" + promptForCustomField(customDefs[0]));
        return;
      }
      await setConvo(convo.id, { current_state: "ASK_WHATSAPP_UPDATES", state_data: { ...sd, customer_name: dName, email: dEmail, partial_name: undefined, partial_email: undefined } });
      await typingDelay();
      await askBookingWhatsappConsent(tenant, phone);
    }

    else if (state === "ASK_CUSTOM_FIELDS") {
      const defs = Array.isArray(sd.custom_field_defs) ? sd.custom_field_defs : [];
      const values = { ...(sd.custom_fields || {}) };
      const currentField = nextCustomField(defs, values);
      if (!currentField) {
        await setConvo(convo.id, { current_state: "ASK_WHATSAPP_UPDATES", state_data: { ...sd, custom_fields: values } });
        await typingDelay();
        await askBookingWhatsappConsent(tenant, phone);
        return;
      }

      const fieldValue = /^(?:skip|prefer not to say)[.!]*$/i.test(rawText.trim()) ? "" : rawText.trim();
      if (!fieldValue && currentField.required) {
        await sendText(tenant, phone, "I still need this before I can lock in the booking:\n\n" + promptForCustomField(currentField));
        return;
      }
      const checked = validateQuestionAnswers([currentField], { [currentField.key]: fieldValue }, Number(sd.qty));
      if (checked.errors.length) { await sendText(tenant, phone, checked.errors[0].message + "\n\n" + promptForCustomField(currentField)); return; }

      values[currentField.key] = checked.answers[currentField.key];
      const upcomingField = nextCustomField(defs, values);
      if (upcomingField) {
        await setConvo(convo.id, { state_data: { ...sd, custom_fields: values } });
        await sendText(tenant, phone, "Got it.\n\n" + promptForCustomField(upcomingField));
        return;
      }

      await setConvo(convo.id, { current_state: "ASK_WHATSAPP_UPDATES", state_data: { ...sd, custom_fields: values } });
      await typingDelay();
      await askBookingWhatsappConsent(tenant, phone);
      return;
    }

    else if (state === "ASK_WHATSAPP_UPDATES") {
      const consent = rid === "WA_UPDATES_YES" || ["yes", "y"].includes(input) ? true
        : rid === "WA_UPDATES_NO" || ["no", "n"].includes(input) ? false : null;
      if (consent === null) {
        await askBookingWhatsappConsent(tenant, phone, true);
        return;
      }
      await setConvo(convo.id, { current_state: "FINALIZE_BOOKING", state_data: { ...sd, whatsapp_booking_updates_opt_in: consent } });
      await handleMsg(tenant, phone, "internal_proceed", "text", null);
      return;
    }

    // ===== FINALIZE BOOKING =====
    else if (state === "FINALIZE_BOOKING") {
      // M5: Final 60-min cutoff check before creating the booking
      const finalSlotCheck = await supabase.from("slots").select("id,start_time,status,tour_id,price_per_person_override,business_id").eq("id", sd.slot_id).eq("business_id", tenant.business.id).single();
      if (finalSlotCheck.data && new Date(finalSlotCheck.data.start_time).getTime() - Date.now() < 60 * 60 * 1000) {
        await sendText(tenant, phone, "Sorry, bookings close 60 minutes before the trip starts. This slot is no longer available. Please type *menu* to start a new booking.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }
      if (!finalSlotCheck.data || finalSlotCheck.data.status !== "OPEN" || (sd.tour_id && finalSlotCheck.data.tour_id !== sd.tour_id)) {
        await sendText(tenant, phone, "I couldn't verify that tour and time anymore. Please type *book* to start again with the latest options.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }
      const finalTourCheck = await supabase.from("tours").select("id,base_price_per_person").eq("id", finalSlotCheck.data.tour_id).eq("business_id", tenant.business.id).single();
      const finalUnitPrice = finalSlotCheck.data.price_per_person_override != null
        ? Number(finalSlotCheck.data.price_per_person_override)
        : Number(finalTourCheck.data?.base_price_per_person || 0);
      const finalDiscount = await calcDiscount(tenant, Number(sd.qty || 0), phone);
      const finalPriceCheck = verifyChatBookingPricing({
        quotedTotal: Number(sd.total || 0),
        tolerance: 0.005,
        qty: Number(sd.qty || 0),
        unitPrice: finalUnitPrice,
        voucherDeduction: sd.voucher_id ? Number(sd.voucher_deduction || 0) : 0,
        groupDiscountPercent: finalDiscount.percent,
        groupDiscountMinQty: 1,
      });
      if (!finalPriceCheck.ok && finalPriceCheck.reason !== "PRICE_CHANGED") {
        await sendText(tenant, phone, "I couldn't verify the price for that trip, so I won't create the booking yet. Please type *book* to start again.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }
      if (!finalPriceCheck.ok && finalPriceCheck.reason === "PRICE_CHANGED" && finalPriceCheck.pricing) {
        const fp = finalPriceCheck.pricing;
        await sendButtons(tenant, phone, "The price has changed since we started. The correct total is *" + rands(fp.total) + "*.\n\nPlease confirm again.", [{ id: "CONFIRM", title: fp.total > 0 ? "\u2705 Pay " + rands(fp.total) : "\u2705 Confirm (FREE)" }, { id: "IDLE", title: "\u274C Cancel" }]);
        await setConvo(convo.id, {
          current_state: "CONFIRM_BOOKING",
          state_data: { ...sd, discount_type: finalDiscount.type, discount_percent: finalDiscount.percent, tour_id: finalSlotCheck.data.tour_id, unit_price: fp.unitPrice, base_total: fp.baseTotal, total: fp.total, voucher_deduction: fp.voucherDeduction },
        });
        return;
      }
      if (!finalPriceCheck.pricing) {
        await sendText(tenant, phone, "I couldn't verify the price for that trip, so I won't create the booking yet. Please type *book* to start again.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }
      const verifiedPricing = finalPriceCheck.pricing;
      const verifiedSd = {
        ...sd,
        discount_type: finalDiscount.type,
        discount_percent: finalDiscount.percent,
        tour_id: finalSlotCheck.data.tour_id,
        unit_price: verifiedPricing.unitPrice,
        base_total: verifiedPricing.baseTotal,
        total: verifiedPricing.total,
        voucher_deduction: verifiedPricing.voucherDeduction,
      };
      // Re-check the answers against the tour's current questions, as create-checkout will.
      const questions = await getBookingCustomFields(tenant, verifiedSd.tour_id);
      if (needsQuestionForm(questions)) { await sendQuestionFormLink(tenant, phone, convo.id, verifiedSd); return; }
      const answers = validateQuestionAnswers(questions, sd.custom_fields || {}, Number(verifiedSd.qty));
      if (answers.errors.length) {
        const kept: Record<string, unknown> = { ...answers.answers };
        for (const qe of answers.errors) delete kept[qe.key];
        await setConvo(convo.id, { current_state: "ASK_CUSTOM_FIELDS", state_data: { ...verifiedSd, custom_field_defs: questions, custom_fields: kept } });
        await sendText(tenant, phone, "Please complete the trip details first.\n\n" + promptForCustomField(nextCustomField(questions, kept)));
        return;
      }
      const email = sd.email;
      const br2 = await supabase.from("bookings").insert({
        business_id: tenant.business.id, tour_id: verifiedSd.tour_id, slot_id: verifiedSd.slot_id,
        customer_name: sd.customer_name, phone: phone, email: email,
        qty: verifiedSd.qty, unit_price: verifiedSd.unit_price, total_amount: verifiedSd.total,
        original_total: verifiedSd.base_total, discount_type: verifiedSd.discount_percent > 0 ? "PERCENT" : null, discount_percent: verifiedSd.discount_percent || 0,
        discount_amount: verifiedPricing.discount,
        discount_notes: verifiedSd.discount_percent > 0 ? finalDiscount.label : null,
        voucher_amount_paid: Number(verifiedSd.voucher_deduction || 0),
        status: "PENDING", source: "WHATSAPP", custom_fields: questions.length ? captureQuestionFields(questions, answers.answers, tenant.business.id, verifiedSd.tour_id) : {},
        marketing_opt_in: null, whatsapp_booking_updates_opt_in: sd.whatsapp_booking_updates_opt_in === true,
        total_captured: 0, total_refunded: 0,
        terms_accepted_at: new Date().toISOString(),
      }).select().single();
      if (br2.error || !br2.data) { console.error("Err:", JSON.stringify(br2.error)); await sendText(tenant, phone, "Something went wrong. Let me connect you to our team."); await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" }); return; }
      const booking = br2.data;
      // Tacit Terms acceptance for conversational checkout: the timestamp above
      // records consent; this notice (sent with the confirmation/payment step)
      // is the displayed evidence that the customer was told before paying.
      const termsNotice = waTermsNotice(tenant);

      // VOUCHER BOOKING — skip payment
      if (verifiedSd.voucher_id && verifiedSd.total <= 0) {
        // Funding, capacity and confirmation commit together. A stale voucher
        // must not leave a PAID booking or a partially drained voucher stack.
        const voucherConfirmation = await supabase.rpc("confirm_voucher_booking", {
          p_booking_id: booking.id,
          p_voucher_ids: verifiedSd.voucher_ids || [verifiedSd.voucher_id],
        });
        if (voucherConfirmation.error || !voucherConfirmation.data?.ok) {
          // A transport error can arrive after the transaction committed: only an unconfirmed booking is removed.
          const saved = await supabase.from("bookings").select("status").eq("id", booking.id).eq("business_id", tenant.business.id).maybeSingle();
          if (saved.error) throw saved.error;
          if (!["PAID", "CONFIRMED", "COMPLETED"].includes(saved.data?.status)) {
            const cleanup = await supabase.from("bookings").delete().eq("id", booking.id).eq("business_id", tenant.business.id).eq("status", "PENDING");
            if (cleanup.error) await logE(tenant, "VOUCHER_BOOKING_CLEANUP_ERR", { booking_id: booking.id, msg: cleanup.error.message }, booking.id);
            await sendText(tenant, phone, "We couldn't confirm that booking. The voucher balance or available spots may have changed. Please try again or contact our team.");
            await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
            return;
          }
        }
        for (const remainder of voucherConfirmation.data?.remainders || []) {
          try { await sendText(tenant, phone, "\u{1F39F} Your voucher *" + remainder.code + "* has *" + rands(remainder.remaining) + "* remaining. Use it on your next booking!"); } catch (e) { }
        }
        const vref = booking.id.substring(0, 8).toUpperCase();
        const vslot = await supabase.from("slots").select("start_time").eq("id", verifiedSd.slot_id).single();
        const vtour = await supabase.from("tours").select("name").eq("id", verifiedSd.tour_id).single();
        const waiverLink = resolveWaiverLink(tenant.business, booking.id, (booking as any).waiver_token);
        await logE(tenant, "voucher_booking_confirmed", { booking_id: booking.id, voucher_code: verifiedSd.voucher_code }, booking.id);
        // Upsell second trip
        const upsellTour = (await getBookableTours(tenant)).find(function (t: any) { return t.id !== verifiedSd.tour_id; });
        await sendText(tenant, phone,
          "\u{1F389} *You\u2019re all set!*\n\n" +
          "\u{1F4CB} Ref: " + vref + "\n" +
          "\u{1F6F6} " + (vtour.data?.name || "Tour") + "\n" +
          "\u{1F4C5} " + (vslot.data ? fmtTime(tenant, vslot.data.start_time) : "TBC") + "\n" +
          "\u{1F465} " + verifiedSd.qty + (verifiedSd.qty === 1 ? " person" : " people") + "\n" +
          "\u{1F39F} Paid with voucher *" + verifiedSd.voucher_code + "*\n\n" +
          (waiverLink ? "\u{1F4DD} Waiver: " + waiverLink + "\n\n" : "") +
          "\u{1F4CD} *Meeting Point:* " + (tenant.business.directions || "Check your confirmation details from " + businessName(tenant) + " for arrival instructions.") + "\n\n" +
          ((tenant.business as any).what_to_bring ? "\u{1F392} *Bring:* " + (tenant.business as any).what_to_bring + "\n\n" : "") +
          (tenant.business.location_phrase ? "See you " + tenant.business.location_phrase + "!" : "See you soon!") +
          termsNotice
        );
        // Send confirmation email
        try {
          await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({ type: "BOOKING_CONFIRM", data: { booking_id: booking.id, business_id: tenant.business.id, email: email, customer_name: sd.customer_name, ref: vref, tour_name: vtour.data?.name || "Tour", start_time: vslot.data ? fmtTime(tenant, vslot.data.start_time) : "TBC", qty: verifiedSd.qty, total_amount: "FREE (voucher)" } }),
          });
        } catch (e) { }
        await setConvo(convo.id, { current_state: "IDLE", state_data: {}, last_booking_id: booking.id, customer_name: sd.customer_name, email: email });
        // Sent here, after the confirmation: a 5s timer could fire after the function had finished, or first.
        if (upsellTour) {
          try { await typingDelay(); await sendText(tenant, phone, "\u{1F4A1} Psst! How about adding a *" + upsellTour.name + "* to your trip?\n\nJust type *book* to add another tour."); }
          catch (e) { console.error("UPSELL_SEND_ERR", e); }
        }
        return;
      }

      // PAID BOOKING — atomic capacity check + hold creation to prevent overbooking
      const holdRes = await supabase.rpc("create_hold_with_capacity_check", {
        p_booking_id: booking.id,
        p_slot_id: verifiedSd.slot_id,
        p_qty: verifiedSd.qty,
        p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      if (holdRes.error || !holdRes.data?.success) { await supabase.from("bookings").delete().eq("id", booking.id).eq("business_id", tenant.business.id); await sendText(tenant, phone, holdRes.data?.error || "Sorry, those spots were just taken! Please try another time slot."); await setConvo(convo.id, { current_state: "IDLE", state_data: {} }); return; }
      await supabase.from("bookings").update({ status: "HELD" }).eq("id", booking.id).eq("business_id", tenant.business.id);
      await logE(tenant, "hold_created", { booking_id: booking.id }, booking.id);

      const yocoData = await requestCheckout({
        type: "BOOKING", booking_id: booking.id, amount: verifiedSd.total,
        customer_name: sd.customer_name, qty: verifiedSd.qty,
        voucher_ids: verifiedSd.voucher_ids || [verifiedSd.voucher_id].filter(Boolean),
        voucher_codes: verifiedSd.voucher_codes || [verifiedSd.voucher_code].filter(Boolean),
      });
      const ref = booking.id.substring(0, 8).toUpperCase();
      if (yocoData?.fully_covered) {
        // The vouchers cover the rest, so create-checkout already confirmed the
        // booking. confirm-booking sends the confirmation once (idempotent).
        try {
          await fetch(SUPABASE_URL + "/functions/v1/confirm-booking", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY, "x-tenant-business-id": tenant.business.id },
            body: JSON.stringify({ booking_id: booking.id, booking_token: (booking as any).waiver_token }),
          });
        } catch (e) { console.error("WA_CONFIRM_BOOKING_ERR booking=" + booking.id, e); }
        await sendText(tenant, phone, "\u{1F389} *You\u2019re all set!* Your voucher covers this booking.\n\n\u{1F4CB} Ref: " + ref + "\n\nYour confirmation email is on its way." + termsNotice);
        await setConvo(convo.id, { current_state: "IDLE", state_data: {}, last_booking_id: booking.id, customer_name: sd.customer_name, email: email });
        return;
      }
      let payUrl = "";
      if (yocoData && yocoData.id && yocoData.redirectUrl) {
        payUrl = yocoData.redirectUrl;
      } else { payUrl = "Payment link unavailable. Type *speak to us* for help"; }
      await sendText(tenant, phone, "Almost there, " + sd.customer_name.split(" ")[0] + "! \u{1F389}\n\n\u{1F4CB} Ref: " + ref + "\n\u{1F4B0} Total: " + rands(verifiedSd.total) + "\n\nComplete your payment here:\n" + payUrl + "\n\n\u23F0 Your spots are held for 15 minutes." + termsNotice);
      await setConvo(convo.id, { current_state: "AWAITING_PAYMENT", state_data: { booking_id: booking.id }, last_booking_id: booking.id, customer_name: sd.customer_name, email: email });
      await logE(tenant, "payment_link_sent", { booking_id: booking.id }, booking.id);
    }

    // ===== AWAITING_PAYMENT =====
    else if (state === "AWAITING_PAYMENT") {
      // L9: Check if hold has expired
      if (sd.booking_id) {
        const awHold = await supabase.from("holds").select("status, expires_at").eq("booking_id", sd.booking_id).eq("status", "ACTIVE").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (awHold.data && new Date(awHold.data.expires_at) < new Date()) {
          await sendText(tenant, phone, "Your hold has expired and the spots have been released. \u{1F614}\n\nNo worries! Type *book* to start a new booking and grab fresh spots!");
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
      let tourId = rid ? rid.replace("GV_", "") : "";
      // Typed fallback — same as PICK_TOUR: accept a typed tour name or number
      if (!tourId && rawText) {
        const gvTours = await getActiveTours(tenant);
        const gvTyped = rawText.toLowerCase().trim();
        const gvNum = gvTyped.match(/^(\d{1,2})\.?$/);
        if (gvNum && Number(gvNum[1]) >= 1 && Number(gvNum[1]) <= gvTours.length) {
          tourId = gvTours[Number(gvNum[1]) - 1].id;
        } else {
          const gvMatches = gvTours.filter((tr: any) => {
            const nm = String(tr.name || "").toLowerCase();
            return nm === gvTyped || nm.includes(gvTyped) || gvTyped.includes(nm);
          });
          if (gvMatches.length === 1) tourId = gvMatches[0].id;
        }
        if (!tourId) {
          const gvTours2 = gvTours.slice(0, 10);
          let gvOpts = "Which tour is the voucher for? Reply with the name or number:\n\n";
          for (let gi = 0; gi < gvTours2.length; gi++) gvOpts += (gi + 1) + ". " + gvTours2[gi].name + "\n";
          await sendText(tenant, phone, gvOpts);
          return;
        }
      }
      if (!tourId) { await sendText(tenant, phone, "Please pick a tour from the list."); return; }
      const tourInfo = await supabase.from("tours").select("*").eq("id", tourId).eq("business_id", tenant.business.id).eq("active", true).eq("hidden", false).maybeSingle();
      if (!tourInfo.data) { await sendText(tenant, phone, "Can't find that tour. Let's try again."); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      const t = tourInfo.data;
      await sendText(tenant, phone, "\u{1F381} *" + t.name + " Gift Voucher*\nValue: " + rands(t.base_price_per_person) + "\n\nWho is this voucher for? Type their name (e.g. Sarah):");
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
        "\u{1F4B0} " + rands(sd.value) + "\n" +
        "\u{1F465} For: " + sd.recipient_name + "\n";
      if (sd.gift_message) summary += "\u{1F4AC} Message: \"" + sd.gift_message + "\"\n";
      summary += "\u{1F4E7} Send to: " + buyerEmail + "\n\nLook good?";
      await sendButtons(tenant, phone, summary, [{ id: "GV_CONFIRM", title: "\u2705 Pay " + rands(sd.value) }, { id: "IDLE", title: "\u274C Cancel" }]);
      await setConvo(convo.id, { current_state: "GV_CONFIRM", state_data: { ...sd, buyer_email: buyerEmail } });
    }

    else if (state === "GV_CONFIRM") {
      if (rid === "IDLE" || /^(no|nope|cancel)\b/.test(input)) {
        await sendText(tenant, phone, "No worries, cancelled! Type *menu* whenever you're ready.");
        await setConvo(convo.id, { current_state: "IDLE", state_data: {} });
        return;
      }
      if (rid === "GV_CONFIRM" || /^(y|yes|yep|yeah|ok|okay|sure|confirm|pay)\b/.test(input)) {
        // Create voucher in PENDING status
        const vcode = genVoucherCode();
        const vr = await insertVoucherWithRetry({
          business_id: tenant.business.id, code: vcode, status: "PENDING", type: "FREE_TRIP",
          recipient_name: sd.recipient_name, gift_message: sd.gift_message || null,
          buyer_name: sd.buyer_name, buyer_email: sd.buyer_email, buyer_phone: phone,
          tour_name: sd.tour_name, gift_tour_id: sd.tour_id, value: sd.value, purchase_amount: sd.value, current_balance: sd.value,
          pax_limit: 1, purchase_value: sd.value,
          expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        });

        if (vr.error || !vr.data) {
          console.error("GV_ERR:", JSON.stringify(vr.error));
          await sendText(tenant, phone, "Something went wrong. Let me connect you to our team.");
          await setConvo(convo.id, { current_state: "IDLE", status: "HUMAN" });
          return;
        }

        const yocoData = await requestCheckout({
          type: "GIFT_VOUCHER", voucher_id: vr.data.id, voucher_code: vcode, amount: sd.value,
        });

        if (yocoData && yocoData.id && yocoData.redirectUrl) {
          await sendText(tenant, phone,
            "\u{1F381} Great! Complete your payment to generate the voucher:\n\n" +
            "\u{1F4B0} Amount: " + rands(sd.value) + "\n" +
            "\u{1F517} " + yocoData.redirectUrl + "\n\n" +
            "Once paid, the voucher will be emailed to " + sd.buyer_email
          );
        } else {
          await sendText(tenant, phone, "Payment link unavailable. Type *speak to us* for help.");
        }
        await setConvo(convo.id, { current_state: "GV_AWAITING_PAYMENT", state_data: { voucher_id: vr.data.id, voucher_code: vcode, buyer_email: sd.buyer_email } });
        return;
      }
      await sendText(tenant, phone, "Reply *yes* to pay, or *no* to cancel.");
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
          // No booking in progress here (this state is entered from the menu),
          // so never route to CONFIRM_BOOKING \u2014 its buttons led to a phantom
          // booking flow with no slot/qty in state_data.
          await sendText(tenant, phone, "This voucher has already been redeemed. Each voucher code can only be used once.");
          await sendButtons(tenant, phone, "Options:", [{ id: "REDEEM_VOUCHER", title: "\u{1F39F} Try Another Code" }, { id: "HUMAN", title: "\u{1F4AC} Get Help" }, { id: "IDLE", title: "\u2B05 Back" }]);
          await setConvo(convo.id, { current_state: "MENU" }); return;
        }
        await sendText(tenant, phone, "Hmm, that code doesn\u2019t seem to be valid. Check for typos and try again, or type *speak to us* for help.");
        await sendButtons(tenant, phone, "Options:", [{ id: "VOUCHER", title: "\u{1F39F} Try Again" }, { id: "HUMAN", title: "\u{1F4AC} Get Help" }, { id: "IDLE", title: "\u2B05 Back" }]);
        await setConvo(convo.id, { current_state: "MENU" }); return;
      }
      if (vr2.data.expires_at && new Date(vr2.data.expires_at) < new Date()) { await sendText(tenant, phone, "Unfortunately this voucher has expired. Type *speak to us* if you think this is a mistake."); await setConvo(convo.id, { current_state: "IDLE" }); return; }

      const vVal = Number(vr2.data.current_balance || vr2.data.value || vr2.data.purchase_amount || 0);
      const vType = vr2.data.type || "CREDIT";
      const tours3 = await getBookableTours(tenant);
      if (tours3.length === 0) { await sendText(tenant, phone, "Your voucher is valid, but there are no open dates right now. Check back soon and we’ll get you booked in!"); await setConvo(convo.id, { current_state: "IDLE" }); return; }
      if (tours3.length === 1) {
        await sendText(tenant, phone, "\u{1F389} Voucher accepted! (" + rands(vVal) + " credit)\n\nHow many people will be joining?");
        await setConvo(convo.id, { current_state: "ASK_QTY", state_data: { voucher_code: code, voucher_id: vr2.data.id, voucher_value: vVal, voucher_type: vType, tour_id: tours3[0].id } });
      } else {
        const vtrows: any[] = [];
        for (let vti = 0; vti < tours3.length; vti++) {
          const vtr = tours3[vti];
          vtrows.push({ id: "TOUR_" + vtr.id, title: vtr.name, description: formatDuration(vtr.duration_minutes) + " \u2022 normally " + rands(vtr.base_price_per_person) + "/pp" });
        }
        await sendText(tenant, phone, "\u{1F389} Voucher accepted! (" + rands(vVal) + " credit)\n\nWhich tour would you like?");
        await sendList(tenant, phone, "Pick your adventure:", "Choose Tour", [{ title: "Tours", rows: vtrows }]);
        await setConvo(convo.id, { current_state: "PICK_TOUR", state_data: { voucher_code: code, voucher_id: vr2.data.id, voucher_value: vVal, voucher_type: vType } });
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
      const vCodes = (sd.voucher_codes || [sd.voucher_code].filter(Boolean));
      const vIds = (sd.voucher_ids || [sd.voucher_id].filter(Boolean));
      const xVal = Number(xvr.data.current_balance ?? xvr.data.value ?? xvr.data.purchase_amount ?? 0);
      if (vIds.includes(xvr.data.id) || !(xVal > 0)) {
        await sendText(tenant, phone, vIds.includes(xvr.data.id) ? "That voucher is already on this booking." : "That voucher has no balance left.");
        await setConvo(convo.id, { current_state: "CONFIRM_BOOKING" });
        return;
      }
      vCodes.push(xcode);
      vIds.push(xvr.data.id);
      // Same pricing as the summary and FINALIZE_BOOKING: group discount first, then the vouchers.
      const xPriced = calculateChatBookingPricing({ qty: Number(sd.qty), unitPrice: Number(sd.unit_price), groupDiscountPercent: Number(sd.discount_percent || 0), groupDiscountMinQty: 1, voucherDeduction: Number(sd.voucher_deduction || 0) + xVal });
      const newTotal = xPriced.total;
      let xMsg = "\u{1F39F} *Voucher applied!* (" + rands(xVal) + " credit)\n\n";
      if (newTotal === 0) xMsg += "Your trip is now *completely FREE!*";
      else xMsg += "Remaining balance: *" + rands(newTotal) + "*";
      await sendText(tenant, phone, xMsg);
      // voucher_id/voucher_code mark the booking as voucher-funded for FINALIZE_BOOKING.
      const updatedSd = { ...sd, voucher_id: sd.voucher_id || xvr.data.id, voucher_code: sd.voucher_code || xcode, voucher_value: Number(sd.voucher_value || 0) + xVal, voucher_codes: vCodes, voucher_ids: vIds, voucher_deduction: xPriced.voucherDeduction, total: newTotal };
      const cBtns = [{ id: "CONFIRM", title: newTotal > 0 ? "\u2705 Pay " + rands(newTotal) : "\u2705 Confirm (FREE)" }, { id: "IDLE", title: "\u274C Cancel" }];
      if (newTotal > 0) cBtns.splice(1, 0, { id: "ADD_VOUCHER", title: "\u{1F39F} Add Voucher" });
      await sendButtons(tenant, phone, "Ready to proceed?", cBtns);
      await setConvo(convo.id, { current_state: "CONFIRM_BOOKING", state_data: updatedSd });
    }


    // ===== ASK MODE =====
    else if (state === "ASK_MODE") {
      // Smart context-aware answering with database lookups
      await typingDelay();

      // PRIORITY 1: Check booking-related intents first (before FAQ!)
      let wantReschedule = input.includes("reschedule") || input.includes("move") && (input.includes("booking") || input.includes("trip")) || (input.includes("change") && (input.includes("date") || input.includes("time") || input.includes("booking") || input.includes("day")));
      const wantCancel = (input.includes("cancel") && !input.includes("cancellation") && !input.includes("policy")) || (input.includes("refund") && input.includes("my"));
      const wantMyBooking = input.includes("my booking") || input.includes("my trip") || input.includes("my tour") || (input.includes("booking") && (input.includes("today") || input.includes("made") || input.includes("check") || input.includes("status") || input.includes("when") || input.includes("detail") || input.includes("info"))) || (input.includes("when") && (input.includes("my") || input.includes("trip") || input.includes("tour") || input.includes("paddle"))) || (input.includes("what time") && input.includes("my")) || (input.includes("how many") && input.includes("my")) || (input.includes("ref") && (input.includes("my") || input.includes("booking")));
      const wantBook = input.includes("book") && (input.includes("want") || input.includes("like") || input.includes("can i"));
      const wantAddPeople = (input.includes("add") || input.includes("more") || input.includes("extra")) && (input.includes("people") || input.includes("person") || input.includes("pax") || input.includes("guest") || input.includes("friend"));
      const wantReducePeople = (input.includes("reduce") || input.includes("remove") || input.includes("less") || input.includes("fewer")) && (input.includes("people") || input.includes("person") || input.includes("pax"));
      const wantChangeTour = (input.includes("change") || input.includes("switch") || input.includes("swap")) && (input.includes("tour") || input.includes("sea") || input.includes("sunset"));
      const wantChangeName = (input.includes("change") || input.includes("update") || input.includes("wrong")) && (input.includes("name") || input.includes("person"));
      const wantConfirmEmail = (input.includes("email") || input.includes("confirmation")) && (input.includes("resend") || input.includes("again") || input.includes("didn") || input.includes("not received") || input.includes("haven"));
      // "Resend my confirmation email" is an email request, not a payment-link one.
      const wantPaymentLink = !wantConfirmEmail && (input.includes("payment") && (input.includes("link") || input.includes("pay") || input.includes("again") || input.includes("new")) || (input.includes("didn") && input.includes("pay")) || input.includes("resend"));
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
        await sendManageBookingsRedirect(tenant, phone, convo.id);
        return;
      }

      if (wantReducePeople) {
        await sendManageBookingsRedirect(tenant, phone, convo.id);
        return;
      }

      if (wantChangeTour) {
        await sendManageBookingsRedirect(tenant, phone, convo.id);
        return;
      }

      if (wantChangeName) {
        const nmBkr = await supabase.from("bookings").select("id, customer_name, slots(start_time), tours(name)")
          .in("phone", [phone, "+" + phone]).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
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
          .in("phone", [phone, "+" + phone]).eq("business_id", tenant.business.id).in("status", ["HELD", "PENDING"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (payBkr.data && payBkr.data.yoco_checkout_id) {
          // Create new checkout
          const rpBk = payBkr.data;
          const rpRef = rpBk.id.substring(0, 8).toUpperCase();
          const rpYocoData = await requestCheckout({ type: "BOOKING", booking_id: rpBk.id, amount: rpBk.total_amount });
          if (rpYocoData?.redirectUrl) {
            await sendText(tenant, phone, "Here\u2019s a fresh payment link for booking *" + rpRef + "* (" + rands(rpBk.total_amount) + "):\n\n" + rpYocoData.redirectUrl + "\n\n\u23F0 Your spots are held for 15 minutes.");
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
          .in("phone", [phone, "+" + phone]).eq("business_id", tenant.business.id).in("status", ["PAID", "CONFIRMED"])
          .order("created_at", { ascending: false }).limit(1).single();
        if (emBkr.data) {
          const emBk = emBkr.data; const emRef = emBk.id.substring(0, 8).toUpperCase();
          try {
            const emRes = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
              body: JSON.stringify({ type: "BOOKING_CONFIRM", data: { booking_id: emBk.id, business_id: tenant.business.id, email: emBk.email, customer_name: emBk.customer_name, ref: emRef, tour_name: (emBk as any).tours?.name || "Tour", start_time: (emBk as any).slots?.start_time ? fmtTime(tenant, (emBk as any).slots.start_time) : "TBC", qty: emBk.qty, total_amount: emBk.total_amount } }),
            });
            if (!emRes.ok) throw new Error("send-email " + emRes.status);
            await sendText(tenant, phone, "Done! I\u2019ve resent the confirmation to *" + emBk.email + "* \u2709\uFE0F\n\nCheck your inbox (and spam folder). Ref: " + emRef);
          } catch (e) {
            console.error("CONFIRM_RESEND_ERR", e);
            await sendText(tenant, phone, "Something went wrong sending the email. Let me connect you to our team.");
            await setConvo(convo.id, { status: "HUMAN" });
          }
        } else {
          await sendText(tenant, phone, "I couldn\u2019t find a confirmed booking to resend. Check My Bookings or contact our team.");
        }
        await sendButtons(tenant, phone, "Anything else?", [{ id: "ASK", title: "\u2753 Another Question" }, { id: "IDLE", title: "\u2B05 Menu" }]);
        await setConvo(convo.id, { current_state: "MENU" });
        return;
      }

      // Instalment/deposit accounting is not part of the MVP. Only issue a
      // checkout for the full outstanding balance until that ledger exists.
      const wantSplit = (input.includes("split") && input.includes("pay")) || (input.includes("separate") && input.includes("pay"));
      const wantCash = input.includes("cash") || (input.includes("deposit") && !input.includes("refund"));
      if (wantSplit || wantCash) {
        await sendText(tenant, phone, "Online booking requires one payment for the full balance. Please use your payment link, or speak to our team about another payment arrangement.");
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
      if (!wantReschedule && !wantCancel && !wantMyBooking && isAvailabilityQuery(input)) {
        const askHandled = await handleSmartAvail(tenant, phone, input);
        if (askHandled) { await setConvo(convo.id, { current_state: "MENU" }); return; }
      }

      if (wantReschedule || wantCancel || wantMyBooking) {
        await sendManageBookingsRedirect(tenant, phone, convo.id);
        return;
      }

      // PRIORITY 2: Check FAQ (after booking intents)
      const askFaq = matchFAQ(input);
      const askFaqAnswer = askFaq ? await getFaqAnswer(tenant, askFaq, input) : null;
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
        .in("phone", [phone, "+" + phone]).eq("business_id", tenant.business.id).in("status", ["PAID", "HELD", "CONFIRMED"])
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

      // Call the LLM with full context (bookings + availability + vector KB)
      {
        if (WA_BOT_V2 === "on" && await botAnswerV2(tenant, phone, convo, rawText, "send")) return;
        const askKbCtx = await retrieveKbContext(supabase, tenant.business.id, rawText);
        if (askKbCtx) gemContext = askKbCtx + "\n" + gemContext;
        const ctxOut = injectionRefusal(rawText) ?? await llmText({
          system: buildGeminiInstruction(tenant, gemContext),
          user: rawText,
          maxTokens: 400,
          temperature: 0.2,
          timeoutMs: 8000,
          label: "wa-ask",
          quota: true,
          businessId: tenant.business.id,
          userKey: await hashedUserKey(tenant.business.id, String(phone)),
        });
        if (ctxOut) {
          await sendText(tenant, phone, screenReply(ctxOut));
          await sendButtons(tenant, phone, "Anything else?", [{ id: "ASK", title: "\u2753 Another Question" }, { id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Menu" }]);
          await setConvo(convo.id, { current_state: "MENU" });
          if (WA_BOT_V2 === "shadow") await botAnswerV2(tenant, phone, convo, rawText, "shadow");
          return;
        }
      }

      // Fallback
      await sendText(tenant, phone, "Hmm, I\u2019m not sure about that one. Try asking in a different way, or pick an option below:");
      await sendButtons(tenant, phone, "Options:", [{ id: "ASK", title: "\u2753 Try Again" }, { id: "BOOK", title: "\u{1F6F6} Book a Tour" }, { id: "IDLE", title: "\u2B05 Menu" }]);
      await setConvo(convo.id, { current_state: "MENU" });
    }

    // ===== CHANGE NAME =====
    else if (state === "CHANGE_NAME") {
      if (rawText.length < 2) { await sendText(tenant, phone, "Please type the new name:"); return; }
      await supabase.from("bookings").update({ customer_name: rawText }).eq("id", sd.booking_id).eq("business_id", tenant.business.id);
      await sendText(tenant, phone, "Updated! The booking is now under *" + rawText + "* \u2705");
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

    // ===== FALLBACK =====
    else {
      // Try FAQ match from any state
      const fallbackFaq = matchFAQ(input);
      const fallbackFaqAnswer = fallbackFaq ? await getFaqAnswer(tenant, fallbackFaq, input) : null;
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

async function processWhatsappValue(tenant: TenantContext, value: any, message: any = null) {
      // ── Delivery-status callbacks (value.statuses) ──────────────────────
      // Meta ACCEPTS an out-of-window free-form send (we log SENT with a
      // message id) and only reports the failure here, asynchronously, as a
      // "failed" status with error 131047/131026. These used to be silently
      // dropped: the admin saw "sent", the customer got nothing, and the
      // reopener fallback in admin-reply never fired because it only catches
      // the synchronous form of the error. Recover the same way admin-reply
      // does: flip the audit row to FAILED, queue the undelivered message in
      // outbox (drained on the customer's next reply), and send the
      // pre-approved reopener template so the customer knows to reply.
      if (!message && Array.isArray(value?.statuses) && value.statuses.length) {
        for (const st of value.statuses) {
          try {
            if (st?.status !== "failed") continue;
            const errCode = Number(st?.errors?.[0]?.code || 0);
            const errMsg = String(st?.errors?.[0]?.message || st?.errors?.[0]?.title || "delivery failed");
            const providerId = String(st?.id || "");
            if (!providerId) continue;
            const { data: original } = await supabase.from("wa_messages")
              .select("id, kind, body, booking_id, to_phone, status")
              .eq("business_id", tenant.business.id)
              .eq("provider_message_id", providerId)
              .maybeSingle();
            // Already FAILED = this status was processed before (Meta retries
            // webhooks) — skip so we don't queue/reopen twice.
            if (!original || original.status === "FAILED") continue;
            await supabase.from("wa_messages")
              .update({ status: "FAILED", error: errCode + ": " + errMsg })
              .eq("id", original.id).eq("business_id", tenant.business.id);
            const windowClosed = errCode === 131047 || errCode === 131026;
            // Only recover free-form text. A failed TEMPLATE send must never
            // trigger another template — that would loop.
            if (!windowClosed || original.kind !== "text" || !original.body) continue;
            const failedPhone = String(original.to_phone || st?.recipient_id || "");
            if (!failedPhone) continue;
            await supabase.from("outbox").insert({
              business_id: tenant.business.id,
              booking_id: original.booking_id || null,
              phone: failedPhone,
              message_type: "WINDOW_CLOSED_RETRY",
              message_body: original.body,
              scheduled_for: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // far future; drained on reply
              status: "WAITING_WINDOW",
            });
            // At most one reopener per phone per hour — a burst of failed
            // sends queues every message but pings the customer once.
            const reopenerName = Deno.env.get("WA_REOPENER_TEMPLATE_NAME") || "booking_update_reopener";
            const { data: recentReopener } = await supabase.from("wa_messages")
              .select("id")
              .eq("business_id", tenant.business.id)
              .eq("to_phone", failedPhone)
              .eq("kind", "template")
              .eq("template_name", reopenerName)
              .eq("status", "SENT")
              .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
              .limit(1);
            if (!(recentReopener || []).length) {
              let firstName = "there";
              const { data: convo } = await supabase.from("conversations")
                .select("customer_name")
                .eq("business_id", tenant.business.id)
                .eq("phone", failedPhone)
                .maybeSingle();
              if (convo?.customer_name) firstName = String(convo.customer_name).split(" ")[0];
              await sendWhatsappTemplate(tenant, failedPhone, reopenerName, [firstName, getBusinessDisplayName(tenant.business)], "en", original.booking_id);
            }
            console.log("WA_STATUS_RECOVERY: msg " + providerId + " failed (" + errCode + ") — queued + reopener for " + failedPhone);
          } catch (stErr) {
            console.error("WA_STATUS_HANDLER_ERR:", stErr);
          }
        }
        return new Response("OK", { status: 200 });
      }

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

      const ph = message.from; const mt = message.type; let txt = ""; let inter: any = null;
      if (mt === "text") txt = (message.text && message.text.body) || "";
      else if (mt === "interactive") { inter = message.interactive; txt = (inter.button_reply && inter.button_reply.title) || (inter.list_reply && inter.list_reply.title) || ""; }
      else if (mt === "document") txt = "[Document Sent]";
      else if (mt === "image") txt = "[Image Sent]";
      else if (mt === "button") txt = (message.button && message.button.text) || ""; // a template quick-reply tap
      else if (mt === "reaction" || mt === "system") { console.log("SKIP msg type:" + mt + " from:" + ph); return new Response("OK", { status: 200 }); }
      else txt = "[" + mt + " message]"; // voice note, location, sticker...: logged for the Inbox, answered below
      console.log("F:" + ph + " B:" + tenant.business.id + " T:" + txt);
      // One number can't run up the tenant's AI allowance by scripting messages: past
      // 20 a minute the bot stays quiet. STOP, DELETE and the Inbox still work.
      const { data: underLimit, error: limitError } = await supabase.rpc("check_rate_limit", { p_ip: tenant.business.id + ":" + ph, p_endpoint: "wa-bot", p_max: 20 });
      if (limitError) console.error("WA_RATE_LIMIT_ERR", limitError.message);
      await handleMsg(tenant, ph, txt, mt, inter, underLimit === false);
      return new Response("OK", { status: 200 });
}

async function processWhatsappBatch(body: any) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change?.value;
      if (!value?.messages && !value?.statuses) continue;
      // One provider delivery can contain messages for different numbers.
      // Resolve each change separately, never reuse the first tenant.
      const tenant = await resolveTenantByWhatsappPayload(supabase, { entry: [{ changes: [change] }] });
      if (value.statuses?.length) await processWhatsappValue(tenant, value);
      for (const message of value.messages || []) await processWhatsappValue(tenant, value, message);
    }
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
      const rawBody = await req.text();
      const verified = await verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"));
      if (!verified) {
        console.warn("WA webhook rejected — invalid or missing signature");
        return new Response("Invalid signature", { status: 401 });
      }
      await processWhatsappBatch(JSON.parse(rawBody));
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("E:", err);
      return new Response("Webhook error", { status: 500 });
    }
  }
  return new Response("Not allowed", { status: 405 });
});
