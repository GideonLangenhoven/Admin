import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";
import { isMarketingSetup, marketingSetupEmail, marketingSetupSteps, type MarketingSetup } from "../../app/lib/marketing-setup";

const businessId = "10000000-0000-4000-8000-000000000001";
const setup: MarketingSetup = { email_service_configured: true, email_feedback_configured: false, operator_status: "policy_approval_pending", welcome_back_available: false };

function edgeFixture({ service = true, authorized = true, reason = "policy_approval_pending", error = false, env = {} } = {}) {
  const rpc = vi.fn(async () => ({ data: reason, error: error ? { message: "Private database error" } : null }));
  const db = vi.fn(() => ({ rpc }));
  const provider = vi.fn(() => { throw new Error("Setup checks must never send mail"); });
  const handler = sourceHandler("supabase/functions/marketing-setup-status/index.ts", {
    "../_shared/auth.ts": { requireAuth: async () => { if (!authorized) throw new Error("Unauthorized"); return { isServiceRole: service }; } },
    "../_shared/tenant.ts": { createServiceClient: db },
  }, env, provider);
  const request = (body: unknown = { business_id: businessId }) => handler(new Request("https://fixture.invalid/status", { method: "POST", body: JSON.stringify(body) }));
  return { rpc, db, provider, request, handler };
}

describe("read-only marketing setup diagnostics", () => {
  it("reports the exact configured flags without credentials or sending", async () => {
    const f = edgeFixture({ env: { RESEND_API_KEY: "private-key" } });
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ...setup, welcome_back_available: true });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("marketing_policy_reason", { p_business_id: businessId });
    expect(f.provider).not.toHaveBeenCalled();
  });
  it.each([{ authorized: false, status: 401 }, { service: false, status: 403 }])("denies unauthorized and browser callers before reading data", async ({ status, ...options }) => {
    const f = edgeFixture(options);
    expect((await f.request()).status).toBe(status);
    expect(f.db).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  });
  it.each([null, {}, { business_id: "invalid" }])("rejects malformed operator input before reading data", async body => {
    const f = edgeFixture(); expect((await f.request(body)).status).toBe(400); expect(f.db).not.toHaveBeenCalled();
  });
  it.each([{ error: true }, { reason: "unknown_new_state" }])("does not invent a setup state on a failed lookup", async options => {
    const f = edgeFixture(options); const response = await f.request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Email setup could not be checked" });
    expect(f.provider).not.toHaveBeenCalled();
  });
  it("refuses GET and invalid JSON without a database lookup", async () => {
    const f = edgeFixture();
    expect((await f.handler(new Request("https://fixture.invalid"))).status).toBe(405);
    expect((await f.handler(new Request("https://fixture.invalid", { method: "POST", body: "{" }))).status).toBe(400);
    expect(f.db).not.toHaveBeenCalled();
  });
});

describe("operator setup API", () => {
  function fixture(caller: { business_id: string } | null = { business_id: businessId }, body: unknown = setup, status = 200) {
    const edge = vi.fn(async () => Response.json(body, { status }));
    const exports = sourceExports("app/api/marketing/setup/route.ts", {
      "@/app/lib/api-auth": { getCallerAdmin: async () => caller },
      "@/app/lib/marketing-setup": { isMarketingSetup },
    }, {}, edge);
    const get = exports.GET as (request: Request) => Promise<Response>;
    return { edge, get: () => get(new Request("https://fixture.invalid/api/marketing/setup?business_id=forged", { headers: { "x-admin-business-id": "forged" } })) };
  }
  it("takes the tenant from verified authorization and strips unexpected provider fields", async () => {
    const f = fixture(undefined, { ...setup, private: "must not escape" }); const response = await f.get();
    expect(response.status).toBe(200); expect(await response.json()).toEqual(setup);
    expect(JSON.parse(f.edge.mock.calls[0][1].body)).toEqual({ business_id: businessId });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects missing authorization without invoking Edge", async () => {
    const f = fixture(null); expect((await f.get()).status).toBe(401); expect(f.edge).not.toHaveBeenCalled();
  });
  it.each([[{}, 200], [{ ...setup, operator_status: "unknown" }, 200], [setup, 503]])("fails closed for unavailable or invalid Edge responses", async (body, status) => {
    const f = fixture(undefined, body, status as number); const response = await f.get();
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Email setup could not be checked" });
  });
});

describe("plain-language setup steps", () => {
  it("names the specific work and keeps unfinished automations visible even with configured email", () => {
    expect(marketingSetupSteps(setup)).toEqual([
      "BookingTours: connect bounced-email and spam reports.",
      "BookingTours: enable marketing emails for this operator.",
      "BookingTours: finish automatic welcome-back emails.",
    ]);
    expect(marketingSetupSteps({ ...setup, email_feedback_configured: true, operator_status: "quiet_hours" })).toEqual(["BookingTours: finish automatic welcome-back emails."]);
    expect(marketingSetupSteps({ ...setup, email_feedback_configured: true, operator_status: "eligible", welcome_back_available: true })).toEqual([]);
    expect(marketingSetupSteps({ ...setup, operator_status: "timezone_unavailable" })).toContain("BookingTours: set this operator’s local time zone.");
  });
  it("includes the selected operator and real blockers in a safely encoded support draft", () => {
    const url = new URL(marketingSetupEmail("Tours & Trails\nExample", businessId, marketingSetupSteps(setup)));
    expect(url.protocol).toBe("mailto:"); expect(url.pathname).toBe("support@bookingtours.co.za");
    expect(url.searchParams.get("body")).toContain("Operator ID: " + businessId);
    expect(url.searchParams.get("body")).toContain("connect bounced-email and spam reports");
  });
});
