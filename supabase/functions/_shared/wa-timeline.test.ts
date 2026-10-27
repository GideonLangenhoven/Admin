// deno test --allow-env --allow-net=127.0.0.1 _shared/wa-timeline.test.ts
// P2 Activity Timeline: a WhatsApp message sent for a booking leaves a
// "whatsapp_sent" row (type, recipient, provider id) on that booking's log.
import { sendWhatsappTextForTenant } from "./tenant.ts";

const BUSINESS = "10000000-0000-4000-8000-000000000001";
const BOOKING = "10000000-0000-4000-8000-000000000021";
const tenant = { business: { id: BUSINESS, business_name: "Test Co" }, credentials: { waToken: "token", waPhoneId: "phone-id" } } as any;

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:9");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");

// Answers Meta and records every database write, as table -> row.
function stubNetwork(graph: (body: any) => Response) {
  const writes: { table: string; row: any }[] = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("https://graph.facebook.com/")) return graph(body);
    writes.push({ table: new URL(url).pathname.replace("/rest/v1/", ""), row: body });
    return new Response(null, { status: 201 });
  };
  return writes;
}
const sent = () => Response.json({ messages: [{ id: "wamid.TEST" }] });

function assertEquals(actual: unknown, expected: unknown, msg: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(msg + "\n  expected " + JSON.stringify(expected) + "\n  received " + JSON.stringify(actual));
}

Deno.test("a booking message is logged on that booking's timeline", async () => {
  const writes = stubNetwork(sent);
  await sendWhatsappTextForTenant(tenant, "082 123 4567", "Your trip moved", undefined, BOOKING);
  assertEquals(writes.find(w => w.table === "logs")?.row, {
    business_id: BUSINESS, booking_id: BOOKING, event: "whatsapp_sent",
    payload: { type: "text", to: "27821234567", provider_id: "wamid.TEST" },
  }, "timeline row");
  assertEquals(writes.find(w => w.table === "wa_messages")?.row.booking_id, BOOKING, "audit row names the booking");
});

Deno.test("a template sent when the 24h window is closed is logged by template name", async () => {
  const writes = stubNetwork(body => body.type === "text"
    ? Response.json({ error: { code: 131047, message: "Re-engagement message" } }, { status: 400 })
    : sent());
  await sendWhatsappTextForTenant(tenant, "27821234567", "Reminder", { name: "booking_reminder", params: ["Ana"] }, BOOKING);
  assertEquals(writes.filter(w => w.table === "logs").map(w => w.row.payload.type), ["booking_reminder"], "template timeline row");
});

Deno.test("a message with no booking leaves no timeline row", async () => {
  const writes = stubNetwork(sent);
  await sendWhatsappTextForTenant(tenant, "27821234567", "Operator alert");
  assertEquals(writes.map(w => w.table), ["wa_messages"], "only the audit row");
});
