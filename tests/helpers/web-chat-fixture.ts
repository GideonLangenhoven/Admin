import { sourceExports, sourceHandler } from "./source-handler.ts";

const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", CUSTOMER_SESSION_SECRET: "fixture-session-secret" };
const customerSessions = sourceExports("supabase/functions/_shared/customer-session.ts", {}, env) as any;
const chatSessions = sourceExports("supabase/functions/_shared/web-chat-session.ts", { "./customer-session.ts": customerSessions }, env) as any;
const guards = sourceExports("supabase/functions/_shared/bot-guards.ts", {}) as any;
const intents = sourceExports("supabase/functions/_shared/intent.ts", {}, env) as any;
const pricing = sourceExports("supabase/functions/_shared/chat-booking-pricing.ts", {}) as any;
const vouchers = sourceExports("supabase/functions/_shared/vouchers.ts", {}) as any;
const contact = sourceExports("supabase/functions/_shared/chat-contact.ts", {}) as any;
const questions = sourceExports("supabase/functions/_shared/booking-custom-fields.ts", {}) as any;
const duration = sourceExports("supabase/functions/_shared/duration.ts", {}) as any;
const botPrompt = sourceExports("supabase/functions/_shared/bot-prompt.ts", { "./platform-invariants.ts": { PLATFORM_INVARIANTS: "" }, "./duration.ts": duration }) as any;

