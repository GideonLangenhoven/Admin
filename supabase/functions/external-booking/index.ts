import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SIGNATURE_WINDOW_SECONDS = 300;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Json = Record<string, unknown>;

type TourRecord = {
  id: string;
  business_id: string;
  name: string;
  base_price_per_person: number | null;
};

type SlotRecord = {
  id: string;
  business_id: string;
  tour_id: string;
  start_time: string;
  status: string;
  capacity_total: number;
  booked: number;
  held: number | null;
  price_per_person_override: number | null;
};

type BookingRecord = {
  id: string;
  business_id: string;
  tour_id: string;
  slot_id: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  qty: number;
  total_amount: number | null;
  status: string;
  source: string;
  external_ref: string | null;
  slots?: { start_time?: string } | { start_time?: string }[] | null;
};

type LogRecord = {
  id: string;
  retry_count: number;
  event_id: string;
};

type CredentialRecord = {
  id: string;
  business_id: string;
  source: string;
  api_key_hash: string;
  api_key_last4: string | null;
  hmac_secret: string | null;
  active: boolean;
};

type VerifyAuthSuccess = {
  ok: true;
  authMode: string;
  businessId: string;
  credentialId: string;
};

type VerifyAuthFailure = {
  ok: false;
  code: string;
  message: string;
  businessId?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key, x-timestamp, x-signature, x-event-id, x-source",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function formatInTimezone(iso: string, locale: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(iso));
}

function respond(status: number, body: Json) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function asJsonRecord(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Json;
}

function sanitizeBody(body: unknown): Json {
  return { ...asJsonRecord(body) };
}

function normalizeSource(req: Request, body: Json): string {
  const headerSource = req.headers.get("x-source");
  if (headerSource?.trim()) return headerSource.trim().toUpperCase();
  return String(body.source || "").trim().toUpperCase();
}

