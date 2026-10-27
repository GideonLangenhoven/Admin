import { createServer } from "node:http";
import { createRequire } from "node:module";
import { sourceExports, sourceHandler } from "./source-handler.ts";

// Local-only backend. The real checkout handler runs with isolated tables and
// a sandbox provider stub. No real contact, secret, booking or charge is used.
const require = createRequire(import.meta.url);
const fixture = require("./booking-guest-fixture.cjs");
const { businessId, tourId, tours, slots, theme } = fixture;
const defaultQuestions = [{ key: "any_allergies_87180", label: "Any  Allergies", type: "text", required: true }];
const bookings = new Map<string, any>();
let state: any;
function reset(overrides: any = {}) {
  bookings.clear();
  state = { theme: { ...theme, name: theme.business_name, yoco_test_mode: true, booking_site_url: "http://127.0.0.1:35236", booking_custom_fields: defaultQuestions, ...overrides.theme }, tours: structuredClone(tours), slots: structuredClone(slots), configError: false, providerErrorOnce: false, prepareCalls: 0, providerCalls: 0, paymentRequests: [], ...overrides };
  if (overrides.theme) state.theme = { ...theme, name: theme.business_name, yoco_test_mode: true, booking_custom_fields: defaultQuestions, ...overrides.theme };
}
reset();

const db = {
  from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let update: any;
    const query: any = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      in: () => query, update: (value: any) => { update = value; return query; },
      maybeSingle: async () => result(), single: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    function result() {
      if (table === "businesses") return state.configError ? { data: null, error: { message: "Fixture configuration unavailable" } } : { data: state.theme, error: null };
      if (table !== "bookings") throw new Error("Unexpected checkout table: " + table);
      const booking = [...bookings.values()].find(row => filters.every(([key, value]) => row[key] === value));
      if (booking && update) Object.assign(booking, update);
      return { data: booking || null, error: null };
    }
    return query;
  },
  async rpc(name: string, args: any) {
    const booking = bookings.get(args.p_booking_id);
    if (!booking) return { data: { ok: false, error: "BOOKING_NOT_FOUND" }, error: null };
    if (name === "prepare_booking_checkout") {
      state.prepareCalls++;
      const slot = state.slots.find((row: any) => row.id === booking.slot_id);
      const tour = state.tours.find((row: any) => row.id === booking.tour_id);
      if (booking.status !== "HELD") {
        if (!slot || slot.capacity_total - slot.booked - slot.held < booking.qty) return { data: { ok: false, error: "No spots available" }, error: null };
        slot.held += booking.qty;
        booking.status = "HELD";
      }
      const amount = Number(slot.price_per_person_override ?? tour.base_price_per_person) * booking.qty;
      booking.total_amount = amount;
      return { data: { ok: true, amount, expires_at: "2026-10-01T08:15:00Z", ...(booking.payment_url ? { redirectUrl: booking.payment_url, checkout_id: booking.yoco_checkout_id } : {}) }, error: null };
    }
    if (name === "save_checkout_request") {
      state.paymentRequests.push(args.p_request);
      return { data: { ok: true, request: { id: "sandbox-request-" + booking.id, ...args.p_request } }, error: null };
    }
    throw new Error("Unexpected checkout RPC: " + name);
  },
};

