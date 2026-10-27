import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

// Section 5: an anonymous checkout reserves seats, so one visitor (IP) may start
// at most 10 a minute. Operators and the chat bots authenticate and are not counted.
function database() {
  const buckets = new Map<string, number>();
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === "check_rate_limit") {
      const key = args.p_ip + " " + args.p_endpoint;
      buckets.set(key, (buckets.get(key) || 0) + 1);
      return { data: buckets.get(key)! <= args.p_max, error: null };
    }
    // Stop at pricing: reaching it means the request would have held seats.
    return { data: { ok: false, error: "fixture stop" }, error: null };
  });
  const booking = { id: "booking-a", business_id: "tenant-a", tour_id: "tour-a", qty: 2, status: "PENDING", waiver_token: "booking-proof", custom_fields: {} };
  const from = (table: string) => {
    const result = { data: table === "businesses" ? { booking_custom_fields: [] } : table === "bookings" ? booking : null, error: null };
    const chain: any = {};
    for (const name of ["select", "update", "eq", "in"]) chain[name] = () => chain;
    chain.maybeSingle = chain.single = async () => result;
    return chain;
  };
  const priced = () => rpc.mock.calls.filter(([name]) => name !== "check_rate_limit").length;
  return { db: { from, rpc }, rpc, priced };
}

function singleCheckout() {
  const d = database();
  const handler = sourceHandler("supabase/functions/create-checkout/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => d.db, getTenantByBusinessId: async () => ({ business: { id: "tenant-a" }, credentials: {} }),
      getBusinessAllowedOrigins: () => [], isAllowedOrigin: () => true, resolveBusinessSiteUrls: () => ({}),
    },
    "../_shared/subscription.ts": { blockIfNotTrading: async () => null },
    "../_shared/auth.ts": {
      requireAuth: async (req: Request) => { if (!req.headers.get("authorization")) throw new Error("anonymous"); return { role: "MAIN_ADMIN", businessId: "tenant-a" }; },
      canAccessBusiness: () => true,
    },
    "../_shared/booking-success.ts": { bookingSuccessUrl: async (url: string) => url },
    "../_shared/booking-custom-fields.ts": {
      applicableBookingQuestions: () => [], questionConfigurationChanged: () => false,
      validateQuestionAnswers: () => ({ errors: [], answers: {} }), captureQuestionFields: () => ({}),
    },
  });
  const post = (ip: string, operator = false) => handler(new Request("https://synthetic.invalid/create-checkout", {
    method: "POST", headers: { "x-forwarded-for": ip + ", 10.0.0.1", ...(operator ? { authorization: "Bearer operator" } : {}) },
    body: JSON.stringify({ booking_id: "booking-a", amount: 600, type: "BOOKING", ...(operator ? {} : { booking_token: "booking-proof" }) }),
  }));
  return { ...d, post };
}

function comboCheckout() {
  const d = database();
  const handler = sourceHandler("supabase/functions/create-paysafe-checkout/index.ts", {
    "../_shared/tenant.ts": { createServiceClient: () => d.db }, "../_shared/combo.ts": {}, "../_shared/subscription.ts": {},
  });
  // Without a combo offer the create step answers 400 at its first check.
  const post = (ip: string, action = "create") => handler(new Request("https://synthetic.invalid/create-paysafe-checkout", {
    method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ action }),
  }));
  return { ...d, post };
}

describe("public checkout rate limit", () => {
  it("refuses an 11th booking checkout from one visitor in a minute, before any seats are held", async () => {
    const f = singleCheckout();
    for (let i = 0; i < 10; i++) expect((await f.post("198.51.100.7")).status).toBe(409);
    const refused = await f.post("198.51.100.7");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ reason: "Too many checkout attempts. Wait a minute, then try again." });
    expect(f.priced()).toBe(10);
    expect((await f.post("203.0.113.9")).status).toBe(409);
    expect(f.priced()).toBe(11);
  });

  it("does not count operator or bot checkouts", async () => {
    const f = singleCheckout();
    for (let i = 0; i < 12; i++) expect((await f.post("198.51.100.7", true)).status).toBe(409);
    expect(f.rpc).not.toHaveBeenCalledWith("check_rate_limit", expect.anything());
  });

  it("refuses an 11th combo checkout from one visitor, but not the payment step", async () => {
    const f = comboCheckout();
    for (let i = 0; i < 10; i++) expect((await f.post("198.51.100.7")).status).toBe(400);
    const refused = await f.post("198.51.100.7");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "Too many checkout attempts. Wait a minute, then try again." });
    expect((await f.post("203.0.113.9")).status).toBe(400);
    expect((await f.post("198.51.100.7", "process")).status).toBe(400);
  });
});
