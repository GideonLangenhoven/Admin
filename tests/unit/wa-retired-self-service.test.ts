import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// Chat self-service for existing bookings is retired: WhatsApp sends guests to
// My Bookings, which runs every change on the server. Nothing here may write.
const tenant = { business: { id: "tenant-a" } };
const phone = "27825550100";
const bookingId = "10000000-0000-4000-8000-000000000001";
const weatherCancel = {
  status: "CANCELLED", cancellation_reason: "Weather cancellation", refund_status: "ACTION_REQUIRED",
  cancellation_self_service: true, cancellation_options: ["RESCHEDULE", "VOUCHER", "REFUND"],
};

function query(result: any, filters: any[]) {
  const chain: any = {};
  for (const name of ["select", "update", "insert", "eq", "in", "not", "gt", "gte", "lte", "order", "limit"]) {
    chain[name] = (...args: any[]) => { filters.push([name, ...args]); return chain; };
  }
  chain.single = chain.maybeSingle = async () => result;
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function bot(state: string, stateData: any, booking: any) {
  const sent: string[] = []; const changes: any[] = []; const filters: any[] = []; const redirects: any[] = [];
  const rpc = vi.fn();
  // The first step of ordinary message handling; stops the run there.
  const ordinary = vi.fn(() => { throw new Error("reached ordinary handling"); });
  const handle = sourceFunction("supabase/functions/wa-webhook/index.ts", "handleMsg", {
    startTyping: () => () => undefined,
    getConvo: async () => ({ id: "conversation-a", current_state: state, state_data: stateData }),
    supabase: { from: (table: string) => query({ data: table === "bookings" ? booking : table === "outbox" ? [] : null }, filters), rpc },
    getSubscriptionState: async () => ({ trading: true }), shouldBotReply: async () => ({ active: true }),
    sendText: async (_t: any, _p: any, message: string) => { sent.push(message); },
    setConvo: async (_id: string, data: any) => { changes.push(data); },
    sendManageBookingsRedirect: async (_t: any, to: string, convoId: string) => { redirects.push([to, convoId]); },
    logE: async () => { throw new Error("Unexpected bot error"); }, isAvailabilityQuery: ordinary,
  });
  return { handle, sent, changes, filters, redirects, rpc, ordinary, writes: () => filters.filter(f => f[0] === "update") };
}

describe("WhatsApp retired self-service", () => {
  for (const state of ["BOOKING_ACTIONS", "EDIT_GUESTS_QTY", "CONFIRM_CANCEL_ACTION", "CONFIRM_WX_REFUND_ACTION", "RESCHEDULE_PICK", "CHANGE_TOUR_SLOT"]) {
    it(`a conversation parked in ${state} goes to My Bookings without touching the booking`, async () => {
      const b = bot(state, { booking_id: bookingId }, { ...weatherCancel, status: "PAID" });
      await b.handle(tenant, phone, "1", "text");
      expect(b.redirects).toEqual([[phone, "conversation-a"]]);
      expect(b.sent).toEqual([]); expect(b.writes()).toEqual([]); expect(b.rpc).not.toHaveBeenCalled();
    });
  }

  it("an in-progress chat reschedule goes to My Bookings", async () => {
    const b = bot("PICK_SLOT", { booking_id: bookingId, is_reschedule: true }, { ...weatherCancel, status: "PAID" });
    await b.handle(tenant, phone, "2", "text");
    expect(b.redirects).toHaveLength(1); expect(b.writes()).toEqual([]); expect(b.rpc).not.toHaveBeenCalled();
  });

  for (const id of ["BK_", "ACT_CANCEL_", "ACT_RESCH_", "WEATHER_REFUND_"].map(prefix => prefix + bookingId)) {
    it(`a replayed ${id.slice(0, -36)} button goes to My Bookings, checked against the caller's tenant`, async () => {
      const b = bot("IDLE", {}, { ...weatherCancel, status: "PAID" });
      await b.handle(tenant, phone, "", "interactive", { button_reply: { id } });
      expect(b.redirects).toHaveLength(1);
      expect(b.filters).toContainEqual(["eq", "business_id", "tenant-a"]);
      expect(b.writes()).toEqual([]); expect(b.rpc).not.toHaveBeenCalled();
    });
  }

  it("a weather-cancel reply that still needs the guest's choice goes to My Bookings once", async () => {
    const b = bot("IDLE", {}, weatherCancel);
    await b.handle(tenant, phone, "Can I get a voucher please", "text");
    expect(b.redirects).toHaveLength(1);
    expect(b.changes).toEqual([{ state_data: { wx_redirected: true } }]);
    expect(b.filters).toContainEqual(["eq", "business_id", "tenant-a"]);
    expect(b.filters).toContainEqual(["in", "phone", [phone, "+" + phone]]); // booked on the website as +27…
    expect(b.writes()).toEqual([]); expect(b.rpc).not.toHaveBeenCalled();
  });

  for (const [label, state, stateData, input, booking] of [
    ["after the redirect", "MENU", { wx_redirected: true }, "voucher", weatherCancel],
    ["once the choice is settled", "IDLE", {}, "refund", { ...weatherCancel, refund_status: "PROCESSED" }],
    ["for a bare number (no hidden menu)", "IDLE", {}, "1", weatherCancel],
  ] as const) {
    it(`a weather keyword is an ordinary message ${label}`, async () => {
      const b = bot(state, stateData, booking);
      await b.handle(tenant, phone, input, "text");
      expect(b.ordinary).toHaveBeenCalled();
      expect(b.redirects).toEqual([]); expect(b.writes()).toEqual([]);
    });
  }
});
