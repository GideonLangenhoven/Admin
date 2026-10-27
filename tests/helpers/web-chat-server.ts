import { createServer } from "node:http";
import { webChatFixture } from "./web-chat-fixture.ts";

// Local-only Supabase facade: the real handler, signed sessions and React
// widget run together; all operator data, models and payment providers are fake.
let fixture = webChatFixture();
createServer(async (req, res) => {
  const origin = req.headers.origin || "http://127.0.0.1:3093";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.end(); return; }
  const url = new URL(req.url || "/", "http://127.0.0.1:3094");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  const json = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
  try {
    if (url.pathname === "/__fixture/reset") {
      fixture = webChatFixture();
      const input = JSON.parse(body || "{}");
      Object.assign(fixture.settings, input);
      let requestedDate: string | undefined;
      const dates: string[] = [];
      if (input.scenario === "selection") {
        const first = new Date(fixture.bookingState.selectedDate + "T12:00:00Z");
        for (let index = 0; index < 4; index++) {
          dates.push(first.toISOString().slice(0, 10));
          first.setUTCDate(first.getUTCDate() + 1);
        }
        Object.assign(fixture.tour, { name: "Morning Kayak", base_price_per_person: 600 });
        Object.assign(fixture.slot, { start_time: dates[0] + "T08:30:00+02:00", available_capacity: 3, capacity_total: 3 });
        fixture.rows.slots.push({ ...fixture.slot, id: "later", start_time: dates[1] + "T11:00:00+02:00", available_capacity: 4, capacity_total: 4 });
        for (const [id, name, price, time, index, capacity] of [["sunset", "Sunset Paddle", 500, "17:00", 2, 3], ["hike", "Midday Hike", 700, "12:00", 3, 6]] as const) {
          fixture.rows.tours.push({ ...fixture.tour, id, name, base_price_per_person: price });
          fixture.rows.slots.push({ ...fixture.slot, id: id + "-slot", tour_id: id, start_time: dates[index] + "T" + time + ":00+02:00", available_capacity: capacity, capacity_total: capacity, price_per_person_override: id === "hike" ? 750 : null });
        }
      }
      if (input.scenario === "wednesday") {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: fixture.business.timezone }).format(new Date());
        const date = new Date(today + "T12:00:00Z");
        date.setUTCDate(date.getUTCDate() + 7 - (date.getUTCDay() + 6) % 7 + 2);
        requestedDate = date.toISOString().slice(0, 10);
        date.setUTCDate(date.getUTCDate() - 1);
        fixture.tour.name = "Morning Kayak";
        fixture.tour.base_price_per_person = 600;
        Object.assign(fixture.slot, { id: "tuesday", start_time: date.toISOString().slice(0, 10) + "T08:30:00+02:00", available_capacity: 16, capacity_total: 16 });
        if (input.departure !== "missing-day") fixture.rows.slots.push({ ...fixture.slot, id: "wednesday", start_time: requestedDate + (input.departure === "missing-time" ? "T08:30:00+02:00" : "T06:00:00+02:00") });
        for (const [id, name, price] of [["sunset", "Sunset Paddle", 500], ["hike", "Midday Hike", 700]] as const) {
          fixture.rows.tours.push({ ...fixture.tour, id, name, base_price_per_person: price });
          fixture.rows.slots.push({ ...fixture.slot, id: id + "-slot", tour_id: id });
        }
      }
      json({ ok: true, requestedDate, dates }); return;
    }
    if (url.pathname === "/__fixture/inventory") {
      const input = JSON.parse(body);
      const slot = fixture.rows.slots.find(slot => slot.id === input.id);
      if (!slot) { json({ error: "Unknown fixture slot" }, 400); return; }
      Object.assign(slot, input.changes);
      Object.assign(fixture.failures, input.failures);
      json({ ok: true }); return;
    }
    if (url.pathname === "/__fixture/state") { json({ rows: fixture.rows, calls: fixture.calls }); return; }
    if (url.pathname === "/__fixture/agent") {
      const input = JSON.parse(body);
      const conversation = fixture.rows.conversations.at(-1);
      if (!conversation) { json({ error: "No handoff" }, 400); return; }
      if (input.end) { conversation.status = "BOT"; conversation.current_state = "AWAIT_RATING"; }
      fixture.rows.chat_messages.push({ business_id: "a", phone: conversation.phone, direction: "OUT", sender: "Admin", body: input.text, created_at: new Date().toISOString() });
      json({ ok: true }); return;
    }
    if (url.pathname === "/functions/v1/web-chat") {
      const input = JSON.parse(body || "{}");
      if (fixture.settings.llmReply === "DELAY") { await new Promise(resolve => setTimeout(resolve, 1500)); fixture.settings.llmReply = "Delayed old reply"; }
      const response = await fixture.request(input, { origin });
      json(await response.json(), response.status); return;
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").at(-1) || "";
      if (table === "businesses") {
        const theme = { ...fixture.business, subdomain: "fixture", color_main: "#154b43", color_cta: "#c65c2b", color_bg: "#eef3ef", chatbot_avatar: null, subscription_status: "ACTIVE", hero_title: "Fixture Kayak" };
        json(req.headers.accept?.includes("object") ? theme : [theme]); return;
      }
      if (table === "tours") { json(fixture.rows.tours); return; }
      if (table === "slots") { json(fixture.rows.slots); return; }
      json([]); return;
    }
    json({ error: "Unexpected fixture endpoint" }, 404);
  } catch (error) { json({ error: String(error) }, 500); }
}).listen(3094, "127.0.0.1", () => console.log("Isolated web-chat fixture listening on 127.0.0.1:3094"));
