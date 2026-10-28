import { describe, expect, it, vi } from "vitest";
import { MEDIA_FALLBACK_REPLY } from "../../supabase/functions/_shared/bot-guards";
import { sourceFunction } from "../helpers/source-handler";

// Voice notes, locations and template button taps used to vanish: no Inbox
// entry, no reply, and no drain of messages parked on a closed window.
const wa = "supabase/functions/wa-webhook/index.ts";
const tenant = { business: { id: "tenant-a" } };
const phone = "27825550100";

function inbound() {
  const handleMsg = vi.fn(async () => undefined);
  const supabase = { from: () => ({ insert: async () => ({ error: null }) }), rpc: async () => ({ data: true, error: null }) };
  const process = sourceFunction(wa, "processWhatsappValue", { supabase, handleMsg, Response });
  return { handleMsg, send: (message: any) => process(tenant, {}, { id: "wamid-" + message.type, from: phone, ...message }) };
}

function bot(status = "BOT") {
  const sent: string[] = []; const logged: string[] = [];
  const ordinary = vi.fn(() => { throw new Error("reached ordinary handling"); });
  const chain: any = { then: (resolve: any) => resolve({ data: [] }), maybeSingle: async () => ({ data: null }), single: async () => ({ data: { id: "m" } }) };
  for (const name of ["select", "update", "eq", "gte", "order", "limit"]) chain[name] = () => chain;
  chain.insert = (row: any) => { logged.push(row.body); return chain; };
  const handle = sourceFunction(wa, "handleMsg", {
    startTyping: () => () => undefined,
    getConvo: async () => ({ id: "conversation-a", status, current_state: "IDLE", state_data: {} }),
    supabase: { from: () => chain, rpc: async () => ({ data: 1, error: null }) },
    getSubscriptionState: async () => ({ trading: true }), shouldBotReply: async () => ({ active: true }),
    sendText: async (_t: any, _p: any, message: string) => { sent.push(message); },
    setConvo: async () => undefined, logE: async () => undefined, isAvailabilityQuery: ordinary, MEDIA_FALLBACK_REPLY,
  });
  return { handle, sent, logged, ordinary };
}

describe("WhatsApp non-text messages", () => {
  it("a template quick-reply tap is read as its text", async () => {
    const b = inbound();
    await b.send({ type: "button", button: { text: "Yes, send it", payload: "yes" } });
    expect(b.handleMsg.mock.calls[0].slice(1, 4)).toEqual([phone, "Yes, send it", "button"]);
  });

  it("a voice note reaches the bot as a labelled placeholder; reactions stay silent", async () => {
    const b = inbound();
    await b.send({ type: "audio", audio: { id: "media-a", voice: true } });
    await b.send({ type: "reaction", reaction: { emoji: "👍" } });
    expect(b.handleMsg.mock.calls.map((call: any[]) => call.slice(2, 4))).toEqual([["[audio message]", "audio"]]);
  });

  it("the bot logs it for the Inbox and says it can only read text", async () => {
    const b = bot();
    await b.handle(tenant, phone, "[location message]", "location");
    expect(b.logged).toContain("[location message]");
    expect(b.sent).toEqual([MEDIA_FALLBACK_REPLY]);
    expect(b.ordinary).not.toHaveBeenCalled();
  });

  it("stays quiet while a person is handling the chat", async () => {
    const b = bot("HUMAN");
    await b.handle(tenant, phone, "[audio message]", "audio");
    expect(b.sent).toEqual([]);
  });
});
