import { describe, expect, it, vi } from "vitest";
import { sourceFunction, sourceHandler } from "../helpers/source-handler";

const token = "11111111-1111-4111-8111-111111111111";
const invite = {
  id: "invite-a", token, business_id: "tenant-a", client_name: "Fixture Owner",
  client_email: "owner@fixture.invalid", wizard_step: "identity",
  expires_at: "2030-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
};

function fixture(options: {
  rate?: (endpoint: string) => boolean | "error";
  slotRows?: () => unknown[];
  fetch?: typeof fetch;
} = {}) {
  const reads: string[] = [];
  const writes: string[] = [];
  const rpcCalls: Array<{ endpoint: string; key: string }> = [];
  const generated = vi.fn(async () => ({ slots_created: 0, slots_skipped: 0, errors: [] }));
  const db = {
    rpc: (name: string, args: { p_endpoint: string; p_ip: string }) => {
      if (name !== "check_rate_limit") throw new Error("Unexpected RPC: " + name);
      rpcCalls.push({ endpoint: args.p_endpoint, key: args.p_ip });
      const choice = options.rate?.(args.p_endpoint) ?? true;
      const result = Promise.resolve(choice === "error"
        ? { data: null, error: { message: "synthetic limiter outage" } }
        : { data: choice, error: null });
      return Object.assign(result, { abortSignal: () => result });
    },
    from: (table: string) => {
      if (!["invite_tokens", "businesses", "tours"].includes(table)) throw new Error("Unexpected table: " + table);
      const q: any = {
        select: () => q, eq: () => q, is: () => q, gt: () => q,
        insert: () => { writes.push(table + ":insert"); return q; },
        update: () => { writes.push(table + ":update"); return q; },
        maybeSingle: async () => {
          reads.push(table);
          return { data: table === "invite_tokens" ? invite : table === "businesses"
            ? { business_name: "Fixture", timezone: "Africa/Johannesburg" } : null, error: null };
        },
        single: async () => ({ data: { id: "tour-created" }, error: null }),
        then: (resolve: (result: { error: null }) => void) => Promise.resolve({ error: null }).then(resolve),
      };
      return q;
    },
    functions: { invoke: () => { throw new Error("Unexpected provider invocation"); } },
  };
  const handler = sourceHandler("supabase/functions/onboarding-wizard/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
    "../_shared/otp-attempts.ts": {},
    "../_shared/slot-generation.ts": { generateSlots: generated, buildSlotRows: options.slotRows || (() => []) },
    "../_shared/onboarding-guards.ts": { STEP_COLUMNS: {}, parsePublicUrl: () => { throw new Error("Unexpected website fetch"); } },
  }, {
    SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    GOOGLE_PLACES_API_KEY: "synthetic-places-key",
  }, options.fetch);
  const post = (body: object, headers: Record<string, string> = {}) => handler(new Request("https://fixture.invalid/onboarding-wizard", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ token, ...body }),
  }));
  return { handler, post, reads, writes, rpcCalls, generated };
}

const tour = (name: string, ranges: unknown[] = []) => ({ name, base_price_per_person: 400, duration_minutes: 90, ranges });

