import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// Provider failures must take the safe path, not crash the turn or send the wrong thing.
const wa = "supabase/functions/wa-webhook/index.ts";
const tenant = { business: { id: "tenant-a", timezone: "Africa/Johannesburg" }, credentials: { waPhoneId: "phone-id", waToken: "token" } };
const reply = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "application/json" } });

function sender(...responses: Response[]) {
  const fetch = vi.fn(async () => responses.shift()!);
  const send = sourceFunction(wa, "sendWA", {
    fetch, Deno: { env: { get: () => "reopen_template" } }, recordWaMessage: async () => undefined,
    supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
  });
  return { fetch, send: () => send(tenant, "27825550100", { type: "text", text: { body: "Hi" } }) };
}

describe("WhatsApp provider errors", () => {
  it("only Meta's closed-window code sends the reopen template", async () => {
    const other = sender(reply(400, JSON.stringify({ error: { code: 100, message: "Param text['body'] must be at most 1024 characters" } })));
    await other.send();
    expect(other.fetch).toHaveBeenCalledTimes(1);
    const closed = sender(reply(400, JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } })), reply(200, "{}"));
    await closed.send();
    expect(JSON.parse(closed.fetch.mock.calls[1][1].body).template.name).toBe("reopen_template");
  });

  it("a non-JSON Meta error doesn't crash the turn", async () => {
    await expect(sender(reply(502, "<html>Bad gateway</html>")).send()).resolves.toMatchObject({ error: { message: "HTTP 502" } });
  });

  it("a non-JSON checkout error reads as an unavailable link", async () => {
    const checkout = sourceFunction(wa, "requestCheckout", { fetch: async () => reply(502, "<html>Bad gateway</html>"), SUPABASE_URL: "https://x.invalid", SUPABASE_KEY: "k" });
    expect(await checkout({ type: "BOOKING" })).toEqual({ error: "Payment link unavailable" });
  });

  it("answers weather questions with the operator's policy, never a forecast", async () => {
    const ask = async (business: any) => {
      const sent: string[] = []; const fetch = vi.fn();
      const chain: any = { select: () => chain, in: () => chain, eq: () => chain, order: () => chain, limit: () => chain, single: async () => ({ data: null }) };
      const check = sourceFunction(wa, "checkWeatherConcern", {
        supabase: { from: () => chain }, fmtTime: () => "", fetch, getFaqAnswer: sourceFunction(wa, "getFaqAnswer", {}),
        sendText: async (_t: any, _p: any, message: string) => { sent.push(message); }, sendButtons: async () => undefined,
      });
      expect(await check({ ...tenant, business: { ...tenant.business, ...business } }, "27825550100", "how does the weather look tomorrow")).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      return sent[0];
    };
    expect(await ask({ faq_json: { weather: "Hikes run in light rain; storms mean we reschedule." } })).toBe("Hikes run in light rain; storms mean we reschedule.");
    const generic = await ask({});
    expect(generic).toContain("We check conditions before every trip");
    expect(generic).not.toMatch(/swell|wind|looking good/i);
  });
});

describe("WhatsApp slot price", () => {
  const price = (result: any) => sourceFunction(wa, "getSlotPrice", { supabase: { from: () => ({ select: () => ({ eq: () => ({ single: async () => result }) }) }) } });
  it("never falls back to a made-up R600", async () => {
    await expect(price({ data: null, error: { message: "timeout" } })({ tour_id: "tour-a" })).rejects.toThrow("PRICE_UNAVAILABLE");
    await expect(price({ data: { base_price_per_person: null }, error: null })({ tour_id: "tour-a" })).rejects.toThrow("PRICE_UNAVAILABLE");
    expect(await price({ data: { base_price_per_person: 450 }, error: null })({ tour_id: "tour-a" })).toBe(450);
    expect(await price({ data: null, error: null })({ tour_id: "tour-a", price_per_person_override: 520 })).toBe(520);
  });
});
