import { describe, expect, it } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";

const env = {
  SUPABASE_URL: "https://fixture.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  CUSTOMER_SESSION_SECRET: "fixture-session-secret",
};
const customerSessions = sourceExports("supabase/functions/_shared/customer-session.ts", {}, env);
const chatSessions = sourceExports("supabase/functions/_shared/web-chat-session.ts", {
  "./customer-session.ts": customerSessions,
}, env) as { issueWebChatSession: (businessId: string) => Promise<{ token: string }> };

function fixture(rpcResult?: (endpoint: string) => boolean | "error" | "stall") {
  const counts = new Map<string, number>();
  const calls: Array<{ endpoint: string; key: string }> = [];
  const db = {
    rpc: (name: string, args: { p_ip: string; p_endpoint: string; p_max: number }) => {
      if (name !== "check_rate_limit") throw new Error("Unexpected RPC: " + name);
      calls.push({ endpoint: args.p_endpoint, key: args.p_ip });
      if (rpcResult?.(args.p_endpoint) === "stall") {
        return { abortSignal: (signal: AbortSignal) => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("synthetic aborted RPC")), { once: true });
        }) };
      }
      if (rpcResult?.(args.p_endpoint) === "error") {
        const failed = Promise.resolve({ data: null, error: { message: "synthetic limiter outage" } });
        return Object.assign(failed, { abortSignal: () => failed });
      }
      const key = args.p_ip + ":" + args.p_endpoint;
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      const result = Promise.resolve({ data: (rpcResult?.(args.p_endpoint) ?? count <= args.p_max) === true, error: null });
      return Object.assign(result, { abortSignal: () => result });
    },
    from: (table: string) => {
      if (!["conversations", "chat_messages"].includes(table)) throw new Error("Unexpected table: " + table);
      const query: any = {
        select: () => query, eq: () => query, gt: () => query, order: () => query,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return query;
    },
  };
  const handler = () => sourceHandler("supabase/functions/web-chat/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: unknown) => fn },
    "../_shared/duration.ts": {},
    "../_shared/tenant.ts": { getTenantByBusinessId: async () => ({ business: { id: "a", timezone: "UTC" } }) },
    "../_shared/bot-guards.ts": {}, "../_shared/intent.ts": {},
    "../_shared/subscription.ts": { getSubscriptionState: async () => ({ trading: false }) },
    "../_shared/chat-booking-pricing.ts": {}, "../_shared/platform-invariants.ts": {},
    "../_shared/llm.ts": { llmText: () => { throw new Error("Unexpected LLM call"); } },
    "../_shared/kb.ts": {},
    "../_shared/customer-session.ts": customerSessions,
    "../_shared/web-chat-session.ts": chatSessions,
  }, env);
  const post = (h: ReturnType<typeof handler>, body: object, ip = "192.0.2.44") => h(new Request("https://fixture.invalid/web-chat", {
    method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify({ business_id: "a", ...body }),
  }));
  return { handler, post, calls, counts };
}

