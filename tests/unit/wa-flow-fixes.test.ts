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
});