function normalizeAction(input: unknown, body: Json): string {
  const raw = String(input || body.action || body.type || body.event || "").trim().toLowerCase();
  if (raw === "availability" || raw === "check_availability" || raw === "check-availability") return "check_availability";
  if (raw === "create" || raw === "create_booking" || raw === "book" || raw === "booking") return "create_booking";
  if (raw === "cancel" || raw === "cancel_booking" || raw === "cancel-booking") return "cancel_booking";
  if (raw === "modify" || raw === "modify_booking" || raw === "update" || raw === "update_booking") return "modify_booking";

  if (String(body.status || "").trim().toUpperCase() === "CANCELLED") return "cancel_booking";
  if (body.new_date || body.new_time || body.new_slot_id || body.new_qty || body.new_tour_id || body.new_tour_name) return "modify_booking";
  return "create_booking";
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

function normalizePhone(value: unknown): string | null {
  if (!value) return null;
  var digits = String(value).replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = "27" + digits.substring(1);
  return digits;
}

function normalizeDate(value: unknown): string | null {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function normalizeTime(value: unknown): string | null {
  const input = String(value || "").trim();
  if (!input) return null;
  const match = input.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeMoney(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function slotLocalDate(slot: SlotRecord, timezone: string): string {
  return formatInTimezone(slot.start_time, "en-CA", timezone, { year: "numeric", month: "2-digit", day: "2-digit" });
}

function slotLocalTime(slot: SlotRecord, timezone: string): string {
  return formatInTimezone(slot.start_time, "en-GB", timezone, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function slotSummary(slot: SlotRecord, timezone: string) {
  const available = Math.max(Number(slot.capacity_total || 0) - Number(slot.booked || 0) - Number(slot.held || 0), 0);
  return {
    slot_id: slot.id,
    start_time_utc: slot.start_time,
    start_time_local: formatInTimezone(slot.start_time, "en-ZA", timezone, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
    date: slotLocalDate(slot, timezone),
    time: slotLocalTime(slot, timezone),
    status: slot.status,
    capacity_total: Number(slot.capacity_total || 0),
    booked: Number(slot.booked || 0),
    held: Number(slot.held || 0),
    available,
  };
}

function pickFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function getRequestApiKey(req: Request): string {
  const headerKey = req.headers.get("x-api-key");
  if (headerKey) return headerKey.trim();
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim();
  return "";
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function findCredentialByApiKey(source: string, apiKey: string): Promise<CredentialRecord | null> {
  const apiKeyHash = await sha256Hex(apiKey);
  const { data, error } = await db
    .from("external_booking_credentials")
    .select("id, business_id, source, api_key_hash, api_key_last4, hmac_secret, active")
    .eq("source", source)
    .eq("api_key_hash", apiKeyHash)
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  return (data as CredentialRecord | null) || null;
}

async function verifyAuth(req: Request, source: string, rawBody: string): Promise<VerifyAuthSuccess | VerifyAuthFailure> {
  const apiKey = getRequestApiKey(req);
  if (!apiKey) return { ok: false, code: "MISSING_API_KEY", message: "x-api-key header is required" };

  const credential = await findCredentialByApiKey(source, apiKey);
  if (!credential) return { ok: false, code: "INVALID_API_KEY", message: "Invalid API key" };

  const hmacSecret = credential.hmac_secret || "";
  if (!hmacSecret) {
    return { ok: true, authMode: "api_key", businessId: credential.business_id, credentialId: credential.id };
  }

  const timestampHeader = req.headers.get("x-timestamp") || "";
  const signatureHeader = (req.headers.get("x-signature") || "").trim();
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, code: "MISSING_SIGNATURE", message: "x-timestamp and x-signature headers are required", businessId: credential.business_id };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, code: "INVALID_TIMESTAMP", message: "x-timestamp must be a unix timestamp in seconds", businessId: credential.business_id };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_WINDOW_SECONDS) {
    return { ok: false, code: "STALE_SIGNATURE", message: "Signature timestamp is outside the accepted replay window", businessId: credential.business_id };
  }

  const provided = signatureHeader.toLowerCase().startsWith("sha256=") ? signatureHeader.slice(7).toLowerCase() : signatureHeader.toLowerCase();
  const expected = await hmacSha256Hex(hmacSecret, `${timestampHeader}.${rawBody}`);
  if (!safeEqual(provided, expected)) {
    return { ok: false, code: "INVALID_SIGNATURE", message: "Invalid request signature", businessId: credential.business_id };
  }

  return { ok: true, authMode: "api_key+hmac", businessId: credential.business_id, credentialId: credential.id };
}

async function getTourById(businessId: string, tourId: string): Promise<TourRecord | null> {
  const { data, error } = await db
    .from("tours")
    .select("id, business_id, name, base_price_per_person")
    .eq("business_id", businessId)
    .eq("id", tourId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as TourRecord | null) || null;
}

async function resolveTour(businessId: string, source: string, body: Json): Promise<TourRecord | null> {
  const directTourId = String(body.tour_id || body.new_tour_id || "").trim();
  if (directTourId) return await getTourById(businessId, directTourId);

  const mappingCandidates = [
    ["external_product_id", String(body.external_product_id || "").trim()],
    ["external_product_code", String(body.external_product_code || "").trim()],
  ] as const;

  for (const [column, value] of mappingCandidates) {
    if (!value) continue;
    const { data, error } = await db
      .from("external_product_mappings")
      .select("tour_id")
      .eq("business_id", businessId)
      .eq("source", source)
      .eq("active", true)
      .eq(column, value)
      .maybeSingle();
    if (error) throw error;
    const tourId = String((data as { tour_id?: string } | null)?.tour_id || "").trim();
    if (tourId) return await getTourById(businessId, tourId);
  }

  const mappedName = String(body.external_product_name || body.new_tour_name || body.tour_name || "").trim();
  if (mappedName) {
    const { data: mapped, error: mappingError } = await db
      .from("external_product_mappings")
      .select("tour_id")
      .eq("business_id", businessId)
      .eq("source", source)
      .eq("active", true)
      .ilike("external_product_name", mappedName)
      .maybeSingle();
    if (mappingError) throw mappingError;
    const mappedTourId = String((mapped as { tour_id?: string } | null)?.tour_id || "").trim();
    if (mappedTourId) return await getTourById(businessId, mappedTourId);

    const { data: tour, error: tourError } = await db
      .from("tours")
      .select("id, business_id, name, base_price_per_person")
      .eq("business_id", businessId)
      .eq("active", true)
      .ilike("name", mappedName)
      .maybeSingle();
    if (tourError) throw tourError;
    if (tour) return tour as TourRecord;
  }

  return null;
}

async function getBusinessTimezone(businessId: string): Promise<string> {
  const { data, error } = await db.from("businesses").select("timezone").eq("id", businessId).maybeSingle();
  if (error) throw error;
  return String(data?.timezone || "UTC");
}

async function fetchOpenSlotsForTour(businessId: string, tourId: string, date?: string, timezone = "UTC"): Promise<SlotRecord[]> {
  let query = db
    .from("slots")
    .select("id, business_id, tour_id, start_time, status, capacity_total, booked, held, price_per_person_override")
    .eq("business_id", businessId)
    .eq("tour_id", tourId)
    .eq("status", "OPEN")
    .order("start_time", { ascending: true });

  if (date) {
    const start = new Date(`${date}T00:00:00`);
    const startUtc = new Date(new Date(start.toLocaleString("en-US", { timeZone: timezone })).getTime() - new Date().getTimezoneOffset() * 60000);
    const end = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
    query = query.gte("start_time", startUtc.toISOString()).lt("start_time", end.toISOString());
  } else {
    query = query.gt("start_time", new Date().toISOString()).limit(20);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as SlotRecord[];
}

async function findSlotById(businessId: string, slotId: string, requireOpen: boolean): Promise<SlotRecord | null> {
  let query = db
    .from("slots")
    .select("id, business_id, tour_id, start_time, status, capacity_total, booked, held, price_per_person_override")
    .eq("business_id", businessId)
    .eq("id", slotId);
  if (requireOpen) query = query.eq("status", "OPEN");
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as SlotRecord | null) || null;
}

async function resolveSlot(businessId: string, tourId: string, payload: Json, mode: "create" | "modify", timezone = "UTC"): Promise<SlotRecord | null> {
  const slotId = String(payload[mode === "modify" ? "new_slot_id" : "slot_id"] || "").trim();
  if (slotId) {
    const slot = await findSlotById(businessId, slotId, true);
    if (!slot || slot.tour_id !== tourId) return null;
    return slot;
  }

  const date = normalizeDate(payload[mode === "modify" ? "new_date" : "date"]);
  const time = normalizeTime(payload[mode === "modify" ? "new_time" : "time"]);
  if (!date) return null;

  const slots = await fetchOpenSlotsForTour(businessId, tourId, date, timezone);
  if (!time) return slots.length === 1 ? slots[0] : null;
  return slots.find((slot) => slotLocalTime(slot, timezone) === time) || null;
}

async function getBookingByExternalRef(businessId: string, source: string, externalRef: string): Promise<BookingRecord | null> {
  const { data, error } = await db
    .from("bookings")
    .select("id, business_id, tour_id, slot_id, customer_name, email, phone, qty, total_amount, status, source, external_ref, slots(start_time)")
    .eq("business_id", businessId)
    .eq("source", source)
    .eq("external_ref", externalRef)
    .maybeSingle();
  if (error) throw error;
  return (data as BookingRecord | null) || null;
}

function buildExternalDetails(body: Json, requestId: string, authMode: string, eventId: string, credentialId: string): Json {
  return {
    request_id: requestId,
    event_id: eventId,
    auth_mode: authMode,
    credential_id: credentialId,
    external_product_id: body.external_product_id || null,
    external_product_code: body.external_product_code || null,
    external_product_name: body.external_product_name || body.tour_name || null,
    provider_status: body.status || null,
    payload: body,
  };
}

function slotPrice(slot: SlotRecord, tour: TourRecord): number {
  return Number(slot.price_per_person_override ?? tour.base_price_per_person ?? 0);
}

function totalPaidForPayload(body: Json, slot: SlotRecord, tour: TourRecord, qty: number): number {
  const raw = normalizeMoney(body.total_paid ?? body.total_amount);
  if (raw !== null) return raw;
  return slotPrice(slot, tour) * qty;
}

function successFromRpc(result: unknown): Json {
  if (result && typeof result === "object" && !Array.isArray(result)) return result as Json;
  return {};
}

function eventIdFromRequest(req: Request, body: Json, fallback: string): string {
  const headerId = req.headers.get("x-event-id");
  if (headerId?.trim()) return headerId.trim();
  const bodyId = String(body.event_id || body.webhook_event_id || body.external_ref || "").trim();
  return bodyId || fallback;
}

async function beginEventLog(businessId: string, source: string, eventId: string, action: string, externalRef: string | null, body: Json): Promise<LogRecord | null> {
  const { data: existing, error: selectError } = await db
    .from("external_webhook_events")
    .select("id, retry_count, event_id")
    .eq("business_id", businessId)
    .eq("source", source)
    .eq("event_id", eventId)
    .maybeSingle();
  if (selectError) throw selectError;

  if (existing) {
    const nextRetryCount = Number(existing.retry_count || 0) + 1;
    const { data, error } = await db
      .from("external_webhook_events")
      .update({
        action,
        external_ref: externalRef,
        raw_payload: body,
        processed_status: "RECEIVED",
        http_status: null,
        response_body: null,
        last_error: null,
        processed_at: null,
        last_seen_at: new Date().toISOString(),
        retry_count: nextRetryCount,
      })
      .eq("id", existing.id)
      .select("id, retry_count, event_id")
      .single();
    if (error) throw error;
    return data as LogRecord;
  }

  const { data, error } = await db
    .from("external_webhook_events")
    .insert({
      business_id: businessId,
      source,
      event_id: eventId,
      action,
      external_ref: externalRef,
      raw_payload: body,
      processed_status: "RECEIVED",
      retry_count: 0,
    })
    .select("id, retry_count, event_id")
    .single();
  if (error) throw error;
  return data as LogRecord;
}

async function finalizeEventLog(logId: string | null, processedStatus: string, httpStatus: number, responseBody: Json, errorMessage?: string) {
  if (!logId) return;
  const { error } = await db
    .from("external_webhook_events")
    .update({
      processed_status: processedStatus,
      http_status: httpStatus,
      response_body: responseBody,
      last_error: errorMessage || null,
      processed_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", logId);
  if (error) console.error("Failed to finalize event log", error);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed" });

  const requestId = crypto.randomUUID();
  let source = "UNKNOWN";
  let action = "unknown";
  let eventId = requestId;
  let logId: string | null = null;

  const send = async (
    httpStatus: number,
    code: string,
    message: string,
    extra: Json = {},
    processedStatus?: string,
  ) => {
    const payload: Json = { success: httpStatus < 400, code, message, request_id: requestId, event_id: eventId, source, action, ...extra };
    await finalizeEventLog(logId, processedStatus || (httpStatus < 400 ? "SUCCEEDED" : "FAILED"), httpStatus, payload, httpStatus < 400 ? undefined : message);
    return respond(httpStatus, payload);
  };

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return respond(500, { success: false, code: "SERVER_MISCONFIGURED", message: "Missing required environment variables", request_id: requestId });
    }

    const rawBody = await req.text();
    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch (_err) {
      return respond(400, { success: false, code: "INVALID_JSON", message: "Invalid JSON body", request_id: requestId });
    }

    const body = sanitizeBody(parsedBody);
    source = normalizeSource(req, body);
    action = normalizeAction(body.action, body);
    eventId = eventIdFromRequest(req, body, requestId);
    const externalRef = String(body.external_ref || "").trim() || null;

    if (!source || source === "UNKNOWN") {
      return await send(400, "MISSING_SOURCE", "source is required", {}, "REJECTED");
    }

    const auth = await verifyAuth(req, source, rawBody);
    if (auth.businessId) {
      logId = (await beginEventLog(auth.businessId, source, eventId, action, externalRef, body))?.id || null;
    }
    if (!auth.ok) {
      return await send(401, auth.code, auth.message, {}, "REJECTED");
    }

    const businessId = auth.businessId;
    const businessTimezone = await getBusinessTimezone(businessId);

    if (action === "check_availability") {
      if (body.date !== undefined && body.date !== null && !normalizeDate(body.date)) {
        return await send(400, "INVALID_DATE", "date must be in YYYY-MM-DD format", {}, "REJECTED");
      }
      if (body.time !== undefined && body.time !== null && !normalizeTime(body.time)) {
        return await send(400, "INVALID_TIME", "time must be in HH:MM format", {}, "REJECTED");
      }

      const tour = await resolveTour(businessId, source, body);
      if (!tour) return await send(404, "TOUR_MAPPING_NOT_FOUND", "Tour mapping not found");

      const date = normalizeDate(body.date);
      const time = normalizeTime(body.time);
      const qty = Math.max(1, Number(body.qty || 1));
      if (!Number.isFinite(qty)) return await send(400, "INVALID_QTY", "qty must be numeric", {}, "REJECTED");

      const { data, error } = await db.rpc("ck_external_check_availability", {
        p_business_id: businessId,
        p_tour_id: tour.id,
        p_date: date,
        p_time: time,
        p_qty: qty,
      });
      if (error) throw error;
      const result = successFromRpc(data);
      return await send(200, "AVAILABILITY_OK", "Availability fetched", {
        business_id: businessId,
        tour_id: tour.id,
        tour_name: tour.name,
        requested_date: date,
        requested_time: time,
        requested_qty: qty,
        has_availability: Boolean(result.has_availability),
        slots: Array.isArray(result.slots) ? result.slots : [],
      });
    }

    if (action === "create_booking") {
      const externalRefValue = String(body.external_ref || "").trim();
      const qty = Number(body.qty || 0);
      if (!externalRefValue) return await send(400, "MISSING_EXTERNAL_REF", "external_ref is required", {}, "REJECTED");
      if (!Number.isInteger(qty) || qty < 1) return await send(400, "INVALID_QTY", "qty must be a positive integer", {}, "REJECTED");
      if (body.date !== undefined && body.date !== null && !normalizeDate(body.date)) return await send(400, "INVALID_DATE", "date must be in YYYY-MM-DD format", {}, "REJECTED");
      if (body.time !== undefined && body.time !== null && !normalizeTime(body.time)) return await send(400, "INVALID_TIME", "time must be in HH:MM format", {}, "REJECTED");

      // B2B partners can specify a longer hold duration (up to 24 hours / 1440 minutes).
      // Direct consumers default to 15 minutes.
      const DEFAULT_HOLD_MINUTES = 15;
      const MAX_HOLD_MINUTES = 1440; // 24 hours
      let holdDurationMinutes = DEFAULT_HOLD_MINUTES;
      if (body.hold_duration_minutes !== undefined && body.hold_duration_minutes !== null) {
        const parsed = Number(body.hold_duration_minutes);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_HOLD_MINUTES) {
          return await send(400, "INVALID_HOLD_DURATION", `hold_duration_minutes must be between 1 and ${MAX_HOLD_MINUTES}`, {}, "REJECTED");
        }
        holdDurationMinutes = Math.floor(parsed);
      }

      const tour = await resolveTour(businessId, source, body);
      if (!tour) return await send(404, "TOUR_MAPPING_NOT_FOUND", "Tour mapping not found");

      const slot = await resolveSlot(businessId, tour.id, body, "create", businessTimezone);
      if (!slot) return await send(404, "SLOT_NOT_FOUND", "Open slot not found for the supplied date/time");

      const totalPaid = totalPaidForPayload(body, slot, tour, qty);
      if (!Number.isFinite(totalPaid)) return await send(400, "INVALID_TOTAL_PAID", "total_paid must be numeric", {}, "REJECTED");

      const { data, error } = await db.rpc("ck_external_create_booking", {
        p_business_id: businessId,
        p_tour_id: tour.id,
        p_slot_id: slot.id,
        p_source: source,
        p_external_ref: externalRefValue,
        p_customer_name: String(body.customer_name || "").trim() || null,
        p_email: normalizeEmail(body.email),
        p_phone: normalizePhone(body.phone),
        p_qty: qty,
        p_total_amount: totalPaid,
        p_status: String(body.status || "PAID").trim().toUpperCase(),
        p_supplier_payment_status: String(body.supplier_payment_status || body.status || "PAID").trim().toUpperCase() || null,
        p_supplier_settlement_status: String(body.supplier_settlement_status || "").trim().toUpperCase() || null,
        p_supplier_payout_amount: normalizeMoney(body.supplier_payout_amount),
        p_supplier_commission_amount: normalizeMoney(body.supplier_commission_amount),
        p_external_source_details: buildExternalDetails(body, requestId, auth.authMode, eventId, auth.credentialId),
      });
      if (error) throw error;
      const result = successFromRpc(data);
      const code = String(result.code || "BOOKING_CREATE_FAILED");
      if (code === "SLOT_NOT_FOUND") return await send(404, code, "Slot not found");
      if (code === "SLOT_CLOSED") return await send(409, code, "Slot is closed");
      if (code === "INSUFFICIENT_CAPACITY") return await send(409, code, "Not enough remaining capacity");
      if (!result.success) return await send(400, code, "Booking creation failed");

      // Calculate hold expiry based on the requested hold duration
      const holdExpiresAt = new Date(Date.now() + holdDurationMinutes * 60 * 1000).toISOString();

      return await send(200, code, code === "ALREADY_EXISTS" ? "Booking already exists" : "Booking created", {
        business_id: businessId,
        booking_id: result.booking_id || null,
        booking_ref: String(result.booking_id || "").slice(0, 8).toUpperCase() || null,
        external_ref: externalRefValue,
        status: result.status || String(body.status || "PAID").trim().toUpperCase(),
        qty,
        total_paid: totalPaid,
        hold_duration_minutes: holdDurationMinutes,
        hold_expires_at: holdExpiresAt,
        slot: slotSummary(slot, businessTimezone),
        idempotent: code === "ALREADY_EXISTS",
      });
    }

    if (action === "cancel_booking") {
      const externalRefValue = String(body.external_ref || "").trim();
      if (!externalRefValue) return await send(400, "MISSING_EXTERNAL_REF", "external_ref is required", {}, "REJECTED");

      const { data, error } = await db.rpc("ck_external_cancel_booking", {
        p_business_id: businessId,
        p_source: source,
        p_external_ref: externalRefValue,
        p_cancel_reason: String(body.cancel_reason || body.reason || "Cancelled by external source").trim(),
        p_external_source_details: buildExternalDetails(body, requestId, auth.authMode, eventId, auth.credentialId),
      });
      if (error) throw error;
      const result = successFromRpc(data);
      const code = String(result.code || "BOOKING_CANCEL_FAILED");
      if (code === "BOOKING_NOT_FOUND") return await send(404, code, "Booking not found");

      return await send(200, code, code === "BOOKING_ALREADY_CANCELLED" ? "Booking already cancelled" : "Booking cancelled", {
        business_id: businessId,
        booking_id: result.booking_id || null,
        external_ref: externalRefValue,
        status: "CANCELLED",
        idempotent: code === "BOOKING_ALREADY_CANCELLED",
      });
    }

    if (action === "modify_booking") {
      const externalRefValue = String(body.external_ref || "").trim();
      if (!externalRefValue) return await send(400, "MISSING_EXTERNAL_REF", "external_ref is required", {}, "REJECTED");
      if (body.new_date !== undefined && body.new_date !== null && !normalizeDate(body.new_date)) return await send(400, "INVALID_NEW_DATE", "new_date must be in YYYY-MM-DD format", {}, "REJECTED");
      if (body.new_time !== undefined && body.new_time !== null && !normalizeTime(body.new_time)) return await send(400, "INVALID_NEW_TIME", "new_time must be in HH:MM format", {}, "REJECTED");

      const existing = await getBookingByExternalRef(businessId, source, externalRefValue);
      if (!existing) return await send(404, "BOOKING_NOT_FOUND", "Booking not found");

      const requestedTour = await resolveTour(businessId, source, body);
      const targetTour = requestedTour || (await getTourById(businessId, existing.tour_id));
      if (!targetTour) return await send(404, "TOUR_MAPPING_NOT_FOUND", "Target tour not found");

      const changingSlot = Boolean(body.new_slot_id || body.new_date || body.new_time || body.new_tour_id || body.new_tour_name);
      const slot = changingSlot ? await resolveSlot(businessId, targetTour.id, body, "modify", businessTimezone) : null;
      if (changingSlot && !slot) return await send(404, "NEW_SLOT_NOT_FOUND", "Target open slot not found for the supplied date/time");

      const newQty = body.new_qty === undefined || body.new_qty === null || String(body.new_qty).trim() === "" ? existing.qty : Number(body.new_qty);
      if (!Number.isInteger(newQty) || newQty < 1) return await send(400, "INVALID_QTY", "new_qty must be a positive integer", {}, "REJECTED");

      const calculatedTotal = body.total_paid === undefined || body.total_paid === null || String(body.total_paid).trim() === "" ? Number(existing.total_amount || 0) : Number(body.total_paid);
      if (!Number.isFinite(calculatedTotal)) return await send(400, "INVALID_TOTAL_PAID", "total_paid must be numeric", {}, "REJECTED");

      const { data, error } = await db.rpc("ck_external_modify_booking", {
        p_business_id: businessId,
        p_source: source,
        p_external_ref: externalRefValue,
        p_new_slot_id: slot?.id || null,
        p_new_qty: newQty,
        p_customer_name: String(body.customer_name || "").trim() || null,
        p_email: normalizeEmail(body.email),
        p_phone: normalizePhone(body.phone),
        p_total_amount: calculatedTotal,
        p_status: String(body.status || "").trim().toUpperCase() || null,
        p_supplier_payment_status: String(body.supplier_payment_status || body.status || "").trim().toUpperCase() || null,
        p_supplier_settlement_status: String(body.supplier_settlement_status || "").trim().toUpperCase() || null,
        p_supplier_payout_amount: normalizeMoney(body.supplier_payout_amount),
        p_supplier_commission_amount: normalizeMoney(body.supplier_commission_amount),
        p_external_source_details: buildExternalDetails(body, requestId, auth.authMode, eventId, auth.credentialId),
      });
      if (error) throw error;
      const result = successFromRpc(data);
      const code = String(result.code || "BOOKING_MODIFY_FAILED");
      if (code === "BOOKING_NOT_FOUND") return await send(404, code, "Booking not found");
      if (code === "BOOKING_CANCELLED") return await send(409, code, "Cancelled bookings cannot be modified");
      if (code === "NEW_SLOT_NOT_FOUND") return await send(404, code, "Target slot not found");
      if (code === "NEW_SLOT_CLOSED") return await send(409, code, "Target slot is closed");
      if (code === "INSUFFICIENT_CAPACITY") return await send(409, code, "Not enough remaining capacity for the requested change");
      if (!result.success) return await send(400, code, "Booking modification failed");

      const startTime = String(result.start_time || pickFirst(existing.slots)?.start_time || "");
      return await send(200, code, "Booking modified", {
        business_id: businessId,
        booking_id: result.booking_id || existing.id,
        external_ref: externalRefValue,
        status: result.status || existing.status,
        qty: result.qty || newQty,
        total_paid: result.total_amount ?? calculatedTotal,
        slot: startTime ? { slot_id: result.slot_id || slot?.id || existing.slot_id, start_time_utc: startTime, start_time_local: formatInTimezone(startTime, "en-ZA", businessTimezone, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) } : { slot_id: result.slot_id || slot?.id || existing.slot_id },
      });
    }

    return await send(400, "UNSUPPORTED_ACTION", "Unsupported action", {}, "REJECTED");
  } catch (error) {
    console.error("external-booking error", error);
    return await send(500, "UNHANDLED_ERROR", error instanceof Error ? error.message : "Unhandled error");
  }
});
