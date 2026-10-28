import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// Guests see blue ticks and WhatsApp's real "typing…" while the bot works, not a fake pause.
const wa = "supabase/functions/wa-webhook/index.ts";
const tenant = { business: { id: "tenant-a" }, credentials: { waPhoneId: "phone-id", waToken: "token" } };
const phone = "27825550100";

function bot(status = "BOT") {
  const typing: string[] = []; const stopped: string[] = []; const sent: string[] = [];
  const chain: any = { then: (resolve: any) => resolve({ data: [] }), maybeSingle: async () => ({ data: null }), single: async () => ({ data: { id: "m" } }) };
  for (const name of ["select", "insert", "update", "eq", "gte", "order", "limit"]) chain[name] = () => chain;
  const handle = sourceFunction(wa, "handleMsg", {
    readGuestMessage: async () => null, guestLanguage: new Map(),
    startTyping: (_t: any, id: string) => { typing.push(id); return () => stopped.push(id); },
    getConvo: async () => ({ id: "conversation-a", status, current_state: "IDLE", state_data: {} }),
    supabase: { from: () => chain, rpc: async () => ({ data: 1, error: null }) },
    getSubscriptionState: async () => ({ trading: true }), shouldBotReply: async () => ({ active: true }),
    sendText: async (_t: any, _p: any, message: string) => { sent.push(message); },
    setConvo: async () => undefined, logE: async () => undefined,
    isAvailabilityQuery: () => { throw new Error("reached ordinary handling"); },
  });
  return { handle, typing, stopped, sent };
}

describe("WhatsApp typing indicator", () => {
  it("marks the message read with typing, renews it, and stops when the turn ends", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
      const startTyping = sourceFunction(wa, "startTyping", { fetch, console, setInterval, clearInterval });
      const stop = startTyping(tenant, "wamid-1");
      const body = JSON.parse((fetch.mock.calls[0] as any)[1].body);
      expect(body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid-1", typing_indicator: { type: "text" } });
      vi.advanceTimersByTime(40_000);
      expect(fetch).toHaveBeenCalledTimes(3);
      stop();
      vi.advanceTimersByTime(60_000);
      expect(fetch).toHaveBeenCalledTimes(3);
      startTyping(tenant, "")();
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows only on turns the bot answers, and always stops", async () => {
    const answered = bot();
    await answered.handle(tenant, phone, "any space tomorrow?", "text", undefined, false, "wamid-1");
    expect(answered.typing).toEqual(["wamid-1"]);
    expect(answered.stopped).toEqual(["wamid-1"]);
    const quiet = bot();
    await quiet.handle(tenant, phone, "any space tomorrow?", "text", undefined, true, "wamid-2");
    const human = bot("HUMAN");
    await human.handle(tenant, phone, "any space tomorrow?", "text", undefined, false, "wamid-3");
    expect([...quiet.typing, ...human.typing]).toEqual([]);
  });

  it("no fake typing pause is left", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(wa, "utf8")).not.toMatch(/typingDelay/);
  });
});