const checkout = sourceHandler("supabase/functions/create-checkout/index.ts", {
  "../_shared/booking-custom-fields.ts": sourceExports("supabase/functions/_shared/booking-custom-fields.ts", {}),
  "../_shared/tenant.ts": {
    createServiceClient: () => db,
    getTenantByBusinessId: async () => ({ business: state.theme, credentials: { activeYocoSecretKey: "fixture-test", yocoTestMode: true, yocoTestSecretKey: "fixture-test", yocoTestWebhookSecret: "fixture-webhook" } }),
    getBusinessAllowedOrigins: () => ["http://127.0.0.1:35236"], isAllowedOrigin: () => true,
    resolveBusinessSiteUrls: () => ({ bookingSuccessUrl: "http://127.0.0.1:35236/success", bookingCancelUrl: "http://127.0.0.1:35236/cancel" }),
  },
  "../_shared/auth.ts": { requireAuth: async () => { throw new Error("Anonymous fixture"); }, canAccessBusiness: () => false },
  "../_shared/subscription.ts": { blockIfNotTrading: async () => null },
  "../_shared/booking-success.ts": { bookingSuccessUrl: async (url: string) => url },
}, {}, async (_url, init) => {
  state.providerCalls++;
  if (JSON.stringify(init).includes("sk_live")) throw new Error("Live provider forbidden");
  if (state.providerErrorOnce) {
    state.providerErrorOnce = false;
    return Response.json({ message: "Sandbox payment unavailable. Please retry." }, { status: 503 });
  }
  return Response.json({ id: "sandbox-checkout", redirectUrl: "http://127.0.0.1:35236/fixture-payment" });
});

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url!, "http://127.0.0.1:35237");
  let raw = ""; for await (const part of req) raw += part;
  const body = raw ? JSON.parse(raw) : {};
  if (url.pathname === "/__fixture/reset") { reset(body); res.end("{}"); return; }
  if (url.pathname === "/__fixture/update") { Object.assign(state, body); res.end("{}"); return; }
  if (url.pathname === "/__fixture/state") { res.end(JSON.stringify({ ...state, bookings: [...bookings.values()] })); return; }
  if (url.pathname === "/__fixture/confirm") { const row = bookings.get(body.booking_id); if (row) row.status = "CONFIRMED"; res.end("{}"); return; }
  if (url.pathname === "/functions/v1/create-checkout") {
    const response = await checkout(new Request(url, { method: "POST", headers: req.headers as Record<string, string>, body: raw }));
    res.writeHead(response.status); res.end(await response.text()); return;
  }
  if (url.pathname.startsWith("/functions/") || url.pathname.includes("/rest/v1/rpc/")) { res.writeHead(403); res.end('{"error":"Other actions disabled in this fixture"}'); return; }
  const table = url.pathname.split("/").pop();
  const authenticated = req.headers.authorization?.includes("mock-signature");
  const proofId = req.headers["x-booking-id"];
  const proof = req.headers["x-booking-waiver-token"];
  if (table === "businesses" && url.searchParams.get("select") === "booking_custom_fields" && state.configError) { res.writeHead(503); res.end('{"message":"Configuration unavailable"}'); return; }
  let rows: any[] = table === "businesses" ? [state.theme] : table === "tours" ? state.tours : table === "slots" ? state.slots : table === "bookings" ? [...bookings.values()] : table === "admin_users" && authenticated ? [{ id: "40000000-0000-4000-8000-000000000001", user_id: "50000000-0000-4000-8000-000000000001", email: "operator@example.invalid", name: "Fixture Operator", role: "MAIN_ADMIN", business_id: businessId, suspended: false, read_only: false, settings_permissions: {} }] : [];
  if (table === "bookings" && req.method === "POST") {
    if (!String(body.email).endsWith("@example.invalid") || body.id !== proofId || body.waiver_token !== proof || body.business_id !== businessId) { res.writeHead(403); res.end('{"message":"Only authorised fixture contacts and proofs are accepted"}'); return; }
    bookings.set(body.id, { ...body, waiver_status: "PENDING", created_at: new Date().toISOString(), arrived_count: 0, checked_in: false, checked_in_at: null });
    rows = [bookings.get(body.id)];
  } else if (table === "bookings" && !authenticated) rows = rows.filter(row => row.id === proofId && row.waiver_token === proof);
  if (table === "bookings" && req.method === "PATCH") {
    for (const row of rows) if (row.status === "PENDING") Object.assign(row, body);
  }
  for (const key of ["id", "business_id", "tour_id", "slot_id", "status", "active", "email"]) {
    const filter = url.searchParams.get(key);
    if (filter?.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === filter.slice(3));
    if (filter?.startsWith("in.(")) rows = rows.filter(row => filter.slice(4, -1).split(",").map(value => value.replaceAll('"', "")).includes(String(row[key])));
  }
  if (table === "slots") {
    if (url.searchParams.has("last_minute_at")) rows = [];
    for (const filter of url.searchParams.getAll("start_time")) {
      if (filter.startsWith("gt.")) rows = rows.filter(row => Date.parse(row.start_time) > Date.parse(filter.slice(3)));
      if (filter.startsWith("lt.")) rows = rows.filter(row => Date.parse(row.start_time) < Date.parse(filter.slice(3)));
    }
    rows = rows.map(row => ({ ...row, tours: { name: tours.find((tour: any) => tour.id === row.tour_id)?.name } }));
  }
  if (table === "bookings") rows = rows.map(row => ({ ...row, tours: state.tours.find((tour: any) => tour.id === row.tour_id), slots: state.slots.find((slot: any) => slot.id === row.slot_id) }));
  if (req.headers.prefer?.includes("count=exact") || req.headers.range) res.setHeader("Content-Range", `0-${Math.max(0, rows.length - 1)}/${rows.length}`);
  res.end(JSON.stringify(req.headers.accept?.includes("vnd.pgrst.object") ? rows[0] || null : rows));
}).listen(35237, "127.0.0.1", () => console.log("Isolated custom questions backend on 35237"));
