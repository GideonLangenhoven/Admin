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

  it("a forecast error gives the morning-check message, not a calm-seas all-clear", async () => {
    const sent: string[] = []; const errors: string[] = [];
    const booking = { data: null };
    const chain: any = { select: () => chain, in: () => chain, eq: () => chain, order: () => chain, limit: () => chain, single: async () => booking };
    const check = sourceFunction(wa, "checkWeatherConcern", {
      supabase: { from: () => chain }, fmtTime: () => "", tenantTimeZone: () => "Africa/Johannesburg", console: { ...console, error: (...args: any[]) => { errors.push(args.join(" ")); } }, fetch: async () => reply(400, JSON.stringify({ error: true, reason: "forecast_days out of range" })),
      sendText: async (_t: any, _p: any, message: string) => { sent.push(message); }, sendButtons: async () => undefined,
    });
    expect(await check(tenant, "27825550100", "how does the weather look tomorrow")).toBe(true);
    expect(sent[0]).toContain("We check conditions every morning");
    expect(sent[0]).not.toContain("looking good");
    expect(errors.join("\n")).toContain("Forecast unavailable: 400/400");
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
