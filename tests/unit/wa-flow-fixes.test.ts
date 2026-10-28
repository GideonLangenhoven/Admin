import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// Drives the real WhatsApp handleMsg with in-memory tables; network stays off.
const tenant = { business: { id: "tenant-a" } };
const phone = "27825550100";
const tour = { id: "20000000-0000-4000-8000-000000000001", business_id: "tenant-a", name: "Sunset Paddle", description: "Two hours on the bay.", duration_minutes: 120, base_price_per_person: 600 };

function query(result: any, filters: any[]) {
  const chain: any = {};
  for (const name of ["select", "update", "insert", "eq", "in", "not", "gt", "gte", "lt", "lte", "order", "limit"]) {
    chain[name] = (...args: any[]) => { filters.push([name, ...args]); return chain; };
  }
  chain.single = chain.maybeSingle = async () => result;
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function bot(state: string, stateData: any, tables: Record<string, any> = {}, extra: Record<string, unknown> = {}) {
  const sent: string[] = []; const changes: any[] = []; const filters: Record<string, any[]> = {};
  // The first step of ordinary IDLE/MENU handling; stops the run there.
  const ordinary = vi.fn(() => { throw new Error("reached ordinary handling"); });
  const handle = sourceFunction("supabase/functions/wa-webhook/index.ts", "handleMsg", {
    getConvo: async () => ({ id: "conversation-a", current_state: state, state_data: stateData }),
    supabase: { from: (table: string) => query({ data: tables[table] ?? (table === "outbox" ? [] : null) }, filters[table] ||= []), rpc: vi.fn() },
    getSubscriptionState: async () => ({ trading: true }), shouldBotReply: async () => ({ active: true }),
    sendText: async (_t: any, _p: any, message: string) => { sent.push(message); },
    sendButtons: async (_t: any, _p: any, body: string) => { sent.push(body); },
    setConvo: async (_id: string, data: any) => { changes.push(data); },
    logE: async () => { throw new Error("Unexpected bot error"); }, typingDelay: async () => undefined,
    isAvailabilityQuery: ordinary, formatDuration: (m: number) => m + " min", ...extra,
  });
  return { handle, sent, changes, filters, ordinary };
}

describe("WhatsApp booking flow", () => {
  for (const [state, id] of [["PICK_TOUR", "TOUR_"], ["GV_PICK_TOUR", "GV_"]]) {
    it(`${state} only loads a tour that belongs to this tenant`, async () => {
      const b = bot(state, {}, { tours: tour });
      await b.handle(tenant, phone, "", "interactive", { list_reply: { id: id + tour.id } });
      expect(b.filters.tours).toContainEqual(["eq", "business_id", "tenant-a"]);
    });
  }

  it("a redeemed voucher survives the tour pick", async () => {
    const voucher = { voucher_code: "ABCD2345", voucher_id: "v-1", voucher_value: 600, voucher_type: "FREE_TRIP", voucher_pax_limit: 1, voucher_purchase_value: 600 };
    const b = bot("PICK_TOUR", voucher, { tours: tour });
    await b.handle(tenant, phone, "", "interactive", { list_reply: { id: "TOUR_" + tour.id } });
    expect(b.changes).toEqual([{ current_state: "ASK_QTY", state_data: { ...voucher, tour_id: tour.id } }]);
  });

  for (const input of ["do you supply waterproof bags?", "which trip is most popular", "can i get a receipt"]) {
    it(`"${input}" is answered, not handed to a human`, async () => {
      const b = bot("IDLE", {});
      await b.handle(tenant, phone, input, "text");
      expect(b.ordinary).toHaveBeenCalled();
      expect(b.changes.some(c => c.status === "HUMAN")).toBe(false);
    });
  }

  for (const input of ["I just paid, here is my POP", "sent proof of payment", "I paid it already"]) {
    it(`"${input}" goes to the team`, async () => {
      const b = bot("IDLE", {});
      await b.handle(tenant, phone, input, "text");
      expect(b.changes).toEqual([{ status: "HUMAN", current_state: "IDLE", state_data: {} }]);
    });
  }

  it("a typed yes at the booking summary continues to the details step", async () => {
    const b = bot("CONFIRM_BOOKING", { tour_id: tour.id, qty: 2, total: 1200 });
    await b.handle(tenant, phone, "Yes please", "text");
    expect(b.changes).toEqual([{ current_state: "ASK_DETAILS", state_data: { tour_id: tour.id, qty: 2, total: 1200 } }]);
  });

  it("a typed yes at the gift voucher summary creates the voucher and payment link", async () => {
    const insertVoucherWithRetry = vi.fn(async () => ({ data: { id: "v-1" }, error: null }));
    const b = bot("GV_CONFIRM", { tour_id: tour.id, tour_name: tour.name, value: 600, buyer_email: "buyer@example.invalid" }, {}, {
      genVoucherCode: () => "ABCD2345", insertVoucherWithRetry,
      requestCheckout: async () => ({ id: "checkout-1", redirectUrl: "https://pay.example.invalid/1" }),
    });
    await b.handle(tenant, phone, "ok", "text");
    expect(insertVoucherWithRetry).toHaveBeenCalledWith(expect.objectContaining({ business_id: "tenant-a", value: 600 }));
    expect(b.changes.at(-1)).toMatchObject({ current_state: "GV_AWAITING_PAYMENT" });
  });

  for (const [state, prompt] of [["CONFIRM_BOOKING", "Reply *yes* to continue, or *no* to cancel."], ["GV_CONFIRM", "Reply *yes* to pay, or *no* to cancel."]]) {
    it(`${state} answers anything else with how to continue, instead of silence`, async () => {
      const b = bot(state, { tour_id: tour.id, value: 600 });
      await b.handle(tenant, phone, "can I bring my dog?", "text");
      expect(b.sent).toEqual([prompt]); expect(b.changes).toEqual([]);
    });

    it(`${state} cancels on a typed "no thanks"`, async () => {
      const b = bot(state, { tour_id: tour.id, value: 600 });
      await b.handle(tenant, phone, "no thanks", "text");
      expect(b.changes).toEqual([{ current_state: "IDLE", state_data: {} }]);
    });
  }
});