describe("web chat shared ingress limits", () => {
  it("allows two signed visitors behind one IP to poll at the widget's four-second cadence", async () => {
    const f = fixture();
    const handler = f.handler();
    const first = (await chatSessions.issueWebChatSession("a")).token;
    const second = (await chatSessions.issueWebChatSession("a")).token;
    for (let i = 0; i < 15; i++) {
      expect((await f.post(handler, { action: "poll", chat_session: first })).status).toBe(200);
      expect((await f.post(handler, { action: "poll", chat_session: second })).status).toBe(200);
    }
    expect(f.calls.every(call => call.endpoint.startsWith("web-chat:poll:") && call.key !== "192.0.2.44")).toBe(true);
  });

  it("keeps signed session reloads on the poll budget when issuance is exhausted", async () => {
    const f = fixture(endpoint => endpoint === "web-chat:session:global" ? false : true);
    const handler = f.handler();
    const token = (await chatSessions.issueWebChatSession("a")).token;
    const resumed = await f.post(handler, { action: "session", chat_session: token });
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).chat_session).toBe(token);
    expect((await f.post(handler, { action: "session" })).status).toBe(429);
  });

  it("rejects the 21st message for one signed visitor across isolates", async () => {
    const f = fixture();
    const first = f.handler();
    const second = f.handler();
    const token = (await chatSessions.issueWebChatSession("a")).token;
    for (let i = 0; i < 20; i++) {
      expect((await f.post(i % 2 ? first : second, { chat_session: token, message: "hello" })).status).toBe(200);
    }
    const denied = await f.post(first, { chat_session: token, message: "hello" });
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("enforces a shared global limit even when the forwarded IP is missing or changes", async () => {
    const f = fixture(endpoint => endpoint === "web-chat:session:global" ? false : true);
    const handler = f.handler();
    expect((await f.post(handler, { action: "session" }, "")).status).toBe(429);
    expect((await f.post(handler, { action: "session" }, "198.51.100.99")).status).toBe(429);
    expect(f.calls.filter(call => call.endpoint === "web-chat:session:global").map(call => call.key)).toEqual(["global", "global"]);
  });

  it("caps origin-based tenant lookup before querying a caller-selected subdomain", async () => {
    const f = fixture(endpoint => endpoint === "web-chat:context:global" ? false : true);
    const response = await f.handler()(new Request("https://fixture.invalid/web-chat", {
      method: "POST", headers: { origin: "https://forged.booking.bookingtours.co.za" },
      body: JSON.stringify({ action: "session" }),
    }));
    expect(response.status).toBe(429);
    expect(f.calls.map(call => call.endpoint)).toEqual(["web-chat:context:global"]);
  });

  it("rejects actual oversized request bytes before any tenant or limiter work", async () => {
    const f = fixture();
    const handler = f.handler();
    const body = JSON.stringify({ action: "session", business_id: "a", padding: "x".repeat(70_000) });
    const response = await handler(new Request("https://fixture.invalid/web-chat", {
      method: "POST", headers: { "x-forwarded-for": "192.0.2.44", "content-length": "5" }, body,
    }));
    expect(response.status).toBe(413);
    expect(f.calls).toEqual([]);
  });

  it("accepts the widget's eleven-message history and bounds a twelfth or oversized message", async () => {
    const f = fixture();
    const handler = f.handler();
    const token = (await chatSessions.issueWebChatSession("a")).token;
    const history = Array.from({ length: 11 }, (_, index) => ({ role: index % 2 ? "bot" : "user", text: "hello" }));
    expect((await f.post(handler, { chat_session: token, message: "hello", messages: history })).status).toBe(200);
    const before = f.calls.length;
    expect((await f.post(handler, { chat_session: token, message: "hello", messages: [...history, history[0]] })).status).toBe(413);
    expect((await f.post(handler, { chat_session: token, message: "x".repeat(4097) })).status).toBe(413);
    expect(f.calls).toHaveLength(before);
  });

  it("cancels a stalled request body at the deadline before tenant or limiter work", async () => {
    const f = fixture();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const request = new Request("https://fixture.invalid/web-chat", {
      method: "POST", body, duplex: "half",
    } as RequestInit & { duplex: "half" });
    const started = Date.now();
    const response = await f.handler()(request);
    expect(response.status).toBe(408);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(cancelled).toBe(true);
    expect(f.calls).toEqual([]);
  }, 5000);

  it("fails without issuing a chat session when the shared limiter is unavailable", async () => {
    const f = fixture(() => "error");
    const response = await f.post(f.handler(), { action: "session" });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
  });

  it("aborts a stalled shared limiter and fails closed at its deadline", async () => {
    const f = fixture(() => "stall");
    const started = Date.now();
    const response = await f.post(f.handler(), { action: "session" });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
