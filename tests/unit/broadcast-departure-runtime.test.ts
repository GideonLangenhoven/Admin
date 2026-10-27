import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

// H5: a departure message goes out per channel. Email is queued for every
// guest with an address (durable queue, so it is logged and retried);
// WhatsApp only goes to opted-in guests on a connected number, and everyone
// else is skipped with a reason instead of blocking the whole send.
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const BROADCAST = "c0000000-0000-4000-8000-0000000000c1";
const guest = (id: string, slot_id: string, extra: Record<string, unknown> = {}) => ({
  id, business_id: A, slot_id, status: "PAID", customer_name: id + " Guest", email: id + "@example.invalid", phone: null,
  whatsapp_booking_updates_opt_in: false, ...extra,
});

function fixture({ waConnected = false, failPhone = "" } = {}) {
  const slots = [{ id: "slot-a", business_id: A }, { id: "slot-a2", business_id: A }, { id: "slot-b", business_id: B }];
  const bookings = [
    guest("email-only", "slot-a"),
    guest("opted-in", "slot-a2", { phone: "082 000 0001", whatsapp_booking_updates_opt_in: true }),
    guest("no-opt-in", "slot-a2", { phone: "082 000 0002", email: null }),
    guest("closed-window", "slot-a2", { phone: "082 000 0003", whatsapp_booking_updates_opt_in: true }),
    guest("send-fails", "slot-a2", { phone: "082 000 0004", whatsapp_booking_updates_opt_in: true }),
    guest("unsubscribed", "slot-a2", { email: "Unsubscribed@Example.invalid" }),
    guest("cancelled", "slot-a", { status: "CANCELLED" }),
    guest("tenant-b", "slot-b", { business_id: B }),
  ];
  // Item 10: an unsubscribe is honoured per operator, never across tenants.
  const contacts = [
    { business_id: A, email: "unsubscribed@example.invalid", status: "unsubscribed" },
    { business_id: B, email: "email-only@example.invalid", status: "unsubscribed" },
  ];
  const jobs = new Map<string, any>();
  const keys = new Map<string, any>();
  const outbox: any[] = [];
  const rpcs: any[] = [];
  const sent: string[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => (rpcs.push([name, args]), { data: null, error: null }),
    from(table: string) {
      const filters: [string, string, any][] = [];
      let op = "select", payload: any;
      const match = (row: any) => filters.every(([kind, col, v]) => kind === "eq" ? row[col] === v : v.includes(row[col]));
      const run = async () => {
        if (table === "slots") return { data: slots.filter(match), error: null };
        if (table === "bookings") return { data: bookings.filter(match), error: null };
        if (table === "marketing_contacts") return { data: contacts.filter(match), error: null };
        if (table === "notification_jobs") {
          const inserted = payload.filter((j: any) => !jobs.has(j.dedupe_key));
          for (const j of inserted) jobs.set(j.dedupe_key, j);
          return { data: inserted.map((j: any) => ({ id: j.dedupe_key })), error: null };
        }
        if (table === "idempotency_keys" && op === "insert") {
          if (keys.has(payload.key)) return { data: null, error: { code: "23505" } };
          keys.set(payload.key, payload);
          return { data: null, error: null };
        }
        if (table === "idempotency_keys") { Object.assign(keys.get(filters[0][2]) || {}, payload); return { data: null, error: null }; }
        if (table === "outbox") outbox.push(payload);
        return { data: null, error: null };
      };
      const q: any = {
        select: () => q, limit: () => q,
        eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q),
        in: (c: string, v: unknown[]) => (filters.push(["in", c, v]), q),
        insert: (v: unknown) => (op = "insert", payload = v, q),
        upsert: (v: unknown) => (op = "upsert", payload = v, q),
        update: (v: unknown) => (op = "update", payload = v, q),
        then: (yes: any, no: any) => run().then(yes, no),
      };
      return q;
    },
  };
  const handler = sourceHandler("supabase/functions/broadcast/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
    "../_shared/tenant.ts": {
      getAdminAppOrigins: () => ["https://admin.fixture.invalid"], isAllowedOrigin: () => true,
      getBusinessDisplayName: () => "Fixture Tours",
      getTenantByBusinessId: async (_db: unknown, id: string) => ({ business: { id }, credentials: waConnected ? { waToken: "t", waPhoneId: "p" } : {} }),
      sendWhatsappTextForTenant: async (_t: unknown, to: string) => {
        sent.push(to);
        if (to === failPhone) throw new Error("Recipient phone number not on WhatsApp");
        return { channel: to === "27820000003" ? "template" : "text" };
      },
    },
    "../_shared/auth.ts": {
      requireAuth: async (req: Request) => req.headers.get("authorization") === "Bearer super"
        ? { role: "SUPER_ADMIN", businessId: B } : { role: "MAIN_ADMIN", businessId: A },
    },
  }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" }, vi.fn(() => { throw new Error("no network"); }));
  const call = async (body: Record<string, unknown>, token = "admin") => {
    const res = await handler(new Request("https://fixture.invalid/broadcast", {
      method: "POST", headers: { authorization: "Bearer " + token },
      body: JSON.stringify({ action: "broadcast_targeted", target_group: "SLOT", message: "Hi {name}, meet at the slipway.", broadcast_id: BROADCAST, ...body }),
    }));
    return { status: res.status, body: await res.json() };
  };
  return { call, jobs, keys, outbox, rpcs, sent };
}

