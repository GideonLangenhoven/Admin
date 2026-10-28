import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// One WhatsApp number can't run up a tenant's AI allowance by scripting messages.
const wa = "supabase/functions/wa-webhook/index.ts";
const tenant = { business: { id: "tenant-a" } };
const phone = "27825550100";

function inbound(rpc: (name: string, args: any) => Promise<any>) {
  const handleMsg = vi.fn(async () => undefined);
  const supabase = { from: () => ({ insert: async () => ({ error: null }) }), rpc };
  const process = sourceFunction(wa, "processWhatsappValue", { supabase, handleMsg, Response });
  const send = (n: number) => process(tenant, {}, { id: "wamid-" + n, from: phone, type: "text", text: { body: "any space tomorrow?" } });
  return { handleMsg, send };
}

function bot() {
  const sent: string[] = []; const rpcs: string[] = [];
  const ordinary = vi.fn(() => { throw new Error("reached ordinary handling"); });
  const chain: any = { then: (resolve: any) => resolve({ data: [] }), maybeSingle: async () => ({ data: null }), single: async () => ({ data: { id: "m" } }) };
  for (const name of ["select", "insert", "update", "eq", "gte", "order", "limit"]) chain[name] = () => chain;
  const handle = sourceFunction(wa, "handleMsg", {
    startTyping: () => () => undefined,
    getConvo: async () => ({ id: "conversation-a", current_state: "IDLE", state_data: {} }),
    supabase: { from: () => chain, rpc: async (name: string) => { rpcs.push(name); return { data: 1, error: null }; } },
    getSubscriptionState: async () => ({ trading: true }), shouldBotReply: async () => ({ active: true }),
    sendText: async (_t: any, _p: any, message: string) => { sent.push(message); },
    setConvo: async () => undefined, logE: async () => undefined, isAvailabilityQuery: ordinary,
  });
  return { handle, sent, rpcs, ordinary };
}

describe("WhatsApp per-number rate limit", () => {
  it("counts each inbound message once and quiets the bot past 20 a minute", async () => {
    const counts: Record<string, number> = {};
    const { handleMsg, send } = inbound(async (_name, args) => {
      counts[args.p_ip + "|" + args.p_endpoint] = (counts[args.p_ip + "|" + args.p_endpoint] || 0) + 1;
      return { data: counts[args.p_ip + "|" + args.p_endpoint] <= args.p_max, error: null };
    });
    for (let n = 0; n < 21; n++) await send(n);
    expect(handleMsg.mock.calls.map((call: any[]) => call[5])).toEqual([...Array(20).fill(false), true]);
    expect(Object.keys(counts)).toEqual(["tenant-a:" + phone + "|wa-bot"]);
  });

  it("a limiter outage never silences the bot", async () => {
    const { handleMsg, send } = inbound(async () => ({ data: null, error: { message: "timeout" } }));
    await send(1);
    expect(handleMsg.mock.calls[0][5]).toBe(false);
  });

  it("a quiet bot sends nothing, but STOP still unsubscribes", async () => {
    const b = bot();
    await b.handle(tenant, phone, "any space tomorrow?", "text", undefined, true);
    expect(b.ordinary).not.toHaveBeenCalled();
    expect(b.sent).toEqual([]);
    await b.handle(tenant, phone, "stop", "text", undefined, true);
    expect(b.rpcs).toContain("stop_optional_whatsapp_messages");
    expect(b.sent[0]).toContain("unsubscribed");
  });
});
