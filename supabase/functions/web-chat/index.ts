// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getBusinessAllowedOrigins, getBusinessDisplayName, getTenantByBusinessId, isAllowedOrigin } from "../_shared/tenant.ts";
import {
  gateInbound,
  gateOutbound,
  hardenSystemPrompt,
  KB_REFUSAL_REPLY,
} from "../_shared/bot-guards.ts";
import { classifyIntent, priorityForIntent, findFaqMatch } from "../_shared/intent.ts";
import { verifyChatBookingPricing } from "../_shared/chat-booking-pricing.ts";
const GK = Deno.env.get("GEMINI_API_KEY");
const SU = Deno.env.get("SUPABASE_URL");
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(SU, SK);
const BOOKING_SUCCESS_URL = Deno.env.get("BOOKING_SUCCESS_URL") || "";
const BOOKING_CANCEL_URL = Deno.env.get("BOOKING_CANCEL_URL") || "";
const VOUCHER_SUCCESS_URL = Deno.env.get("VOUCHER_SUCCESS_URL") || "";
// L10: Request-scoped timezone. Set at the start of each request handler.
// Deno edge functions process one request per isolate, so this is safe.
let _requestTimezone = "UTC";
function gCors(r) { const o = typeof r === "string" ? r : (r?.headers?.get("origin") || ""); return { "Access-Control-Allow-Origin": o || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" }; }
function withQuery(base, params) { const u = new URL(base); for (const k in params) if (params[k]) u.searchParams.set(k, params[k]); return u.toString(); }
function trimTrailingSlash(url) { return String(url || "").replace(/\/+$/, ""); }
function appendQuery(base, params) { const u = new URL(base); for (const k in params) if (params[k]) u.searchParams.set(k, params[k]); return u.toString(); }
async function getBusinessSiteUrls(businessId) {
  if (!businessId) return { bookingSuccessUrl: BOOKING_SUCCESS_URL, bookingCancelUrl: BOOKING_CANCEL_URL, voucherSuccessUrl: VOUCHER_SUCCESS_URL };
  const { data } = await db.from("businesses").select("booking_site_url, booking_success_url, booking_cancel_url, voucher_success_url").eq("id", businessId).maybeSingle();
  const bookingSiteUrl = trimTrailingSlash(data?.booking_site_url);
  return {
    bookingSuccessUrl: data?.booking_success_url || (bookingSiteUrl ? bookingSiteUrl + "/success" : BOOKING_SUCCESS_URL),
    bookingCancelUrl: data?.booking_cancel_url || (bookingSiteUrl ? bookingSiteUrl + "/cancelled" : BOOKING_CANCEL_URL),
    voucherSuccessUrl: data?.voucher_success_url || (bookingSiteUrl ? bookingSiteUrl + "/voucher-confirmed" : VOUCHER_SUCCESS_URL),
  };
}
async function getBusinessWaiverLink(businessId, bookingId, waiverToken) {
  if (!businessId || !bookingId || !waiverToken) return "";
  const { data } = await db.from("businesses").select("waiver_url").eq("id", businessId).maybeSingle();
  const customUrl = String(data?.waiver_url || "").trim();
  if (customUrl) return appendQuery(customUrl, { booking: bookingId, token: waiverToken });
  return appendQuery(String(SU || "").replace(/\/+$/, "") + "/functions/v1/waiver-form", { booking: bookingId, token: waiverToken });
}
async function getBookingCustomFields(businessId) {
  if (!businessId) return [];
  const { data } = await db.from("businesses").select("booking_custom_fields").eq("id", businessId).maybeSingle();
  return Array.isArray(data?.booking_custom_fields) ? data.booking_custom_fields.filter(function (f) { return f && f.key && f.label; }) : [];
}
function nextCustomField(defs, values) {
  for (let i = 0; i < (defs || []).length; i++) {
    const field = defs[i];
    if (!field) continue;
    if (!String(values?.[field.key] || "").trim()) return field;
  }
  return null;
}
function promptForCustomField(field) {
  if (!field) return "Please share the next booking detail.";
  return field.label + (field.required ? " *" : "") + (field.placeholder ? "\n" + field.placeholder : "");
}
function fmt(iso) { const d = new Date(iso); if (isNaN(d.getTime())) return "?"; return d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: _requestTimezone }) + " at " + d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: _requestTimezone }); }
function fmtS(iso) { const d = new Date(iso); if (isNaN(d.getTime())) return "?"; return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: _requestTimezone }) + " " + d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: _requestTimezone }); }
function fmtDate(iso) { const d = new Date(iso); if (isNaN(d.getTime())) return "?"; return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: _requestTimezone }); }
function fmtTime(iso) { const d = new Date(iso); if (isNaN(d.getTime())) return "?"; return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: _requestTimezone }); }
function dateKey(iso) { const d = new Date(iso); return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: _requestTimezone }).format(d); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function normP(p) { if (!p) return ""; let c = String(p).replace(/[^\d]/g, ""); if (c.startsWith("0")) c = "27" + c.substring(1); if (c.startsWith("270") && c.length > 11) c = "27" + c.substring(3); return c; }
function tryFaqOrToursReply(lo: string, faq: any, tsText: string, business: any): string | null {
  if (faq) {
    if (Array.isArray(faq)) {
      for (const f of faq) {
        const qw = String(f.question || f.q || "").toLowerCase();
        if (qw && lo.split(/\s+/).some(function (w) { return w.length > 3 && qw.includes(w); })) {
          return String(f.answer || f.a || "");
        }
      }
    } else if (typeof faq === "object") {
      for (const key of Object.keys(faq)) {
        if (key && lo.split(/\s+/).some(function (w) { return w.length > 3 && key.toLowerCase().includes(w); })) {
          return String(faq[key] || "");
        }
      }
    }
  }
  if (lo.includes("tour") || lo.includes("offer") || lo.includes("activit") || lo.includes("experience") || lo.includes("do you do") || lo.includes("what do you")) {
    return "Here's what we offer:\n" + tsText + "\n\nWould you like to book one?";
  }
  if (lo.includes("price") || lo.includes("cost") || lo.includes("how much") || lo.includes("rate") || lo.includes("fee")) {
    return "Here are our current rates:\n" + tsText + "\n\nWould you like to book?";
  }
  if (lo.includes("bring") || lo.includes("wear") || lo.includes("need to have") || lo.includes("pack")) {
    const wtb = String(business?.what_to_bring || "").trim();
    if (wtb) return wtb;
    return "Comfortable clothes, sun protection, water. Would you like to book a tour?";
  }
  if (lo.includes("meet") || lo.includes("where") || lo.includes("location") || lo.includes("direction") || lo.includes("address") || lo.includes("find you")) {
    const dir = String(business?.directions || "").trim();
    if (dir) return dir;
  }
  if (lo.includes("time") || lo.includes("when") || lo.includes("start") || lo.includes("schedule")) {
    return "Our tours run at various times throughout the day. Here's what's available:\n" + tsText + "\n\nWould you like to pick a date to see specific times?";
  }
  if (lo.includes("refund") || lo.includes("cancel") || lo.includes("policy")) {
    return "For cancellations and refunds, please reach out to us directly so we can help with your specific booking. Would you like to look up your booking?";
  }
  return null;
}
async function gemChat(hist, msg, toursList, businessId) {
  const tenant = businessId ? await getTenantByBusinessId(db, businessId).catch(function () { return null; }) : null;
  const brandName = getBusinessDisplayName(tenant?.business);
  const tsText = (toursList || []).map(function (t) { return "- " + t.name + ": R" + t.base_price_per_person + "/pp, " + t.duration_minutes + " min"; }).join("\n");
  const faq = tenant?.business?.faq_json;
  try {
    // Pre-LLM injection check.
    const gate = gateInbound(String(msg || ""));
    if (!gate.safe) {
      console.log("WEBCHAT_GEM_GATED:" + gate.reason);
      return gate.reply || KB_REFUSAL_REPLY;
    }
    if (!GK) {
      console.warn("WEBCHAT_NO_GEMINI_KEY — falling back to FAQ search");
      const lo = String(msg).toLowerCase();
      const faqHit = tryFaqOrToursReply(lo, faq, tsText, tenant?.business);
      if (faqHit) return faqHit;
      return null;
    }
    const c = []; for (const h of (hist || []).slice(-8)) c.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] });
    c.push({ role: "user", parts: [{ text: gate.cleaned || msg }] });
    const sysBase = (tenant?.business?.ai_system_prompt || ("You are a friendly website chat assistant for " + brandName + ". Keep replies short, clear, and human. Never invent availability, pricing, or policy details."))
      + "\n\nCurrent available tours:\n" + tsText
      + (faq ? "\n\nFAQ:\n" + JSON.stringify(faq) : "")
      + (tenant?.business?.terminology ? "\n\nTerminology:\n" + JSON.stringify(tenant.business.terminology) : "");
    const sysText = hardenSystemPrompt(sysBase);
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ system_instruction: { parts: [{ text: sysText }] }, contents: c, generationConfig: { temperature: 0.7, maxOutputTokens: 150 } }) });
    const d = await r.json();
    if (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts && d.candidates[0].content.parts[0]) {
      const raw = d.candidates[0].content.parts[0].text;
      const out = gateOutbound(String(raw));
      if (out.leakDetected) console.warn("WEBCHAT_GEM_LEAK:" + out.matches.join(","));
      const gemLo = String(out.reply || "").toLowerCase();
      const isDeflection = gemLo.includes("not sure") || gemLo.includes("don't have") || gemLo.includes("i can't help") || gemLo.includes("connect you with") || gemLo.includes("i don't know");
      if (isDeflection) {
        const fb3 = tryFaqOrToursReply(String(msg).toLowerCase(), faq, tsText, tenant?.business);
        if (fb3) return fb3;
      }
      return out.reply;
    }
    console.warn("WEBCHAT_GEMINI_EMPTY_RESPONSE");
    const fb = tryFaqOrToursReply(String(msg).toLowerCase(), faq, tsText, tenant?.business);
    if (fb) return fb;
    return null;
  } catch (e) {
    console.error("WEBCHAT_GEMINI_ERR:" + String(e));
    const fb2 = tryFaqOrToursReply(String(msg).toLowerCase(), faq, tsText, tenant?.business);
    if (fb2) return fb2;
    return null;
  }
}
async function getSlots(tourId, now) {
  const in30 = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  // M5: 60-minute cutoff — don't show slots starting within the next hour
  // to give customers and staff adequate preparation time
  const cutoff = new Date(now.getTime() + 60 * 60 * 1000);
  const { data: tour } = await db.from("tours").select("business_id").eq("id", tourId).maybeSingle();
  if (!tour?.business_id) return [];
  const { data } = await db.rpc("list_available_slots", {
    p_business_id: tour.business_id,
    p_range_start: cutoff.toISOString(),
    p_range_end: in30.toISOString(),
    p_tour_id: tourId,
  });
  return (data || [])
    .filter(function (s) { return Number(s.available_capacity || 0) > 0; })
    .map(function (s) { return { ...s, booked: Math.max(0, Number(s.capacity_total || 0) - Number(s.available_capacity || 0)), held: 0 }; });
}
Deno.serve(withSentry("web-chat", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: gCors(req) });
  const url = new URL(req.url);
  if (url.searchParams.get("__sentry_test") === "1") {
    throw new Error("Sentry test error from web-chat (intentional)");
  }
  try {
    const body = await req.json(); const hist = body.messages || []; const msg = body.message || ""; const state = body.state || { step: "IDLE" };
    const now = new Date(); let ns = { ...state }; let pay = null; let reply = ""; let buttons = null; let calendar = null;
    let requestedBusinessId = body.business_id || body.businessId || state.bid || "";
    const requestOrigin = req?.headers?.get("origin") || "";
    // L10: Reset timezone at start of each request
    _requestTimezone = "UTC";

    // SECURITY: business_id is REQUIRED to prevent cross-tenant data leaks.
    // Previously, if the frontend omitted business_id (e.g. on the initial chat call before
    // a tour was picked), the tours query ran unfiltered and returned tours from EVERY business.
    // We now resolve the business from the Origin's subdomain as a fallback, and refuse
    // the request if it still can't be determined.
    if (!requestedBusinessId && requestOrigin) {
      try {
        const hostname = new URL(requestOrigin).hostname;
        const bookingMatch = hostname.match(/^([^.]+)\.booking\.bookingtours\.co\.za$/i);
        const subdomain = bookingMatch ? bookingMatch[1].toLowerCase() : "";
        if (subdomain) {
          const { data: bizBySub } = await db
            .from("businesses")
            .select("id")
            .eq("subdomain", subdomain)
            .maybeSingle();
          if (bizBySub?.id) requestedBusinessId = bizBySub.id;
        }
      } catch (_e) { /* fall through to 400 below */ }
    }
    if (!requestedBusinessId) {
      return new Response(
        JSON.stringify({ reply: "Missing business context. Please open this chat from a booking site.", state: { step: "IDLE" } }),
        { status: 400, headers: gCors(requestOrigin) }
      );
    }

    const requestTenant = await getTenantByBusinessId(db, requestedBusinessId).catch(function () { return null; });
    _requestTimezone = requestTenant?.business?.timezone || "UTC";
    if (requestTenant && requestOrigin) {
      const allowedOrigins = getBusinessAllowedOrigins(requestTenant.business);
      if (!isAllowedOrigin(requestOrigin, allowedOrigins)) {
        return new Response(JSON.stringify({ reply: "Origin not allowed for this business.", state: { step: "IDLE" } }), { status: 403, headers: gCors(requestOrigin) });
      }
    }

    // SECURITY: tours query is now ALWAYS scoped to the requesting business.
    const toursQuery = db.from("tours").select("*").eq("business_id", requestedBusinessId).eq("active", true).neq("hidden", true).order("sort_order", { ascending: true });
    const { data: allT } = await toursQuery;
    const tours = (allT || []).filter(function (t) { return !t.hidden; });
    const lo = msg.toLowerCase().trim(); const step = state.step || "IDLE";
    const isBtnClick = lo.startsWith("btn:"); const btnVal = isBtnClick ? lo.replace("btn:", "") : "";

    // L8: "Go back" navigation — map each step to its previous step
    const isGoBack = !isBtnClick && (lo === "back" || lo === "go back" || lo === "previous");
    if (isGoBack && step !== "IDLE") {
      const backMap = {
        "PICK_TOUR": "IDLE", "PICK_DATE": "PICK_TOUR", "PICK_TIME": "PICK_DATE",
        "ASK_QTY": "PICK_TIME", "ASK_DETAILS": "ASK_QTY", "ASK_CUSTOM_FIELD": "ASK_DETAILS",
        "ASK_VOUCHER": "ASK_DETAILS", "ENTER_VOUCHER": "ASK_VOUCHER", "CONFIRM": "ASK_VOUCHER",
        "LOOKUP": "IDLE", "PICK_ACTION": "LOOKUP", "CONFIRM_CANCEL": "PICK_ACTION",
        "RESCH_DATE": "PICK_ACTION", "REVIEW_REQUEST": "PICK_ACTION",
        "MODIFY_QTY": "PICK_ACTION", "CHANGE_TOUR": "PICK_ACTION", "CHANGE_TOUR_SLOT": "CHANGE_TOUR",
        "UPDATE_NAME": "PICK_ACTION", "RESEND_CONFIRM": "PICK_ACTION",
        "GIFT_PICK_TOUR": "IDLE", "GIFT_RECIPIENT": "GIFT_PICK_TOUR", "GIFT_MESSAGE": "GIFT_RECIPIENT",
        "GIFT_BUYER_NAME": "GIFT_MESSAGE", "GIFT_BUYER_EMAIL": "GIFT_BUYER_NAME", "GIFT_CONFIRM": "GIFT_BUYER_EMAIL",
      };
      const prevStep = backMap[step] || "IDLE";
      ns = { ...ns, step: prevStep };
      reply = "OK, going back.";
      if (prevStep === "IDLE") {
        ns = { step: "IDLE" };
        buttons = [{ label: "\u{1F6F6} Book a Tour", value: "btn:book" }, { label: "\u2753 Ask a Question", value: "btn:question" }];
      } else if (prevStep === "PICK_TOUR") {
        buttons = tours.map(function (t) { return { label: t.name + " — R" + t.base_price_per_person, value: t.id }; });
        reply = "Which tour are you keen on?";
      } else if (prevStep === "ASK_VOUCHER") {
        reply = "Do you have a voucher or promo code?";
        buttons = [{ label: "No voucher \u2014 continue", value: "no_voucher" }, { label: "Yes, I have a code", value: "has_voucher" }];
      }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
    }

    // ===== IDLE =====
    // Handle button clicks in IDLE state (e.g., "btn:book", "btn:question")
    if (step === "IDLE" && isBtnClick) {
      if (btnVal === "book" || btnVal === "btn:book") {
        ns = { step: "PICK_TOUR" };
        reply = pick(["Which tour are you keen on?", "Let's get you booked! Which tour?"]);
        buttons = tours.map(function (t4) { return { label: t4.name + " \u2014 R" + t4.base_price_per_person, value: t4.id }; });
        return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
      }
      if (btnVal === "question" || btnVal === "btn:question") {
        reply = "Sure, what would you like to know? \u{1F60A}";
        return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
      }
    }
    if (step === "IDLE" && !isBtnClick) {
      // Detect booking management intents first
      const wReschedule = lo.includes("reschedule") || (lo.includes("change") && (lo.includes("date") || lo.includes("day") || lo.includes("time"))) || (lo.includes("wrong") && (lo.includes("date") || lo.includes("day"))) || (lo.includes("move") && lo.includes("booking"));
      const wCancel = (lo.includes("cancel") && !lo.includes("cancellation") && !lo.includes("policy")) || (lo.includes("refund") && lo.includes("my"));
      const wMyBooking = lo.includes("my booking") || lo.includes("my trip") || lo.includes("booking status") || (lo.includes("when") && lo.includes("my")) || (lo.includes("check") && lo.includes("booking"));
      const wLook = wReschedule || wCancel || wMyBooking || lo.includes("look up");
      const wBook = !wLook && (lo.includes("book") || lo.includes("reserve") || lo.includes("interested") || lo.includes("i want") && lo.includes("tour") || lo.includes("id like") && lo.includes("tour") || lo.includes("sign up"));
      const wAvail = !wLook && !wBook && (lo.includes("available") || lo.includes("space") || lo.includes("tomorrow") && lo.includes("free") || lo.includes("weekend") && lo.includes("free"));
      const wGift = lo.includes("gift") || lo.includes("voucher") && (lo.includes("buy") || lo.includes("purchase") || lo.includes("get"));
      if (wGift) { ns = { step: "GIFT_PICK_TOUR" }; reply = "Awesome, gift vouchers make great presents! 🎁 Which tour should the voucher be for?"; buttons = tours.map(function (t9) { return { label: t9.name + " \u2014 R" + t9.base_price_per_person, value: t9.id }; }); return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) }); }
      if (wLook) {
        if (wReschedule) ns = { step: "LOOKUP", intent: "reschedule" };
        else if (wCancel) ns = { step: "LOOKUP", intent: "cancel" };
        else ns = { step: "LOOKUP", intent: "view" };
        reply = wReschedule ? "Sure, let me help you reschedule! What email did you use when you booked?" : wCancel ? "I can help with that. What email is the booking under?" : "What email did you use when you booked?";
        return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
      }
      if (wBook || wAvail) {
        let mt = null;
        for (const t of tours) {
          const tn = t.name.toLowerCase();
          if (tn.includes("private") && lo.includes("private")) { mt = t; break; }
          if (tn.includes("sunset") && lo.includes("sunset")) { mt = t; break; }
          if (tn.includes("sea") && tn.includes("kayak") && (lo.includes("sea") || lo.includes("morning") || lo.includes("early") || (lo.includes("paddle") && !lo.includes("sunset")))) { mt = t; break; }
          const words = tn.split(/\s+/).filter(function (w) { return w.length > 3 && w !== "tour" && w !== "paddle" && w !== "kayak"; });
          for (const w of words) { if (lo.includes(w)) { mt = t; break; } }
          if (mt) break;
        }
        if (mt) {
          ns = { step: "PICK_DATE", tid: mt.id, tname: mt.name, tprice: mt.base_price_per_person, bid: mt.business_id };
          const slots = await getSlots(mt.id, now);
          if (slots.length > 0) {
            const dates = {}; for (const s of slots) { const dk = dateKey(s.start_time); if (!dates[dk]) dates[dk] = { date: dk, label: fmtDate(s.start_time), slots: [] }; dates[dk].slots.push({ id: s.id, time: s.start_time, avail: s.capacity_total - s.booked - (s.held || 0) }); }
            calendar = Object.values(dates);
            reply = pick(["Pick a date for the " + mt.name + " 📅", "When works for you? Here are the available dates for " + mt.name + ":"]);
          } else { reply = "No " + mt.name + " slots in the next month 😔 Want to try the other tour?"; buttons = tours.filter(function (t2) { return t2.id !== mt.id; }).map(function (t3) { return { label: t3.name + " — R" + t3.base_price_per_person, value: t3.id }; }); ns.step = "PICK_TOUR"; }
        } else {
          ns = { step: "PICK_TOUR" };
          reply = pick(["Which tour are you keen on?", "Let's get you booked! Which tour?"]);
          buttons = tours.map(function (t4) { return { label: t4.name + " — R" + t4.base_price_per_person, value: t4.id }; });
        }
      }
      else { const gem = await gemChat(hist, msg, tours, requestedBusinessId || tours[0]?.business_id); if (gem) { reply = gem; } else { reply = "I can help you book a tour or answer questions about our experiences!"; buttons = [{ label: "\u{1F6F6} Book a Tour", value: "btn:book" }, { label: "\u2753 Ask a Question", value: "btn:question" }]; } }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons, calendar: calendar }), { status: 200, headers: gCors(req) });
    }
    // ===== PICK_TOUR =====
    if (step === "PICK_TOUR") {
      let picked = null;
      if (isBtnClick) picked = tours.find(function (t) { return t.id === btnVal; });
      else {
        for (const t5 of tours) {
          const tn5 = t5.name.toLowerCase();
          if (tn5.includes("private") && lo.includes("private")) { picked = t5; break; }
          if (tn5.includes("sunset") && lo.includes("sunset")) { picked = t5; break; }
          if (tn5.includes("sea") && tn5.includes("kayak") && (lo.includes("sea") || lo.includes("morning") || lo.includes("early") || (lo.includes("paddle") && !lo.includes("sunset")))) { picked = t5; break; }
          const words = tn5.split(/\s+/).filter(function (w) { return w.length > 3 && w !== "tour" && w !== "paddle" && w !== "kayak"; });
          for (const w of words) { if (lo.includes(w)) { picked = t5; break; } }
          if (picked) break;
        }
      }
      if (picked) {
        ns = { step: "PICK_DATE", tid: picked.id, tname: picked.name, tprice: picked.base_price_per_person, bid: picked.business_id };
        const slots2 = await getSlots(picked.id, now);
        if (slots2.length > 0) {
          const dates2 = {}; for (const s2 of slots2) { const dk2 = dateKey(s2.start_time); if (!dates2[dk2]) dates2[dk2] = { date: dk2, label: fmtDate(s2.start_time), slots: [] }; dates2[dk2].slots.push({ id: s2.id, time: s2.start_time, avail: s2.capacity_total - s2.booked - (s2.held || 0) }); }
          calendar = Object.values(dates2);
          reply = pick(["Great choice! Pick a date:", "" + picked.name + " it is! When works for you?"]);
        } else { reply = "Nothing open for " + picked.name + ". Try the other tour?"; ns.step = "PICK_TOUR"; buttons = tours.filter(function (t6) { return t6.id !== picked.id; }).map(function (t7) { return { label: t7.name, value: t7.id }; }); }
      } else { reply = "Which tour are you keen on?"; buttons = tours.map(function (t8) { return { label: t8.name + " — R" + t8.base_price_per_person, value: t8.id }; }); }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons, calendar: calendar }), { status: 200, headers: gCors(req) });
    }
    // ===== PICK_DATE =====
    if (step === "PICK_DATE") {
      let pdSelectedDate = "";
      if (isBtnClick && btnVal.match(/^\d{4}-\d{2}-\d{2}$/)) {
        pdSelectedDate = btnVal;
      } else if (!isBtnClick && lo) {
        // Try to parse natural language date using Gemini
        if (GK) {
          try {
            const pdR = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GK, {
              method: "POST", headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(5000),
              body: JSON.stringify({
                system_instruction: { parts: [{ text: "You are a date extractor. The user is asking for a date. Today is " + now.toISOString().split("T")[0] + ". Return exactly one YYYY-MM-DD date string based on their input, or \"INVALID\" if no date is found. Examples: \"Tomorrow\" -> next date. \"1 September\" -> 2026-09-01." }] },
                contents: [{ role: "user", parts: [{ text: msg }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 15 }
              })
            });
            const pdD = await pdR.json();
            if (pdD.candidates?.[0]?.content?.parts?.[0]) {
              const pdExt = pdD.candidates[0].content.parts[0].text.trim();
              if (pdExt !== "INVALID" && pdExt.match(/^\d{4}-\d{2}-\d{2}$/)) pdSelectedDate = pdExt;
            }
          } catch (e) { }
        }
      }

      if (pdSelectedDate) {
        // Date selected — show time slots for this date
        const slots3 = await getSlots(ns.tid, now);
        const daySlots = slots3.filter(function (s3) { return dateKey(s3.start_time) === pdSelectedDate; });
        if (daySlots.length > 0) {
          ns = { ...ns, step: "PICK_TIME", selectedDate: pdSelectedDate };
          reply = "Times for " + fmtDate(daySlots[0].start_time) + ":";
          buttons = daySlots.map(function (s4) { const av = s4.capacity_total - s4.booked - (s4.held || 0); return { label: fmtTime(s4.start_time) + " (" + av + " spots)", value: s4.id }; });
        } else {
          // No slots for that specific day — re-show calendar
          reply = "No available times on " + fmtDate(pdSelectedDate + "T12:00:00+02:00") + ". Pick another date:";
          const slots4 = await getSlots(ns.tid, now);
          if (slots4.length > 0) {
            const dates3 = {}; for (const s5 of slots4) { const dk3 = dateKey(s5.start_time); if (!dates3[dk3]) dates3[dk3] = { date: dk3, label: fmtDate(s5.start_time), slots: [] }; dates3[dk3].slots.push({ id: s5.id, time: s5.start_time, avail: s5.capacity_total - s5.booked - (s5.held || 0) }); }
            calendar = Object.values(dates3);
          }
        }
      } else {
        // No date parsed — re-show calendar with helpful message
        reply = "Just click on an available date from the calendar \u{1F4C5}";
        const slots4b = await getSlots(ns.tid, now);
        if (slots4b.length > 0) {
          const dates3b = {}; for (const s5b of slots4b) { const dk3b = dateKey(s5b.start_time); if (!dates3b[dk3b]) dates3b[dk3b] = { date: dk3b, label: fmtDate(s5b.start_time), slots: [] }; dates3b[dk3b].slots.push({ id: s5b.id, time: s5b.start_time, avail: s5b.capacity_total - s5b.booked - (s5b.held || 0) }); }
          calendar = Object.values(dates3b);
        } else { reply = "No slots available right now. Try the other tour?"; buttons = tours.filter(function (t6b) { return t6b.id !== ns.tid; }).map(function (t7b) { return { label: t7b.name, value: t7b.id }; }); ns.step = "PICK_TOUR"; }
      }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons, calendar: calendar }), { status: 200, headers: gCors(req) });
    }
    // ===== PICK_TIME =====
    if (step === "PICK_TIME") {
      let slotId = null; let slotTime = null;
      if (isBtnClick) {
        // L22: Verify slot belongs to the selected tour to prevent slot ownership tampering
        const { data: sl } = await db.from("slots").select("id,start_time,tour_id").eq("id", btnVal).single();
        if (sl && sl.tour_id === ns.tid) { slotId = sl.id; slotTime = sl.start_time; }
        else if (sl) { /* Slot exists but belongs to a different tour — ignore */ }
      }
      if (slotId && slotTime) {
        ns = { ...ns, step: "ASK_QTY", slotId: slotId, slotTime: slotTime };
        reply = pick([fmt(slotTime) + " — great pick! How many people?", fmt(slotTime) + " it is! 🙌 How many of you are coming?"]);
      } else {
        const slots5 = await getSlots(ns.tid, now);
        const daySlots2 = slots5.filter(function (s6) { return dateKey(s6.start_time) === ns.selectedDate; });
        reply = "Pick a time:";
        buttons = daySlots2.map(function (s7) { const av2 = s7.capacity_total - s7.booked - (s7.held || 0); return { label: fmtTime(s7.start_time) + " (" + av2 + " spots)", value: s7.id }; });
      }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
    }
    // ===== ASK_QTY =====
    if (step === "ASK_QTY") {
      const n = parseInt(lo.replace(/[^0-9]/g, ""));
      if (n > 0 && n <= 30) {
        const { data: sc } = await db.rpc("slot_available_capacity", { p_slot_id: ns.slotId });
        const mx = Number(sc || 10);
        if (n > mx) { reply = "Only " + mx + " spots left — would " + mx + " work?"; }
        else {
          let tot = n * ns.tprice; let disc = 0; if (n >= 6) { disc = Math.round(tot * 0.05); tot = tot - disc; } ns = { ...ns, step: "ASK_DETAILS", qty: n, total: tot, baseTotal: n * ns.tprice, discount: disc };
          if (disc > 0) reply = n + " people — nice group! You get 5% off (R" + disc + " saved). Total: R" + tot + ".\n\nTo lock this in, please send your:\n- Full Name\n- Email Address\n- Cell Number (including international code, e.g. +27)\n\n*(You can just send them all in one message!)*";
          else reply = pick([n + " people, awesome!\n\nTo lock this in, please send your:\n- Full Name\n- Email Address\n- Cell Number (including international code, e.g. +27)\n\n*(You can just send them all in one message!)*"]);
        }
      } else { reply = "How many people will be joining?"; }
      return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
    }
    // ===== ASK_NAME =====
    if (step === "ASK_DETAILS") {
      const dParts = msg.split(/[,;\n]+/).map(function (p) { return p.trim(); }).filter(function (p) { return p.length > 0; });
      let dName = ""; let dEmail = ""; let dPhone = "";
      for (const dp of dParts) { const dc = dp.replace(/^(name|email|phone|tel|mobile|cell|number)[:\-\s]*/i, "").trim(); if (!dc) continue; if (dc.includes("@") && dc.includes(".") && !dEmail) { dEmail = dc.toLowerCase(); } else if (dc.replace(/[\s\-\+\(\)]/g, "").match(/^\d{7,15}$/) && !dPhone) { dPhone = normP(dc); } else if (dc.match(/[a-zA-Z]/) && !dName) { dName = dc; } }
      if (!dName || !dEmail || !dPhone) {
        const dMiss = []; if (!dName) dMiss.push("full name"); if (!dEmail) dMiss.push("email address"); if (!dPhone) dMiss.push("phone number");
        reply = "I still need your " + dMiss.join(", ") + ".\n\nPlease send all three together, e.g.:\n*John Smith, john@email.com, +27 82 123 4567*";
        return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
      }
      const customDefs = await getBookingCustomFields(ns.bid || tours[0]?.business_id);
      if (customDefs.length > 0) {
        ns = { ...ns, step: "ASK_CUSTOM_FIELD", name: dName, email: dEmail, phone: dPhone, custom_field_defs: customDefs, custom_fields: {} };
        reply = "Thanks " + dName.split(" ")[0] + "! A few trip-specific details first:\n\n" + promptForCustomField(customDefs[0]);
        buttons = null;
      } else {
        ns = { ...ns, step: "ASK_VOUCHER", name: dName, email: dEmail, phone: dPhone };
        reply = "Thanks " + dName.split(" ")[0] + "! \u{1F44D} Do you have a voucher or promo code?"; buttons = [{ label: "No voucher \u2014 continue", value: "no_voucher" }, { label: "Yes, I have a code", value: "has_voucher" }];
      }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
    }
    if (step === "ASK_CUSTOM_FIELD") {
      const defs = Array.isArray(ns.custom_field_defs) ? ns.custom_field_defs : [];
      const values = { ...(ns.custom_fields || {}) };
      const currentField = nextCustomField(defs, values);
      if (!currentField) {
        ns = { ...ns, step: "ASK_VOUCHER" };
        reply = "Perfect. Do you have a voucher or promo code?";
        buttons = [{ label: "No voucher \u2014 continue", value: "no_voucher" }, { label: "Yes, I have a code", value: "has_voucher" }];
        return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
      }
      const fieldValue = msg.trim();
      if (!fieldValue && currentField.required) {
        reply = "I still need this before I can continue:\n\n" + promptForCustomField(currentField);
        return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
      }
      values[currentField.key] = fieldValue;
      ns = { ...ns, custom_fields: values };
      const upcomingField = nextCustomField(defs, values);
      if (upcomingField) {
        reply = "Got it.\n\n" + promptForCustomField(upcomingField);
      } else {
        ns.step = "ASK_VOUCHER";
        reply = "Perfect. Do you have a voucher or promo code?";
        buttons = [{ label: "No voucher \u2014 continue", value: "no_voucher" }, { label: "Yes, I have a code", value: "has_voucher" }];
      }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
    }
    if (step === "ASK_VOUCHER") {
      if (btnVal === "no_voucher" || lo.includes("no") || lo.includes("skip") || lo.includes("nah") || lo.includes("none")) {
        ns = { ...ns, step: "CONFIRM", vded: 0 };
        reply = "Here's your booking summary:\n\n🛶 " + ns.tname + "\n📅 " + fmt(ns.slotTime) + "\n👥 " + ns.qty + " people\n💰 R" + ns.total + "\n\nLook good?";
        buttons = [{ label: "✅ Confirm" + (ns.total > 0 ? " & Pay R" + ns.total : " (FREE)"), value: "confirm" }, { label: "❌ Cancel", value: "cancel_booking" }];
      } else if (btnVal === "has_voucher") { ns.step = "ENTER_VOUCHER"; reply = "Type your 8-character voucher code:"; }
      else {
        const vc = msg.toUpperCase().replace(/\s/g, "");
        if (vc.length === 8) {
          // C2: Filter vouchers by business_id to prevent cross-tenant usage
          const { data: vd } = await db.from("vouchers").select("*").eq("code", vc).eq("business_id", requestedBusinessId).single();
          if (vd && vd.status === "ACTIVE") { const vv = Number(vd.current_balance || vd.value || vd.purchase_amount || 0); let dd = vv; if (vd.type === "FREE_TRIP") { const ftPax = Math.min(vd.pax_limit || 1, ns.qty); const ftSlotCost = ns.tprice * ftPax; const ftPurchaseVal = Number(vd.purchase_value || vd.purchase_amount || vd.value || 0); if (ftSlotCost > ftPurchaseVal) { dd = Math.min(ftPurchaseVal, ns.total); } else { dd = Math.min(vv, ftSlotCost, ns.total); } } else { dd = Math.min(vv, ns.total); } const nt = Math.max(0, ns.total - dd); ns = { ...ns, step: "CONFIRM", vcode: vc, vid: vd.id, vded: dd, total: nt, vtype: vd.type, vpaxlimit: vd.pax_limit || 1, vpurchasevalue: Number(vd.purchase_value || vd.purchase_amount || vd.value || 0) }; reply = "🎉 Voucher applied! R" + dd + " off." + (nt > 0 ? " New total: R" + nt : " It's completely FREE!") + "\n\n🛶 " + ns.tname + "\n📅 " + fmt(ns.slotTime) + "\n👥 " + ns.qty + " people\n💰 " + (nt > 0 ? "R" + nt : "FREE"); buttons = [{ label: "✅ Confirm" + (nt > 0 ? " & Pay R" + nt : " (FREE)"), value: "confirm" }, { label: "❌ Cancel", value: "cancel_booking" }]; }
          else if (vd && vd.status === "REDEEMED") { reply = "That voucher's already been used. Got another?"; buttons = [{ label: "No voucher — continue", value: "no_voucher" }]; }
          else { reply = "Can't find that code — double-check it?"; buttons = [{ label: "No voucher — continue", value: "no_voucher" }]; }
        } else { reply = "Voucher codes are 8 characters. Try again?"; buttons = [{ label: "No voucher — continue", value: "no_voucher" }]; }
      }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
    }
    // ===== ENTER_VOUCHER =====
    if (step === "ENTER_VOUCHER") {
      const noVc = lo.includes("no") || lo.includes("don") || lo.includes("skip") || lo.includes("continue") || lo.includes("dont") || lo.includes("nope") || lo.includes("none") || lo.includes("back") || lo.includes("without") || btnVal === "no_voucher";
      if (noVc) { ns = { ...ns, step: "CONFIRM" }; reply = "No problem! Here's your booking summary:\n\n" + ns.tname + "\n" + ns.qty + " people \u2022 R" + ns.total + "\n\nReady to confirm?"; buttons = [{ label: "\u2705 Confirm & Pay R" + ns.total, value: "confirm" }, { label: "\u274C Cancel", value: "cancel_booking" }]; return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) }); }
      const vc2 = msg.toUpperCase().replace(/\s/g, "");
      if (vc2.length === 8) {
        // C2: Filter vouchers by business_id to prevent cross-tenant usage
        const { data: vd2 } = await db.from("vouchers").select("*").eq("code", vc2).eq("business_id", requestedBusinessId).single();
        if (vd2 && vd2.status === "ACTIVE") { const vv2 = Number(vd2.current_balance || vd2.value || vd2.purchase_amount || 0); let dd2 = vv2; if (vd2.type === "FREE_TRIP") { const ft2Pax = Math.min(vd2.pax_limit || 1, ns.qty); const ft2SlotCost = ns.tprice * ft2Pax; const ft2PurchaseVal = Number(vd2.purchase_value || vd2.purchase_amount || vd2.value || 0); if (ft2SlotCost > ft2PurchaseVal) { dd2 = Math.min(ft2PurchaseVal, ns.total); } else { dd2 = Math.min(vv2, ft2SlotCost, ns.total); } } else { dd2 = Math.min(vv2, ns.total); } const nt2 = Math.max(0, ns.total - dd2); ns = { ...ns, step: "CONFIRM", vcode: vc2, vid: vd2.id, vded: dd2, total: nt2, vtype: vd2.type, vpaxlimit: vd2.pax_limit || 1, vpurchasevalue: Number(vd2.purchase_value || vd2.purchase_amount || vd2.value || 0) }; reply = "🎉 R" + dd2 + " off!" + (nt2 > 0 ? " Total now R" + nt2 : " FREE!") + "\n\nReady to confirm?"; buttons = [{ label: "✅ Confirm" + (nt2 > 0 ? " & Pay R" + nt2 : " (FREE)"), value: "confirm" }, { label: "❌ Cancel", value: "cancel_booking" }]; }
        else if (vd2 && vd2.status === "REDEEMED") { reply = "Already used. Got another?"; buttons = [{ label: "No voucher — continue", value: "no_voucher" }]; }
        else { reply = "Code not found. Check and try again?"; buttons = [{ label: "No voucher — continue", value: "no_voucher" }]; }
      } else { reply = "That doesn't look like a voucher code. Want to continue without one?"; buttons = [{ label: "No voucher \u2014 continue", value: "no_voucher" }, { label: "Try again", value: "btn:yes_voucher" }]; }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
    }
    // ===== CONFIRM =====
    if (step === "CONFIRM") {
      if (lo.includes("start over") || lo.includes("restart") || (lo.includes("back") && lo.includes("start"))) { ns = { step: "IDLE" }; reply = "No problem! What would you like to do?"; buttons = [{ label: "\u{1F6F6} Book a Tour", value: "btn:book" }, { label: "\u2753 Ask a Question", value: "btn:question" }]; return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) }); }

      if (btnVal === "confirm" || lo.includes("yes") || lo.includes("confirm") || lo.includes("go ahead") || lo.includes("sure") || lo.includes("yep")) {
        let ft = Number(ns.total || 0);
        const businessId = ns.bid || requestedBusinessId;
        // L1: Fetch meeting point dynamically from the business record.
        const { data: _tourData } = await db.from("tours").select("base_price_per_person, business_id").eq("id", ns.tid).eq("business_id", requestedBusinessId).maybeSingle();
        let meetingPointText = "";
        if (!meetingPointText) {
          const { data: _bizData } = await db.from("businesses").select("meeting_point_address, arrival_instructions").eq("id", businessId).maybeSingle();
          meetingPointText = [_bizData?.meeting_point_address, _bizData?.arrival_instructions].filter(Boolean).join("\n") || "Check your confirmation email for meeting point details";
        }

        // C1: Server-side price re-verification to prevent client state tampering
        let serverUnitPrice = Number(_tourData?.base_price_per_person || 0);
        // Check for slot-level price override (peak pricing)
        const { data: _slotData } = await db.from("slots").select("price_per_person_override,tour_id,status").eq("id", ns.slotId).eq("business_id", requestedBusinessId).maybeSingle();
        if (!_tourData || !_slotData || _slotData.tour_id !== ns.tid || _slotData.status !== "OPEN") {
          reply = "I couldn't verify that tour and time anymore. Please start again so I can give you the correct options.";
          ns = { step: "IDLE" };
          buttons = [{ label: "\u{1F6F6} Book a Tour", value: "btn:book" }, { label: "\u2753 Ask a Question", value: "btn:question" }];
          return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
        }
        if (_slotData?.price_per_person_override != null) {
          serverUnitPrice = Number(_slotData.price_per_person_override);
        }
        const priceCheck = verifyChatBookingPricing({
          quotedTotal: ft,
          qty: Number(ns.qty || 0),
          unitPrice: serverUnitPrice,
          voucherDeduction: ns.vid ? Number(ns.vded || 0) : 0,
        });
        if (!priceCheck.ok && priceCheck.reason === "INVALID_PRICE") {
          reply = "I couldn't verify the price for that tour. Please start again so I don't quote you incorrectly.";
          ns = { step: "IDLE" };
          buttons = [{ label: "\u{1F6F6} Book a Tour", value: "btn:book" }, { label: "\u2753 Ask a Question", value: "btn:question" }];
          return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
        }
        if (!priceCheck.ok && priceCheck.reason === "INVALID_QTY") {
          reply = "I couldn't verify the number of people for this booking. Please start again.";
          ns = { step: "IDLE" };
          buttons = [{ label: "\u{1F6F6} Book a Tour", value: "btn:book" }, { label: "\u2753 Ask a Question", value: "btn:question" }];
          return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
        }
        const serverBaseTotal = priceCheck.pricing?.baseTotal || 0;
        const serverDiscount = priceCheck.pricing?.discount || 0;
        const serverVded = priceCheck.pricing?.voucherDeduction || 0;
        const serverTotal = priceCheck.pricing?.total || 0;

        // H2: Re-validate voucher at finalization time
        if (ns.vid) {
          const { data: _voucherRecheck } = await db.from("vouchers").select("status, current_balance").eq("id", ns.vid).eq("business_id", requestedBusinessId).maybeSingle();
          if (!_voucherRecheck || _voucherRecheck.status !== "ACTIVE") {
            reply = "Sorry, your voucher is no longer valid. Please try again without a voucher.";
            ns = { ...ns, step: "ASK_VOUCHER", vid: null, vcode: null, vded: 0, total: serverBaseTotal - serverDiscount };
            buttons = [{ label: "No voucher \u2014 continue", value: "no_voucher" }, { label: "Yes, I have a code", value: "has_voucher" }];
            return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
          }
          if (Number(_voucherRecheck.current_balance) < serverVded) {
            reply = "Sorry, the voucher balance has changed. Please try applying your voucher again.";
            ns = { ...ns, step: "ASK_VOUCHER", vid: null, vcode: null, vded: 0, total: serverBaseTotal - serverDiscount };
            buttons = [{ label: "No voucher \u2014 continue", value: "no_voucher" }, { label: "Yes, I have a code", value: "has_voucher" }];
            return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
          }
        }

        // C1: Reject if server-calculated total differs from client total by more than R1
        if (!priceCheck.ok) {
          reply = "The price has changed since you started. The correct total is R" + serverTotal + ". Please review and confirm again.";
          ns = { ...ns, total: serverTotal, baseTotal: serverBaseTotal, discount: serverDiscount, tprice: serverUnitPrice, vded: serverVded };
          buttons = [{ label: "✅ Confirm" + (serverTotal > 0 ? " & Pay R" + serverTotal : " (FREE)"), value: "confirm" }, { label: "❌ Cancel", value: "cancel_booking" }];
          return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
        }
        // Use server-verified values for the booking
        ft = serverTotal;

        // L18: Store group discount fields; L20: Store total_captured/total_refunded
        const { data: bk } = await db.from("bookings").insert({ business_id: businessId, tour_id: ns.tid, slot_id: ns.slotId, customer_name: ns.name, phone: ns.phone || "", email: ns.email, qty: ns.qty, unit_price: serverUnitPrice, total_amount: ft, original_total: serverBaseTotal, discount_amount: serverDiscount, discount_type: serverDiscount > 0 ? "GROUP_5PCT" : null, total_captured: 0, total_refunded: 0, status: "PENDING", source: "WEB_CHAT", custom_fields: ns.custom_fields || {} }).select().single();
        if (!bk) { reply = "Something went wrong — try the Book Now page?"; ns = { step: "IDLE" }; }
        else if (ft <= 0) {
          // H1 (MVP fix): capacity check MUST run BEFORE voucher deduction.
          // Otherwise a sold-out slot would still drain the voucher balance.
          const voucherHoldRes = await db.rpc("create_hold_with_capacity_check", {
            p_booking_id: bk.id,
            p_slot_id: ns.slotId,
            p_qty: ns.qty,
            p_expires_at: new Date(now.getTime() + 2 * 60 * 1000).toISOString(),
          });
          if (voucherHoldRes.error || !voucherHoldRes.data?.success) {
            await db.from("bookings").update({ status: "CANCELLED", cancellation_reason: "No capacity" }).eq("id", bk.id);
            reply = voucherHoldRes.data?.error || "Sorry, those spots were just taken! Please try another time slot.";
            ns = { step: "IDLE" };
            return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
          }
          // Capacity reserved — now mark PAID + drain voucher
          await db.from("bookings").update({ status: "PAID", yoco_payment_id: "VOUCHER_CHAT", total_captured: ft }).eq("id", bk.id);
          if (ns.vid) {
            const chatDeductionAmount = Number(ns.vded || ns.baseTotal || ns.tprice * ns.qty || 0);
            const chatRpcRes = await db.rpc("deduct_voucher_balance", { p_voucher_id: ns.vid, p_amount: chatDeductionAmount });
            if (chatRpcRes.data?.success) {
              await db.from("vouchers").update({ redeemed_booking_id: bk.id }).eq("id", ns.vid);
            } else {
              await db.from("vouchers").update({ status: "REDEEMED", redeemed_at: now.toISOString(), redeemed_booking_id: bk.id }).eq("id", ns.vid);
            }
          }
          const waiverLink = await getBusinessWaiverLink(businessId, bk.id, bk.waiver_token);
          // Send booking confirmation email for voucher bookings
          const vRef = bk.id.substring(0, 8).toUpperCase();
          try { await fetch(SU + "/functions/v1/send-email", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK }, body: JSON.stringify({ type: "BOOKING_CONFIRM", data: { booking_id: bk.id, business_id: businessId, email: ns.email, customer_name: ns.name, ref: vRef, tour_name: ns.tname, start_time: fmtS(ns.slotTime), qty: ns.qty, total_amount: "FREE (voucher)" } }) }); } catch (e) { console.log("webchat voucher confirm email err"); }
          // Send WhatsApp confirmation if phone provided
          // L1: Use dynamic meeting point instead of hardcoded address
          const wcLoc = requestTenant?.business?.location_phrase; const wcWtb = requestTenant?.business?.what_to_bring;
          if (ns.phone) { try { await fetch(SU + "/functions/v1/send-whatsapp-text", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK }, body: JSON.stringify({ to: ns.phone, message: "\u{1F389} *Booking Confirmed!*\n\n\u{1F4CB} Ref: " + vRef + "\n\u{1F6F6} " + ns.tname + "\n\u{1F4C5} " + fmtS(ns.slotTime) + "\n\u{1F465} " + ns.qty + " people\n\u{1F39F} Paid with voucher\n" + (waiverLink ? "\n\u{1F4DD} Waiver: " + waiverLink + "\n" : "\n") + "\n\u{1F4CD} *Meeting Point:*\n" + meetingPointText + "\nArrive 15 min early\n" + (wcWtb ? "\n\u{1F392} *Bring:* " + wcWtb + "\n" : "") + "\n" + (wcLoc ? "See you " + wcLoc + "!" : "See you soon!") }) }); } catch (e) { console.log("webchat voucher wa err"); } }
          reply = "\u{1F389} You're booked!\n\nRef: " + vRef + "\nConfirmation email on its way.\n\n\u{1F4CD} " + meetingPointText + " \u2014 arrive 15 min early. " + (wcLoc ? "See you " + wcLoc + "!" : "See you soon!"); ns = { step: "IDLE" };
        } else {
          // Atomic capacity check + hold creation to prevent overbooking
          const holdRes = await db.rpc("create_hold_with_capacity_check", {
            p_booking_id: bk.id,
            p_slot_id: ns.slotId,
            p_qty: ns.qty,
            p_expires_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
          });
          if (holdRes.error || !holdRes.data?.success) {
            await db.from("bookings").update({ status: "CANCELLED", cancellation_reason: "No capacity" }).eq("id", bk.id);
            reply = holdRes.data?.error || "Sorry, those spots were just taken! Please try another time slot.";
            ns = { step: "IDLE" };
            return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons, paymentUrl: pay }), { status: 200, headers: gCors(req) });
          }
          await db.from("bookings").update({ status: "HELD" }).eq("id", bk.id);
          const bookingUrls = await getBusinessSiteUrls(businessId);
          const yr = await fetch(SU + "/functions/v1/create-checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK }, body: JSON.stringify({ amount: ft, booking_id: bk.id, business_id: businessId, type: "BOOKING" }) });
          const yd = await yr.json();
          if (yd && yd.redirectUrl) {
            await db.from("bookings").update({ yoco_checkout_id: yd.id }).eq("id", bk.id);
            pay = yd.redirectUrl;
            // M9: Generate waiver link for paid bookings
            const paidWaiverLink = await getBusinessWaiverLink(businessId, bk.id, bk.waiver_token);
            reply = "🙌 Spots held for 15 minutes!\n\nRef: " + bk.id.substring(0, 8).toUpperCase() + "\nClick below to complete payment." + (paidWaiverLink ? "\n\n📝 Please also complete your waiver: " + paidWaiverLink : "");
          }
          else { reply = "Payment link didn't work — try the Book Now page?"; }
          ns = { step: "IDLE" };
        }
      } else if (btnVal === "cancel_booking" || lo.includes("cancel") || lo.includes("nevermind")) {
        reply = pick(["No worries! Let me know if you need anything else 😊", "All good! Hit me up if you change your mind."]); ns = { step: "IDLE" };
      } else {
        reply = "Ready to go ahead?";
        buttons = [{ label: "✅ Confirm" + (ns.total > 0 ? " & Pay R" + ns.total : " (FREE)"), value: "confirm" }, { label: "❌ Cancel", value: "cancel_booking" }];
      }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons, paymentUrl: pay }), { status: 200, headers: gCors(req) });
    }
    // ===== LOOKUP =====
    if (step === "LOOKUP") {
      const em2 = lo.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      if (em2) {
        // L16: Only show bookings with actionable statuses (exclude CANCELLED, HELD, PENDING)
        const { data: bks } = await db.from("bookings").select("id, business_id, customer_name, email, phone, qty, total_amount, unit_price, status, refund_status, slot_id, tour_id, slots(start_time), tours(name)").eq("email", em2[0].toLowerCase()).eq("business_id", requestedBusinessId).in("status", ["PAID", "CONFIRMED", "COMPLETED"]).order("created_at", { ascending: false }).limit(5);
        const activeBks = bks || [];
        if (activeBks.length > 0) {
          reply = "Found your bookings:\n\n";
          for (const b of activeBks) {
            const bRef = b.id.substring(0, 8).toUpperCase();
            const bSlot: any = Array.isArray(b.slots) ? b.slots[0] : b.slots;
            const bTour: any = Array.isArray(b.tours) ? b.tours[0] : b.tours;
            const bTime = bSlot?.start_time ? fmtS(bSlot.start_time) : "?";
            reply += (bTour?.name || "Tour") + " \u2014 " + bTime + "\n" + b.qty + " people \u2014 " + b.status + "\nRef: " + bRef + "\n\n";
          }
          reply += "What would you like to do with your booking?";
          // M2: Show comprehensive action buttons based on booking timing
          const lookupB = activeBks[0];
          const lookupSlot: any = Array.isArray(lookupB?.slots) ? lookupB.slots[0] : lookupB?.slots;
          const lookupHrs = lookupSlot?.start_time ? (new Date(lookupSlot.start_time).getTime() - now.getTime()) / (1000 * 60 * 60) : 999;
          const lookupButtons: any[] = [];
          if (lookupHrs >= 24) {
            lookupButtons.push({ label: "📅 Reschedule", value: "btn:reschedule" });
            lookupButtons.push({ label: "❌ Cancel / Refund", value: "btn:cancel" });
            lookupButtons.push({ label: "👥 Edit Guests", value: "btn:edit guest" });
            lookupButtons.push({ label: "🔄 Change Tour", value: "btn:change tour" });
          } else if (lookupHrs >= 12) {
            lookupButtons.push({ label: "👥 Add Guests", value: "btn:add people" });
          }
          lookupButtons.push({ label: "✏️ Update Name", value: "btn:update name" });
          lookupButtons.push({ label: "📧 Resend Confirmation", value: "btn:resend confirmation email" });
          buttons = lookupButtons;
          ns = { step: "PICK_ACTION", bookings: activeBks };
        } else { reply = "No active bookings found under that email. Try a different one?"; }
      } else { reply = "What email did you use when you booked?"; }
      return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
    }
    // ===== PICK ACTION =====
    if (step === "PICK_ACTION") {
      const act = btnVal || lo;
      const b = ns.bookings?.[0]; // Default to most recent for now
      if (!b) { ns.step = "IDLE"; reply = "Something went wrong. Let's start over."; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }
      
      const hrs = b.slots?.start_time ? (new Date(b.slots.start_time).getTime() - now.getTime()) / (1000 * 60 * 60) : 999;
      
      if (act.includes("reschedule")) {
        if (hrs < 24) {
          reply = "Since your trip is in less than 24 hours, any changes need to be reviewed by our team. Would you like me to send a request to them?";
          buttons = [{ label: "✅ Send Review Request", value: "btn:req_reschedule" }, { label: "No, nevermind", value: "btn:cancel_action" }];
          ns = { ...ns, step: "REVIEW_REQUEST", booking: b, action: "reschedule" };
        } else {
          // M1: Fetch slots and show calendar for reschedule (was a dead end before)
          ns = { ...ns, step: "RESCH_DATE", booking_id: b.id, tour_id: b.tour_id, qty: b.qty };
          const reschSlots = await getSlots(b.tour_id, now);
          const reschFit = reschSlots.filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) >= (b.qty || 1); });
          if (reschFit.length > 0) {
            reply = "Pick a new time for your reschedule:";
            buttons = reschFit.slice(0, 10).map(function (s: any) { return { label: fmtS(s.start_time) + " (" + (s.capacity_total - s.booked - (s.held || 0)) + " spots)", value: s.id }; });
          } else {
            reply = "No available slots right now. Contact our team for assistance.";
            ns = { step: "IDLE" };
          }
          return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
        }
      } else if (act.includes("cancel") || act.includes("refund")) {
        if (hrs < 24) {
          reply = "Since your trip is in less than 24 hours, a refund isn't automatically available. Would you like me to ask our team to review this for you?";
          buttons = [{ label: "✅ Send Review Request", value: "btn:req_cancel" }, { label: "No, nevermind", value: "btn:cancel_action" }];
          ns = { ...ns, step: "REVIEW_REQUEST", booking: b, action: "cancel/refund" };
        } else {
          const refAmt = Math.round(b.total_amount * 0.95 * 100) / 100;
          reply = "Cancel your booking for " + b.qty + " people? You'll receive a 95% refund (R" + refAmt + ").";
          buttons = [{ label: "✅ Yes, Cancel", value: "btn:confirm_cancel" }, { label: "No, keep it", value: "btn:cancel_action" }];
          ns = { ...ns, step: "CONFIRM_CANCEL", booking_id: b.id, qty: b.qty, refund: refAmt, hours: hrs, slot_id: b.slot_id };
        }
      }
      // M2: Handle all unreachable states — Edit Guests, Update Name, Resend Confirmation, Change Tour
      else if (act.includes("edit") && act.includes("guest") || act.includes("modify") && act.includes("qty") || act.includes("change") && act.includes("people") || act.includes("add") && act.includes("people") || act.includes("remove") && act.includes("people")) {
        if (hrs < 12) {
          reply = "Changes to guest numbers aren't available within 12 hours of the trip. Contact our team for help.";
          ns = { step: "IDLE" };
        } else if (hrs < 24) {
          // 12-24h: can only add, not remove
          const { data: mqSc } = await db.rpc("slot_available_capacity", { p_slot_id: b.slot_id });
          ns = { ...ns, step: "MODIFY_QTY", booking_id: b.id, slot_id: b.slot_id, current_qty: b.qty, unit_price: b.total_amount / b.qty, max_avail: b.qty + Number(mqSc || 0), hours_before: hrs, add_only: true };
          reply = "Your booking currently has " + b.qty + " people. You can add more guests (removal not available within 24 hours). How many total?";
        } else {
          const { data: mqSc2 } = await db.rpc("slot_available_capacity", { p_slot_id: b.slot_id });
          ns = { ...ns, step: "MODIFY_QTY", booking_id: b.id, slot_id: b.slot_id, current_qty: b.qty, unit_price: b.total_amount / b.qty, max_avail: b.qty + Number(mqSc2 || 0), hours_before: hrs, add_only: false };
          reply = "Your booking currently has " + b.qty + " people. How many should it be?";
        }
      }
      else if (act.includes("update") && act.includes("name") || act.includes("change") && act.includes("name")) {
        ns = { ...ns, step: "UPDATE_NAME", booking_id: b.id };
        reply = "What should the new name on the booking be?";
      }
      else if (act.includes("resend") || act.includes("confirmation") && act.includes("email")) {
        ns = { ...ns, step: "RESEND_CONFIRM", booking_id: b.id, bid: b.business_id, email: b.email, customer_name: b.customer_name };
        reply = "Want me to resend the confirmation email?";
        buttons = [{ label: "✅ Resend Email", value: "resend_email" }, { label: "No thanks", value: "btn:cancel_action" }];
      }
      else if (act.includes("change") && act.includes("tour") || act.includes("switch") && act.includes("tour") || act.includes("different") && act.includes("tour")) {
        if (hrs < 24) {
          reply = "Tour changes aren't available within 24 hours. Contact our team.";
          ns = { step: "IDLE" };
        } else {
          ns = { ...ns, step: "CHANGE_TOUR", booking_id: b.id, slot_id: b.slot_id, tour_id: b.tour_id, qty: b.qty };
          reply = "Which tour would you like to switch to?";
          buttons = tours.filter(function (t: any) { return t.id !== b.tour_id; }).map(function (t: any) { return { label: t.name + " — R" + t.base_price_per_person, value: "chtour_" + t.id }; });
        }
      }
      else {
        // M2: Show all available actions based on booking state
        reply = "What would you like to do with your booking?";
        const actionButtons: any[] = [];
        if (hrs >= 24) {
          actionButtons.push({ label: "📅 Reschedule", value: "btn:reschedule" });
          actionButtons.push({ label: "❌ Cancel / Refund", value: "btn:cancel" });
          actionButtons.push({ label: "👥 Edit Guests", value: "btn:edit guest" });
          actionButtons.push({ label: "🔄 Change Tour", value: "btn:change tour" });
        } else if (hrs >= 12) {
          actionButtons.push({ label: "👥 Add Guests", value: "btn:add people" });
        }
        actionButtons.push({ label: "✏️ Update Name", value: "btn:update name" });
        actionButtons.push({ label: "📧 Resend Confirmation", value: "btn:resend confirmation email" });
        buttons = actionButtons;
      }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
    }

    // ===== REVIEW REQUEST =====
    if (step === "REVIEW_REQUEST") {
      if (btnVal.startsWith("req_") || lo.includes("yes") || lo.includes("send")) {
        const rb = ns.booking;
        const rRef = (rb.id || "").substring(0, 8).toUpperCase();
        const rType = ns.action || "change";
        reply = "Request sent! \u2705 I've notified our team that you'd like to " + rType + " your booking *" + rRef + "*. They will review it and get back to you shortly.";
        // Log for admin
        const adminMsg = `[URGENT] Website chat request to ${rType.toUpperCase()} booking ${rRef}. Customer: ${rb.customer_name}`;
        // L2: Use requestedBusinessId instead of hardcoded UUID
        await db.from("chat_messages").insert({ business_id: rb.business_id || requestedBusinessId, phone: rb.phone, direction: "IN", body: adminMsg, sender: rb.customer_name });
        ns = { step: "IDLE" };
      } else { reply = "No problem! Anything else I can help with?"; ns = { step: "IDLE" }; }
      return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
    }

    // ===== RESCHEDULE DATE PICK =====
    if (step === "RESCH_DATE") {
      const rsId = btnVal || "";
      if (!rsId) { reply = "Please pick a date from the calendar above."; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }
      const { data: rsSlot } = await db.from("slots").select("id,start_time,booked").eq("id", rsId).single();
      if (!rsSlot) { reply = "Couldn\u2019t find that slot. Try again."; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }

      const { data: rbData, error: rbErr } = await db.functions.invoke("rebook-booking", {
        body: { booking_id: ns.booking_id, new_slot_id: rsId, excess_action: "VOUCHER" }
      });
      if (rbErr || rbData?.error) { reply = "Something went wrong changing your booking. Contact our team."; ns = { step: "IDLE" }; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }

      const rsLoc = requestTenant?.business?.location_phrase;
      reply = "\u2705 Rescheduled to " + fmt(rsSlot.start_time) + "!\n\n" + (rsLoc ? "See you " + rsLoc + "!" : "See you soon!");
      if (rbData?.diff > 0) {
        reply = "\u2705 Timeslot updated!\n\nAs this was more expensive, you have a balance of R" + rbData.diff + ". Please pay using the link below:";
        pay = rbData.payment_url;
      }
      ns = { step: "IDLE" }; buttons = [{ label: "\u{1F6F6} Book Another", value: "btn:book" }];
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons, paymentUrl: pay }), { status: 200, headers: gCors(req) });
    }

    // ===== CONFIRM CANCEL =====
    if (step === "CONFIRM_CANCEL") {
      if (btnVal === "confirm_cancel" || lo.includes("yes") || lo.includes("cancel")) {
        await db.from("bookings").update({ status: "CANCELLED", cancellation_reason: "Customer request via web chat", cancelled_at: new Date().toISOString(), refund_status: ns.hours >= 24 ? "REQUESTED" : "NONE", refund_amount: ns.refund || 0 }).eq("id", ns.booking_id);
        // L14: Release capacity immediately on cancellation so the slot is available for others.
        // The refund processor handles payment reversal separately from capacity management.
        const { data: cSl } = await db.from("slots").select("booked").eq("id", ns.slot_id).single();
        if (cSl) await db.from("slots").update({ booked: Math.max(0, cSl.booked - ns.qty) }).eq("id", ns.slot_id);
        reply = ns.hours >= 24 ? "Booking cancelled. A refund request of R" + ns.refund + " has been sent to our team for approval \u2705 Once approved, you can expect it in 5-7 business days." : "Booking cancelled. As this was within 24 hours, no refund applies.";
        reply += "\n\nWe\u2019d love to have you back! Type *book* anytime \u{1F30A}";
      } else { reply = "No problem, your booking is safe! \u{1F44D}"; }
      ns = { step: "IDLE" }; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
    }

    // ===== MODIFY QTY =====
    if (step === "MODIFY_QTY") {
      const newQ = parseInt(msg);
      if (isNaN(newQ) || newQ < 1 || newQ > 30) { reply = "Please enter a number between 1 and 30."; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }
      if (newQ === ns.current_qty) { reply = "That\u2019s the same! No changes needed \u{1F60A}"; ns = { step: "IDLE" }; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }
      if (newQ > ns.max_avail) { reply = "Only " + ns.max_avail + " spots available. Try a smaller number."; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }
      // M2: Enforce add-only restriction within 12-24h window
      if (ns.add_only && newQ < ns.current_qty) { reply = "Within 24 hours of the trip, you can only add guests, not remove them. Current: " + ns.current_qty + " people."; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }
      const qDiff = newQ - ns.current_qty; const newTot = newQ * Number(ns.unit_price); const diffAmt = Math.abs(newTot - ns.current_qty * Number(ns.unit_price));
      // M8: When qty increases, invalidate waiver so a new one must be signed
      const mqUpdateFields: any = { qty: newQ, total_amount: newTot };
      if (qDiff > 0) {
        mqUpdateFields.waiver_status = "PENDING";
        mqUpdateFields.waiver_token = crypto.randomUUID();
      }
      await db.from("bookings").update(mqUpdateFields).eq("id", ns.booking_id);
      const { data: mqSl } = await db.from("slots").select("booked").eq("id", ns.slot_id).single();
      if (mqSl) await db.from("slots").update({ booked: Math.max(0, mqSl.booked + qDiff) }).eq("id", ns.slot_id);
      if (qDiff > 0) {
        try {
          const bookingMeta = await db.from("bookings").select("business_id").eq("id", ns.booking_id).maybeSingle();
          const addUrls = await getBusinessSiteUrls(bookingMeta.data?.business_id);
          const addPay = await fetch(SU + "/functions/v1/create-checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK }, body: JSON.stringify({ amount: diffAmt, booking_id: ns.booking_id, business_id: bookingMeta.data?.business_id || "", type: "ADD_PEOPLE" }) });
          const addD = await addPay.json();
          if (addD?.redirectUrl) { pay = addD.redirectUrl; reply = "Updated to " + newQ + " people! Pay the extra R" + diffAmt + " to confirm:"; }
          else { reply = "Updated to " + newQ + " people! Contact us to arrange the extra R" + diffAmt + "."; }
        } catch (e) { reply = "Updated but payment link failed."; }
      } else {
        if (ns.hours_before >= 24) { await db.from("bookings").update({ refund_status: "REQUESTED", refund_amount: diffAmt }).eq("id", ns.booking_id); reply = "Updated to " + newQ + " people! A refund request of R" + diffAmt + " has been submitted for approval \u2705 Expect it in 5-7 business days once approved."; }
        else { reply = "Updated to " + newQ + " people! Refund policy applies for the difference."; }
      }
      ns = { step: "IDLE" }; return new Response(JSON.stringify({ reply: reply, state: ns, paymentUrl: pay }), { status: 200, headers: gCors(req) });
    }

    // ===== CHANGE TOUR =====
    if (step === "CHANGE_TOUR") {
      const ctId = btnVal ? btnVal.replace("chtour_", "") : "";
      const ctTour = tours.find(function (t: any) { return t.id === ctId; });
      if (!ctTour) { reply = "Please pick a tour."; return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) }); }
      const ctSlots = await getSlots(ctId, now); const ctFit = ctSlots.filter(function (s: any) { return s.capacity_total - s.booked - (s.held || 0) >= ns.qty; });
      if (ctFit.length === 0) { reply = "No available slots for " + ctTour.name + ". Contact our team."; ns = { step: "IDLE" }; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }
      reply = "Switching to *" + ctTour.name + "* (R" + ctTour.base_price_per_person + "/pp). Pick a date:";
      calendar = { slots: ctFit.map(function (s: any) { return { id: s.id, start_time: s.start_time, spots: s.capacity_total - s.booked - (s.held || 0) }; }) };
      ns = { step: "CHANGE_TOUR_SLOT", booking_id: ns.booking_id, slot_id: ns.slot_id, tour_id: ns.tour_id, qty: ns.qty, new_tour_id: ctId, new_tour_name: ctTour.name, new_price: ctTour.base_price_per_person };
      return new Response(JSON.stringify({ reply: reply, state: ns, calendar: calendar }), { status: 200, headers: gCors(req) });
    }

    // ===== CHANGE TOUR SLOT =====
    if (step === "CHANGE_TOUR_SLOT") {
      const ctsId = btnVal || "";
      const { data: ctsSl } = await db.from("slots").select("id,start_time,booked").eq("id", ctsId).single();
      if (!ctsSl) { reply = "Please pick a slot."; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }

      const { data: rbData2, error: rbErr2 } = await db.functions.invoke("rebook-booking", {
        body: { booking_id: ns.booking_id, new_slot_id: ctsId, excess_action: "VOUCHER" }
      });
      if (rbErr2 || rbData2?.error) { reply = "Something went wrong changing your tour. Contact our team."; ns = { step: "IDLE" }; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }

      const ctsLoc = requestTenant?.business?.location_phrase;
      reply = "\u2705 Switched to *" + ns.new_tour_name + "* on " + fmt(ctsSl.start_time) + "!\n\n" + (ctsLoc ? "See you " + ctsLoc + "!" : "See you soon!");
      if (rbData2?.diff > 0) {
        reply = "\u2705 Tour switched!\n\nAs this tour is more expensive, you have a balance of R" + rbData2.diff + ". Please pay using the link below:";
        pay = rbData2.payment_url;
      }
      ns = { step: "IDLE" }; return new Response(JSON.stringify({ reply: reply, state: ns, paymentUrl: pay }), { status: 200, headers: gCors(req) });
    }

    // ===== UPDATE NAME =====
    if (step === "UPDATE_NAME") {
      if (msg.trim().length < 2) { reply = "Please enter the new name:"; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) }); }
      await db.from("bookings").update({ customer_name: msg.trim() }).eq("id", ns.booking_id);
      reply = "Updated! Booking is now under *" + msg.trim() + "* \u2705";
      ns = { step: "IDLE" }; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
    }

    // ===== RESEND CONFIRM =====
    if (step === "RESEND_CONFIRM") {
      if (btnVal === "resend_email" || lo.includes("yes") || lo.includes("resend")) {
        try {
          await fetch(SU + "/functions/v1/send-email", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK }, body: JSON.stringify({ type: "BOOKING_CONFIRM", data: { booking_id: ns.booking_id, business_id: ns.bid || tours[0]?.business_id, email: ns.email, customer_name: ns.customer_name, ref: ns.booking_id.substring(0, 8).toUpperCase() } }) });
          reply = "Sent! Check your inbox and spam folder \u2709\uFE0F";
        } catch (e) { reply = "Something went wrong. Please try again."; }
      } else { reply = "No problem!"; }
      ns = { step: "IDLE" }; return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
    }

    // ===== GIFT VOUCHER FLOW =====
    if (step === "GIFT_PICK_TOUR") {
      let gPicked: any = null;
      if (isBtnClick) gPicked = tours.find(function (t) { return t.id === btnVal; });
      else { for (const gt of tours) { if ((lo.includes("sea") || lo.includes("morning") || lo.includes("kayak")) && gt.name.includes("Sea")) gPicked = gt; if ((lo.includes("sunset") || lo.includes("evening")) && gt.name.includes("Sunset")) gPicked = gt; } }
      if (gPicked) { ns = { step: "GIFT_RECIPIENT", gtid: gPicked.id, gtname: gPicked.name, gtprice: gPicked.base_price_per_person, gbid: gPicked.business_id }; reply = "" + gPicked.name + " voucher (R" + gPicked.base_price_per_person + ") \u2014 great choice! Who is it for? (Their name)"; }
      else { reply = "Which tour? " + tours.map(function(t) { return t.name; }).join(" or ") + "?"; buttons = tours.map(function (gt2) { return { label: gt2.name + " \u2014 R" + gt2.base_price_per_person, value: gt2.id }; }); }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
    }
    if (step === "GIFT_RECIPIENT") {
      if (msg.trim().length >= 2) { ns = { ...ns, step: "GIFT_MESSAGE", grecipient: msg.trim() }; reply = "Nice! Want to add a personal message? Or say skip."; }
      else { reply = "What\u2019s the recipient\u2019s name?"; }
      return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
    }
    if (step === "GIFT_MESSAGE") {
      const gmsg = lo.includes("skip") || lo.includes("no") ? "" : msg.trim();
      ns = { ...ns, step: "GIFT_BUYER_NAME", gmessage: gmsg };
      reply = "And your name? (The person buying the voucher)";
      return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
    }
    if (step === "GIFT_BUYER_NAME") {
      if (msg.trim().length >= 2) { ns = { ...ns, step: "GIFT_BUYER_EMAIL", gbuyername: msg.trim() }; reply = "Your email? We\u2019ll send the voucher there."; }
      else { reply = "What\u2019s your name?"; }
      return new Response(JSON.stringify({ reply: reply, state: ns }), { status: 200, headers: gCors(req) });
    }
    if (step === "GIFT_BUYER_EMAIL") {
      const gem = lo.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      if (gem) {
        ns = { ...ns, step: "GIFT_CONFIRM", gbuyeremail: gem[0] };
        reply = "Here\u2019s the voucher summary:\n\n\ud83c\udf81 " + ns.gtname + " Voucher\n\ud83d\udc64 For: " + ns.grecipient + "\n" + (ns.gmessage ? "\ud83d\udcac \"" + ns.gmessage + "\"\n" : "") + "\ud83d\udcb0 R" + ns.gtprice + "\n\nReady to purchase?";
        buttons = [{ label: "\u2705 Purchase R" + ns.gtprice, value: "gift_confirm" }, { label: "\u274c Cancel", value: "cancel_booking" }];
      } else { reply = "That doesn\u2019t look right \u2014 try your email again?"; }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons }), { status: 200, headers: gCors(req) });
    }
    if (step === "GIFT_CONFIRM") {
      if (btnVal === "gift_confirm" || lo.includes("yes") || lo.includes("confirm") || lo.includes("sure") || lo.includes("yep")) {
        let vcode = Array.from({ length: 8 }, function () { return "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]; }).join("");
        // Retry on unique constraint violation (code collision)
        let gv: any = null;
        for (let _retry = 0; _retry < 5; _retry++) {
          if (_retry > 0) vcode = Array.from({ length: 8 }, function () { return "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]; }).join("");
          const _ins = await db.from("vouchers").insert({ business_id: ns.gbid, code: vcode, status: "PENDING", type: "FREE_TRIP", value: ns.gtprice, purchase_amount: ns.gtprice, current_balance: ns.gtprice, recipient_name: ns.grecipient, gift_message: ns.gmessage || null, buyer_name: ns.gbuyername, buyer_email: ns.gbuyeremail, tour_name: ns.gtname, expires_at: new Date(now.getTime() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString() }).select().single();
          if (!_ins.error) { gv = _ins.data; break; }
          if (_ins.error.code !== "23505") break;
        }
        if (gv) {
          const giftUrls = await getBusinessSiteUrls(ns.gbid);
          const gyr = await fetch(SU + "/functions/v1/create-checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK }, body: JSON.stringify({ amount: ns.gtprice, business_id: ns.gbid, voucher_id: gv.id, voucher_code: vcode, type: "GIFT_VOUCHER" }) });
          const gyd = await gyr.json();
          if (gyd && gyd.redirectUrl) { await db.from("vouchers").update({ yoco_checkout_id: gyd.id }).eq("id", gv.id); pay = gyd.redirectUrl; reply = "\ud83c\udf81 Voucher created! Click below to pay R" + ns.gtprice + ".\n\nOnce paid, we\u2019ll email the voucher to " + ns.gbuyeremail + " \u2709\ufe0f"; }
          else { reply = "Payment link didn\u2019t work \u2014 try the Gift Voucher page on the website?"; }
        } else { reply = "Something went wrong. Try the Gift Voucher page?"; }
        ns = { step: "IDLE" };
      } else if (btnVal === "cancel_booking" || lo.includes("cancel")) { reply = "No worries!"; ns = { step: "IDLE" }; }
      else { reply = "Ready to purchase?"; buttons = [{ label: "\u2705 Purchase R" + ns.gtprice, value: "gift_confirm" }, { label: "\u274c Cancel", value: "cancel_booking" }]; }
      return new Response(JSON.stringify({ reply: reply, state: ns, buttons: buttons, paymentUrl: pay }), { status: 200, headers: gCors(req) });
    }
    // ===== INTENT CLASSIFICATION + FALLBACK =====
    const businessName = getBusinessDisplayName(requestTenant?.business) || "Tour Business";
    const classification = await classifyIntent(msg, businessName);
    const priority = priorityForIntent(classification.intent);

    // Log classification to chat_messages for analytics
    if (classification.intent !== "OTHER" || classification.confidence > 0) {
      db.from("chat_messages").insert({
        business_id: requestedBusinessId,
        phone: state.phone || body.phone || "web",
        direction: "IN",
        body: msg,
        sender: body.name || "Website visitor",
        sender_type: "CUSTOMER",
        intent: classification.intent,
        intent_confidence: classification.confidence,
        classification_model: classification.model,
        classification_ms: classification.ms,
      }).then(() => {});
    }

    // Update conversation intent if we have one
    if (state.convo_id) {
      db.from("conversations").update({
        current_intent: classification.intent,
        priority,
        last_classified_at: new Date().toISOString(),
      }).eq("id", state.convo_id).then(() => {});
    }

    // Auto-reply: MARKETING_OPTOUT
    if (classification.intent === "MARKETING_OPTOUT" && classification.confidence >= 0.7) {
      if (body.email) {
        await db.from("customers").update({ marketing_consent: false })
          .eq("business_id", requestedBusinessId)
          .ilike("email", body.email);
      }
      reply = "You've been unsubscribed from marketing messages. We'll only contact you about your bookings.";
      ns = { step: "IDLE" };
      return new Response(JSON.stringify({ reply, state: ns, intent: classification.intent }), { status: 200, headers: gCors(req) });
    }

    // Auto-reply: FAQ-type intents with high confidence
    if (["BOOKING_QUESTION", "LOGISTICS", "BOOKING_MODIFY"].includes(classification.intent) && classification.confidence >= 0.75) {
      const faqAnswer = await findFaqMatch(db, requestedBusinessId, classification.intent, msg);
      if (faqAnswer) {
        // Log the auto-reply
        db.from("chat_messages").insert({
          business_id: requestedBusinessId,
          phone: state.phone || body.phone || "web",
          direction: "OUT",
          body: faqAnswer,
          sender: "Bot",
          sender_type: "BOT",
          auto_replied: true,
          intent: classification.intent,
        }).then(() => {});
        return new Response(JSON.stringify({ reply: faqAnswer, state: { step: "IDLE" }, intent: classification.intent, autoReplied: true }), { status: 200, headers: gCors(req) });
      }
    }

    // Standard Gemini fallback
    const gem2 = await gemChat(hist, msg, tours, requestedBusinessId || tours[0]?.business_id);
    reply = gem2 || "Hey! Need help booking or got a question?";
    ns = { step: "IDLE" };
    return new Response(JSON.stringify({ reply: reply, state: ns, intent: classification.intent }), { status: 200, headers: gCors(req) });
  } catch (err) { console.error("ERR:", err); return new Response(JSON.stringify({ reply: "Ah sorry, try that again?", state: { step: "IDLE" } }), { status: 500, headers: gCors(req) }); }
}));
