import { describe, expect, it, vi } from "vitest";
import { operationalCancellationFollowup } from "../../supabase/functions/_shared/marketing-outbox";
import { sourceFunction } from "../helpers/source-handler";

// Messages parked while the guest's 24-hour window was closed go out on their
// next reply: once, only what the sender promised, and never after a STOP.
const tenant = { business: { id: "tenant-a" } };
const phone = "27825550100";
const booking = { id: "booking-a", business_id: "tenant-a", status: "PAID", whatsapp_booking_updates_opt_in: true };
const parked = (row: any) => ({ id: "row-" + row.message_type, business_id: "tenant-a", phone, status: "WAITING_WINDOW", booking_id: null, message_body: "Hi, your guide here", created_at: new Date().toISOString(), ...row });

function bot(tables: Record<string, any[]>, sendResult: any = { ok: true, windowClosed: false, error: "" }) {
  const sends: string[] = [];
  const from = (name: string) => {
    const rows = tables[name] ||= [];
    const filters: ((row: any) => boolean)[] = [];
    let patch: any = null; let inserted: any = null;
    const run = () => {
      if (inserted) return { data: [inserted], error: null };
      const hit = rows.filter(row => filters.every(filter => filter(row)));
      if (patch) hit.forEach(row => Object.assign(row, patch));
      return { data: hit, error: null };
    };
    const q: any = {
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
      gte: (key: string, value: unknown) => { filters.push(row => row[key] >= value); return q; },
      update: (value: any) => { patch = value; return q; },
      insert: (value: any) => { inserted = { id: "new", ...value }; return q; },
      single: async () => ({ data: run().data[0] || null, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    q.maybeSingle = q.single;
    for (const name of ["select", "in", "not", "gt", "lt", "lte", "order", "limit"]) q[name] = () => q;
    return q;
  };
  const handle = sourceFunction("supabase/functions/wa-webhook/index.ts", "handleMsg", {
    getConvo: async () => ({ id: "conversation-a", current_state: "IDLE", state_data: {} }),
    supabase: { from, rpc: async () => ({ data: 1, error: null }) },
    operationalCancellationFollowup,
    sendWhatsappFreeformOrSignal: async (_t: any, _to: string, body: string) => { sends.push(body); return sendResult; },
    getSubscriptionState: async () => ({ trading: true }), shouldBotReply: async () => ({ active: true }),
    sendText: async () => undefined, setConvo: async () => undefined, logE: async () => undefined,
    // The first step of ordinary message handling; stops the run there.
    isAvailabilityQuery: vi.fn(() => { throw new Error("reached ordinary handling"); }),
  });
  return { handle: (text = "hi") => handle(tenant, phone, text, "text"), sends, tables };
}

describe("WhatsApp window-closed outbox", () => {
  it("an operator's reply goes out when the guest replies, once", async () => {
    const b = bot({ outbox: [parked({ message_type: "ADMIN_FOLLOWUP" })] });
    await Promise.all([b.handle(), b.handle("thanks")]);
    expect(b.sends).toEqual(["Hi, your guide here"]);
    expect(b.tables.outbox[0]).toMatchObject({ status: "SENT" });
  });

  it("failed sends and departure broadcasts are delivered too", async () => {
    const b = bot({ bookings: [booking], outbox: [parked({ message_type: "WINDOW_CLOSED_RETRY" }), parked({ message_type: "BROADCAST_FOLLOWUP", booking_id: "booking-a", message_body: "Meet at the north slipway" })] });
    await b.handle();
    expect(b.sends).toEqual(["Hi, your guide here", "Meet at the north slipway"]);
  });

  it("a STOP reply releases nothing, and a guest who opted out gets no broadcast later", async () => {
    const b = bot({ bookings: [{ ...booking, whatsapp_booking_updates_opt_in: false }], outbox: [parked({ message_type: "ADMIN_FOLLOWUP" }), parked({ message_type: "BROADCAST_FOLLOWUP", booking_id: "booking-a" })] });
    await b.handle("stop");
    expect(b.sends).toEqual([]);
    await b.handle();
    expect(b.sends).toEqual(["Hi, your guide here"]);
    expect(b.tables.outbox[1].status).toBe("WAITING_WINDOW");
  });

  it("stale rows, unknown kinds and another tenant's booking stay held", async () => {
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const b = bot({ bookings: [{ ...booking, business_id: "tenant-b" }], outbox: [
      parked({ message_type: "ADMIN_FOLLOWUP", created_at: old }), parked({ message_type: "PROMOTION" }),
      parked({ message_type: "WINDOW_CLOSED_RETRY", booking_id: "booking-a" }),
    ] });
    await b.handle();
    expect(b.sends).toEqual([]);
  });

  it("a send that fails for another reason is listed for a retry", async () => {
    const b = bot({ outbox: [parked({ message_type: "ADMIN_FOLLOWUP" })] }, { ok: false, windowClosed: false, error: "Number not on WhatsApp" });
    await b.handle();
    expect(b.tables.outbox[0]).toMatchObject({ status: "FAILED", error: "Number not on WhatsApp" });
  });
});