describe("departure broadcast", () => {
  it("emails the guest when WhatsApp is not connected, and says why WhatsApp was skipped", async () => {
    const { call, jobs, rpcs, sent } = fixture();
    const res = await call({ slot_ids: ["slot-a"] });
    expect(res).toEqual({ status: 200, body: {
      ok: true, broadcast_id: BROADCAST, guests: 1, reached: 1,
      email: { queued: 1, no_email: 0, unsubscribed: 0 },
      whatsapp: { sent: 0, waiting: 0, failed: 0, skipped: { not_connected: 1, no_number: 0, no_opt_in: 0 } },
    } });
    expect([...jobs.values()]).toEqual([{
      business_id: A, booking_id: "email-only", source_type: "DEPARTURE_BROADCAST", source_id: BROADCAST, template_type: "BROADCAST",
      recipient: "email-only@example.invalid", dedupe_key: "departure-broadcast/" + BROADCAST + "/email-only",
      payload: { business_id: A, booking_id: "email-only", customer_name: "email-only Guest", message: "Hi email-only, meet at the slipway." },
    }]);
    expect(sent).toEqual([]);
    expect(rpcs.map(([name, args]) => [name, args.p_amount])).toEqual([["increment_marketing_email_usage", 1], ["increment_marketing_monthly_usage", 1]]);

    // Sending the same message again reaches nobody twice and bills nothing more.
    expect((await call({ slot_ids: ["slot-a"] })).body.email.queued).toBe(1);
    expect(jobs.size).toBe(1);
    expect(rpcs).toHaveLength(2);
  });

  it("sends WhatsApp only to opted-in guests on a connected number, skips unsubscribed emails, and records every failure", async () => {
    const { call, jobs, keys, outbox, sent } = fixture({ waConnected: true, failPhone: "27820000004" });
    const res = await call({ slot_ids: ["slot-a2"] });
    expect(res.body).toMatchObject({
      guests: 5, reached: 3,
      email: { queued: 3, no_email: 1, unsubscribed: 1 },
      whatsapp: { sent: 1, waiting: 1, failed: 1, skipped: { not_connected: 0, no_number: 1, no_opt_in: 1 } },
    });
    expect(sent).toEqual(["27820000001", "27820000003", "27820000004"]);
    expect([...jobs.values()].map(j => j.booking_id)).toEqual(["opted-in", "closed-window", "send-fails"]);
    expect(outbox).toEqual([
      expect.objectContaining({ business_id: A, booking_id: "closed-window", status: "WAITING_WINDOW", message_body: "Hi closed-window, meet at the slipway." }),
      expect.objectContaining({ business_id: A, booking_id: "send-fails", status: "FAILED", error: "Recipient phone number not on WhatsApp" }),
    ]);
    expect(keys.get("departure-broadcast-wa/" + BROADCAST + "/opted-in").status).toBe("completed");
    expect(keys.get("departure-broadcast-wa/" + BROADCAST + "/send-fails").status).toBe("failed");

    await call({ slot_ids: ["slot-a2"] });
    expect(sent).toHaveLength(3);
  });

  it("only reaches the caller's own departures; super-admins use the tenant they switched into", async () => {
    const { call, jobs } = fixture();
    expect(await call({ slot_ids: ["slot-b"], business_id: B })).toEqual({ status: 404, body: { error: "Departure not found. No messages sent." } });
    expect(await call({ slot_ids: ["slot-a", "slot-b"] })).toMatchObject({ status: 404 });
    expect(jobs.size).toBe(0);

    const res = await call({ slot_ids: ["slot-b"], business_id: B }, "super");
    expect(res.body).toMatchObject({ ok: true, guests: 1, email: { queued: 1 } });
    expect([...jobs.values()].map(j => [j.business_id, j.booking_id])).toEqual([[B, "tenant-b"]]);
  });

  it("keeps promotion to everyone with Marketing", async () => {
    const { call, jobs } = fixture();
    expect(await call({ target_group: "ALL", slot_ids: [] })).toEqual({ status: 409, body: { error: "Pick the departures to message. Promotions go out from Marketing. No messages sent." } });
    expect(jobs.size).toBe(0);
  });
});