export function webChatFixture(source = "supabase/functions/web-chat/index.ts", extraEnv: Record<string, string> = {}) {
  const business = { id: "a", business_name: "Fixture Kayak", timezone: "Africa/Johannesburg", booking_site_url: "https://a.booking.fixture.invalid", faq_json: {}, what_to_bring: "Bring a towel and water.", meeting_point_address: "Harbour kiosk" };
  const start = new Date(Date.now() + 72 * 3_600_000).toISOString();
  const tour = { id: "tour-a", business_id: "a", name: "Sea Kayak Tour", base_price_per_person: 400, duration_minutes: 120, active: true, hidden: false };
  const slot = { id: "slot-a", tour_id: tour.id, business_id: "a", start_time: start, capacity_total: 10, available_capacity: 10, status: "OPEN", price_per_person_override: null };
  const rows: Record<string, any[]> = { businesses: [business], tours: [tour], slots: [slot], conversations: [], chat_messages: [], chat_faq_entries: [], bookings: [], vouchers: [], holds: [] };
  const calls: { kind: string; name: string; data: any }[] = [];
  const failures: Record<string, any> = {};
  const settings: any = { trading: true, llmAvailable: true, llmReply: "That is our fixture answer.", holdAvailable: true, checkout: "ok", humanPush: false, email: "ok", promos: {} };
  const discount = { type: "GROUP", percent: 5, label: "Group discount", minQty: 6, phone: "", email: "" };
  let sequence = 0;
  const rateCounts: Record<string, number> = {}; // public.check_rate_limit, without the minute window
  const db = {
    from(table: string) {
      const filters: ((row: any) => boolean)[] = [];
      let mutation: { method: string; value: any } | null = null;
      let execution: Promise<any> | undefined;
      const execute = () => execution ||= (async () => {
        const method = mutation?.method || "select";
        calls.push({ kind: method, name: table, data: mutation?.value });
        if (failures[method + ":" + table]) return { data: null, error: failures[method + ":" + table] };
        let matched = (rows[table] ||= []).filter(row => filters.every(filter => filter(row)));
        if (mutation?.method === "insert" || mutation?.method === "upsert") {
          const incoming = Array.isArray(mutation.value) ? mutation.value : [mutation.value];
          if (mutation.method === "insert" && incoming.some(value => value.id && rows[table].some(row => row.id === value.id))) return { data: null, error: { code: "23505", message: "Duplicate primary key" } };
          matched = (Array.isArray(mutation.value) ? mutation.value : [mutation.value]).map(value => {
            const existing = mutation!.method === "upsert" ? rows[table].find(row => row.business_id === value.business_id && row.phone === value.phone) : null;
            if (existing) { Object.assign(existing, value); return existing; }
            const row = { id: "fixture-" + (++sequence), created_at: new Date().toISOString(), ...(table === "conversations" ? { status: "BOT" } : {}), ...value };
            rows[table].push(row);
            return row;
          });
        } else if (mutation?.method === "update") matched.forEach(row => Object.assign(row, mutation!.value));
        else if (mutation?.method === "delete") rows[table] = rows[table].filter(row => !matched.includes(row));
        return { data: matched, error: null };
      })();
      const q: any = {
        select: () => q, order: () => q, limit: () => q,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
        neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return q; },
        in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; },
        gt: (key: string, value: unknown) => { filters.push(row => row[key] > value); return q; },
        gte: (key: string, value: unknown) => { filters.push(row => row[key] >= value); return q; },
        lte: (key: string, value: unknown) => { filters.push(row => row[key] <= value); return q; },
        ilike: (key: string, value: string) => { filters.push(row => String(row[key]).toLowerCase() === value.toLowerCase()); return q; },
        insert: (value: any) => { mutation = { method: "insert", value }; return q; },
        upsert: (value: any) => { mutation = { method: "upsert", value }; return q; },
        update: (value: any) => { mutation = { method: "update", value }; return q; },
        delete: () => { mutation = { method: "delete", value: null }; return q; },
        maybeSingle: async () => { const result = await execute(); return { ...result, data: result.data?.[0] || null }; },
        single: async () => { const result = await execute(); return { ...result, data: result.data?.[0] || null }; },
        then: (resolve: any, reject: any) => execute().then(resolve, reject),
      };
      return q;
    },
    async rpc(name: string, data: any) {
      calls.push({ kind: "rpc", name, data });
      if (failures["rpc:" + name]) return { data: null, error: failures["rpc:" + name] };
      if (name === "check_rate_limit") { rateCounts[data.p_ip + "|" + data.p_endpoint] = (rateCounts[data.p_ip + "|" + data.p_endpoint] || 0) + 1; return { data: rateCounts[data.p_ip + "|" + data.p_endpoint] <= data.p_max, error: null }; }
      if (name === "list_available_slots") return { data: rows.slots.filter(row => row.business_id === data.p_business_id && (!data.p_tour_id || row.tour_id === data.p_tour_id) && row.status === "OPEN" && row.start_time >= data.p_range_start && row.start_time <= data.p_range_end), error: null };
      if (name === "resolve_booking_discount") return { data: data.p_qty >= discount.minQty && (!discount.phone && !discount.email || discount.phone && data.p_phone === discount.phone || discount.email && data.p_email === discount.email) ? discount : { type: "", percent: 0, label: "" }, error: null };
      if (name === "validate_promo_code") {
        const promo = settings.promos[String(data.p_code).trim().toUpperCase()];
        if (!promo || promo.business_id !== data.p_business_id) return { data: { valid: false, error: "Invalid promo code" }, error: null };
        if ((promo.usedBy || []).includes(data.p_customer_email)) return { data: { valid: false, error: "You have already used this promo code" }, error: null };
        return { data: { valid: true, code: promo.code, discount_type: promo.discount_type, discount_value: promo.discount_value }, error: null };
      }
      if (name === "slot_available_capacity") return { data: rows.slots.find(row => row.id === data.p_slot_id)?.available_capacity ?? 0, error: null };
      if (name === "create_hold_with_capacity_check") {
        if (!settings.holdAvailable) return { data: { success: false, error: "Those spots were just taken." }, error: null };
        rows.holds.push({ id: "hold-" + sequence, booking_id: data.p_booking_id, slot_id: data.p_slot_id, qty: data.p_qty, expires_at: data.p_expires_at, status: "ACTIVE" });
        return { data: { success: true, expires_at: data.p_expires_at }, error: null };
      }
      if (name === "confirm_voucher_booking") {
        const booking = rows.bookings.find(row => row.id === data.p_booking_id);
        if (booking) {
          booking.status = "PAID";
          for (const id of data.p_voucher_ids || []) {
            const voucher = rows.vouchers.find(row => row.id === id);
            if (voucher) { voucher.current_balance = Math.max(0, voucher.current_balance - booking.original_total + booking.discount_amount); if (!voucher.current_balance) voucher.status = "REDEEMED"; }
          }
        }
        return { data: { ok: true }, error: null };
      }
      if (name === "cancel_booking_transaction") {
        const booking = rows.bookings.find(row => row.id === data.p_booking_id && row.business_id === data.p_business_id);
        if (!booking) return { data: { ok: false }, error: null };
        booking.status = "CANCELLED";
        rows.holds.filter(row => row.booking_id === booking.id && row.status === "ACTIVE").forEach(row => { row.status = "CANCELLED"; });
        return { data: { ok: true }, error: null };
      }
      throw new Error("Unexpected RPC: " + name);
    },
    functions: { invoke: async (name: string, options: any) => { calls.push({ kind: "invoke", name, data: options }); return { data: { ok: true }, error: null }; } },
  };
  const handler = sourceHandler(source, {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: any) => fn },
    "../_shared/tenant.ts": {
      getTenantByBusinessId: async (_db: any, id: string) => { const tenant = rows.businesses.find(row => row.id === id); return tenant ? { business: tenant } : null; },
      getBusinessDisplayName: (biz: any) => biz?.business_name || "Fixture Kayak",
      getBusinessAllowedOrigins: () => ["https://a.booking.fixture.invalid", "http://127.0.0.1:3093"],
      isAllowedOrigin: (origin: string, allowed: string[]) => allowed.includes(origin),
      resolveManageBookingsUrl: (biz: any) => biz.manage_bookings_url || biz.booking_site_url + "/my-bookings",
      resolveBookingSiteUrl: (biz: any) => biz.booking_site_url || "",
      sendWhatsappTextForTenant: async (tenant: any, to: string, message: string, template: any) => {
        calls.push({kind:"whatsapp-alert",name:tenant.business.id,data:{to,message,template}});
        if(failures["whatsapp-alert"])throw new Error("WhatsApp alert unavailable");
        return {channel:"text",data:{}};
      },
    },
    "../_shared/duration.ts": duration, "../_shared/bot-guards.ts": guards,
    "../_shared/intent.ts": { ...intents, classifyIntent: async () => ({ intent: "OTHER", confidence: 0, model: null, ms: 0 }) },
    "../_shared/subscription.ts": { getSubscriptionState: async () => ({ trading: settings.trading }) },
    "../_shared/chat-booking-pricing.ts": pricing,
    "../_shared/vouchers.ts": vouchers,
    "../_shared/chat-contact.ts": contact,
    "../_shared/booking-custom-fields.ts": questions,
    "../_shared/platform-invariants.ts": { PLATFORM_INVARIANTS: "Never invent operator facts or grant free trips." },
    "../_shared/bot-prompt.ts": botPrompt,
    // settings.guestLanguage turns on a fake guest language: "[af] " marks translated text.
    "../_shared/translate.ts": {
      readGuestMessage: async (text: string) => settings.guestLanguage && !/^\d+$/.test(text) ? { lang: settings.guestLanguage, english: "EN: " + text } : null,
      translateOutgoing: async (texts: string[], lang: string) => texts.map(text => lang === "en" ? text : "[" + lang + "] " + text),
    },
    "../_shared/llm.ts": { llmAvailable: () => settings.llmAvailable, llmText: async (data: any) => {
      calls.push({ kind: "llm", name: data.label, data });
      if (failures["llm"]) throw new Error("Model unavailable");
      return settings.llmAvailable ? data.label === "web-date" ? "INVALID" : settings.llmReply : null;
    } },
    "../_shared/kb.ts": { retrieveKbContext: async () => "" },
    "../_shared/customer-session.ts": customerSessions, "../_shared/web-chat-session.ts": chatSessions,
  }, { ...env, ...extraEnv }, async (url, init) => {
    calls.push({ kind: "fetch", name: String(url), data: JSON.parse(String(init?.body || "{}")) });
    if (String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return Response.json({ success: JSON.parse(String(init?.body)).response === "good-token" });
    if (String(url).endsWith("/create-checkout")) {
      if (settings.checkout === "throw") throw new Error("Provider network failure");
      if (settings.checkout === "non-json") return new Response("Upstream unavailable", { status: 503 });
      if (settings.checkout === "error") return Response.json({ error: "Gateway unavailable" }, { status: 503 });
      if (settings.checkout === "unsafe-url") return Response.json({ id: "checkout-a", redirectUrl: "javascript:alert(1)" });
      if (settings.checkout === "missing-url") return Response.json({ id: "checkout-a", success: true });
      if (settings.checkout === "fully-covered") return Response.json({ fully_covered: true, redirectUrl: "https://a.booking.fixture.invalid/success", amount: 0 });
      return Response.json({ id: "checkout-a", redirectUrl: "https://pay.fixture.invalid/checkout-a" });
    }
    if (String(url).endsWith("/confirm-booking")) return Response.json({ ok: true });
    if (String(url).endsWith("/send-email")) {
      if (settings.email === "throw") throw new Error("Email service unavailable");
      if (settings.email === "error") return Response.json({ error: "Email service unavailable" }, { status: 503 });
      if (settings.email === "invalid") return Response.json({ ok: false, error: "invalid_email" });
      return Response.json({ ok: true });
    }
    throw new Error("Unexpected external request: " + url);
  });
  const request = (body: object, headers: Record<string, string> = {}) => handler(new Request("https://fixture.invalid/web-chat", { method: "POST", headers: { "x-forwarded-for": "fixture-client", ...headers }, body: JSON.stringify({ business_id: "a", ...body }) }));
  const session = async () => (await (await request({ action: "session" })).json()).chat_session as string;
  const verifiedCustomer = async (email = "guest@fixture.invalid") =>
    (await customerSessions.issueCustomerSession({ email, businessId: business.id })).token as string;
  const post = async (token: string, message: string, state: any = { step: "IDLE" }, messages: any[] = []) => {
    const response = await request({ chat_session: token, message, state, messages });
    return { status: response.status, ...await response.json() };
  };
  const bookingState = { step: "CONFIRM", checkout_attempt: "20000000-0000-4000-8000-000000000001", tid: tour.id, tname: tour.name, tprice: 400, bid: "a", slotId: slot.id, slotTime: start, selectedDate: new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone }).format(new Date(start)), qty: 2, total: 800, name: "Fixture Guest", email: "guest@fixture.invalid", phone: "+27110000000" };
  return { rows, calls, failures, settings, discount, business, tour, slot, bookingState, handler, request, session, verifiedCustomer, post, chatSessions, db };
}