describe("onboarding wizard bounded ingress", () => {
  it("does not permit missing-IP traffic to bypass a shared denial", async () => {
    const f = fixture({ rate: () => false });
    const response = await f.post({ action: "validate" });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(f.reads).toEqual([]);
  });

  it("fails closed before invite lookup when the shared limiter errors", async () => {
    const f = fixture({ rate: () => "error" });
    const response = await f.post({ action: "validate" });
    expect(response.status).toBe(503);
    expect(f.reads).toEqual([]);
  });

  it("bounds actual JSON bytes even if Content-Length understates them", async () => {
    const f = fixture();
    const response = await f.post({ action: "validate", padding: "x".repeat(300_000) }, { "content-length": "5" });
    expect(response.status).toBe(413);
    expect(f.rpcCalls).toEqual([]);
    expect(f.reads).toEqual([]);
  });

  it("times out and cancels an unfinished request body before database work", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"action":"validate"')); },
      cancel() { canceled = true; },
    });
    const f = fixture();
    const response = await f.handler(new Request("https://fixture.invalid/onboarding-wizard", {
      method: "POST", body, duplex: "half",
    } as RequestInit));
    expect(response.status).toBe(408);
    expect(canceled).toBe(true);
    expect(f.rpcCalls).toEqual([]);
    expect(f.reads).toEqual([]);
  }, 5_000);

  it("rejects an excessive tour batch before any row is written", async () => {
    const f = fixture();
    const response = await f.post({ action: "save-step", step: "tours", data: {
      tours: Array.from({ length: 51 }, (_, index) => tour("Tour " + index)),
    } });
    expect(response.status).toBe(413);
    expect(f.writes).toEqual([]);
  });

  it("rejects aggregate slot work before a tour or slot is written", async () => {
    const f = fixture({ slotRows: () => Array(3000).fill({}) });
    const range = { start_date: "2026-08-15", end_date: "2027-08-15", times: ["09:00"], days_of_week: [0, 1, 2, 3, 4, 5, 6] };
    const response = await f.post({ action: "save-step", step: "tours", data: {
      tours: [tour("Kayak", [range]), tour("Canoe", [range])],
    } });
    expect(response.status).toBe(413);
    expect(f.writes).toEqual([]);
    expect(f.generated).not.toHaveBeenCalled();
  });

  it("accepts an ordinary tour save under tenant admission and the batch slot budget", async () => {
    const f = fixture({ slotRows: () => Array(250).fill({}) });
    const range = { start_date: "2026-08-15", end_date: "2026-09-15", times: ["09:00"], days_of_week: [0, 1, 2, 3, 4, 5, 6] };
    const response = await f.post({ action: "save-step", step: "tours", data: { tours: [tour("Kayak", [range])] } });
    expect(response.status).toBe(200);
    expect(f.generated).toHaveBeenCalledTimes(1);
    expect(f.rpcCalls.map((call) => call.key)).toEqual(["public", "tenant-a"]);
  });

  it("denies a validated tenant independently of the public bucket", async () => {
    const f = fixture({ rate: (endpoint) => !endpoint.endsWith(":tenant") });
    const response = await f.post({ action: "save-step", step: "tours", data: { tours: [tour("Kayak")] } });
    expect(response.status).toBe(429);
    expect(f.writes).toEqual([]);
    expect(f.rpcCalls.map((call) => call.key)).toEqual(["public", "tenant-a"]);
  });

  it("accepts a normal five-candidate Places response without any other network call", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://places.googleapis.com/v1/places:searchText");
      return Response.json({ places: Array.from({ length: 5 }, (_, index) => ({ id: "place-" + index, displayName: { text: "Place " + index } })) });
    }) as typeof fetch;
    const f = fixture({ fetch: fetchImpl });
    const response = await f.post({ action: "prefill-places", query: "kayak fixture" });
    expect(response.status).toBe(200);
    expect((await response.json()).candidates).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized Places body before parsing candidates", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ places: [], padding: "x".repeat(100_000) })) as typeof fetch;
    const f = fixture({ fetch: fetchImpl });
    const response = await f.post({ action: "prefill-places", query: "kayak fixture" });
    expect(response.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled Places fetch even when its synthetic transport ignores abort", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;
    const f = fixture({ fetch: fetchImpl });
    const response = await f.post({ action: "prefill-places", query: "kayak fixture" });
    expect(response.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  }, 7_000);

  it("does not parse metadata beyond the website scraper's 200 KB read cap", async () => {
    const html = "<html><head>" + "x".repeat(200_000) + "<title>Beyond cap</title></head></html>";
    const scrape = sourceFunction("supabase/functions/onboarding-wizard/index.ts", "scrapeSite", {
      assertPublicUrl: async (raw: string) => new URL(raw),
      fetch: async () => new Response(html),
      AbortSignal, TextDecoder,
    });
    const result = await scrape("https://fixture.invalid");
    expect(result.title).toBeNull();
  });

  it("rejects a website hostname with any private DNS answer", async () => {
    const validate = sourceFunction("supabase/functions/onboarding-wizard/index.ts", "assertPublicUrl", {
      parsePublicUrl: (raw: string) => new URL(raw),
      isPrivateAddress: (address: string) => address === "127.0.0.1",
      Deno: { resolveDns: async (_host: string, family: string) => family === "A" ? ["198.51.100.10", "127.0.0.1"] : [] },
    });
    await expect(validate("https://mixed.fixture.invalid")).rejects.toThrow("not reachable");
  });
});
