import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const current = JSON.parse(readFileSync(new URL("../fixtures/catalogue-current.json", import.meta.url), "utf8"));
const fixture = {
  businessId: current.businessId, slots: current.slots,
  theme: { ...current.theme, id: current.businessId, subscription_status: "ACTIVE", subdomain: "kayak", timezone: "Africa/Johannesburg" },
  tours: current.tours.map((tour, sort_order) => ({ ...tour, business_id: current.businessId, sort_order, duration_minutes: 120, active: true, hidden: false })),
};
let state;
function reset(data = {}) {
  state = { theme: { ...fixture.theme, booking_site_url: "http://127.0.0.1:3146", ...data.theme }, tours: data.tours || fixture.tours, slots: data.slots || fixture.slots, bookings: [], providerCalls: 0, prepareCalls: 0 };
}
reset();

// Read-only REST double: no booking, payment or notification implementation.
createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url, "http://127.0.0.1:3147");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (url.pathname === "/__fixture/reset" && req.method === "POST") {
    let raw = ""; for await (const part of req) raw += part;
    reset(JSON.parse(raw || "{}")); res.end("{}"); return;
  }
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(403); res.end('{"message":"Visual fixture is read-only"}'); return; }
  if (url.pathname === "/__fixture/state") { res.end(JSON.stringify(state)); return; }
  const table = url.pathname.split("/").pop();
  const operator = { id: "40000000-0000-4000-8000-000000000001", user_id: "50000000-0000-4000-8000-000000000001", email: "operator@example.invalid", name: "Fixture Operator", role: "MAIN_ADMIN", business_id: fixture.businessId, suspended: false, read_only: true, settings_permissions: {} };
  let rows = table === "businesses" ? [state.theme] : table === "tours" ? state.tours : table === "slots" && !url.searchParams.has("last_minute_at") ? state.slots : table === "admin_users" && req.headers.authorization?.includes("mock-signature") ? [operator] : [];
  for (const key of ["id", "business_id", "tour_id", "active", "status"]) {
    const filter = url.searchParams.get(key);
    if (filter?.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === filter.slice(3));
  }
  if (req.headers.prefer?.includes("count=exact")) res.setHeader("Content-Range", `0-${Math.max(0, rows.length - 1)}/${rows.length}`);
  res.end(JSON.stringify(req.headers.accept?.includes("vnd.pgrst.object") ? rows[0] || null : rows));
}).listen(3147, "127.0.0.1", () => console.log("Read-only catalogue fixture on 3147"));
