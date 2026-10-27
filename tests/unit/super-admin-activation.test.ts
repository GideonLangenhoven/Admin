import { describe, expect, it, vi } from "vitest";
import { sourceFunction, sourceHandler } from "../helpers/source-handler";

const BUSINESS = "11111111-1111-1111-1111-111111111111";

function statusFixture(current = "ONBOARDING", confirmed = true, error = "") {
  const confirmAction = vi.fn(async () => confirmed);
  const fetch = vi.fn(async () => Response.json(error ? { error } : { ok: true, status: "ACTIVE" }, { status: error ? 409 : 200 }));
  const setBusinesses = vi.fn();
  const notify = vi.fn();
  const prompt = vi.fn(() => "Ready for launch");
  const refreshBusiness = vi.fn();
  const getAuthHeaders = vi.fn(async () => ({ "x-admin-business-id": BUSINESS }));
  const toggle = sourceFunction("app/super-admin/page.tsx", "toggleSubscriptionStatus", {
    businesses: [{ id: BUSINESS, business_name: "Aonyx", subscription_status: current }],
    confirmAction, fetch, setBusinesses, notify, refreshBusiness, getAuthHeaders,
    window: { prompt }, setTogglingStatusId: vi.fn(),
  });
  return { toggle: () => toggle(BUSINESS, current), confirmAction, fetch, setBusinesses, notify, prompt, refreshBusiness, getAuthHeaders };
}

describe("super-admin operator activation", () => {
  it.each([
    ["ONBOARDING", "ACTIVE", "Activate operator", "Activated"],
    ["SUSPENDED", "ACTIVE", "Reactivate operator", "Reactivated"],
    ["ACTIVE", "SUSPENDED", "Suspend operator", "Suspended"],
  ])("moves %s to %s with an audited request", async (current, next, label, title) => {
    const f = statusFixture(current);
    await f.toggle();
    expect(f.confirmAction).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: label }));
    expect(f.getAuthHeaders).toHaveBeenCalledWith(BUSINESS);
    const [url, init] = f.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/super-admin/business");
    expect(JSON.parse(init.body as string)).toEqual({ action: "status", business_id: BUSINESS, status: next, expected_status: current, reason: "Ready for launch" });
    expect(f.setBusinesses.mock.calls[0][0]([{ id: BUSINESS, subscription_status: current }])).toEqual([{ id: BUSINESS, subscription_status: next }]);
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ title, tone: "success" }));
  });
  it("does not activate after cancelling confirmation", async () => {
    const f = statusFixture("ONBOARDING", false);
    await f.toggle();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.prompt).not.toHaveBeenCalled();
  });
  it("does not activate without an audit reason", async () => {
    const f = statusFixture();
    f.prompt.mockReturnValue("");
    await f.toggle();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("keeps onboarding status when billing setup is missing or the status changed", async () => {
    const f = statusFixture("ONBOARDING", true, "Complete billing setup first");
    await f.toggle();
    expect(f.setBusinesses).not.toHaveBeenCalled();
    expect(f.refreshBusiness).not.toHaveBeenCalled();
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Status unchanged", tone: "error" }));
  });
});

describe("operator activation API boundary", () => {
  function fixture(role: string | null, rpcError: string | null = null) {
    const rpc = vi.fn(async () => ({ data: { ok: true, status: "ACTIVE" }, error: rpcError ? { message: rpcError } : null }));
    const handler = sourceHandler("app/api/super-admin/business/route.ts", {
      "@/app/lib/api-auth": { getCallerAdmin: async () => role ? { id: "actor", role, business_id: BUSINESS } : null },
      "@supabase/supabase-js": { createClient: () => ({ rpc }) },
    });
    const request = (overrides = {}) => handler(new Request("https://test.invalid/api/super-admin/business", {
      method: "POST", body: JSON.stringify({ action: "status", business_id: BUSINESS, status: "ACTIVE", expected_status: "ONBOARDING", reason: "Ready for launch", ...overrides }),
    }));
    return { rpc, request };
  }
  it("accepts a super-admin activation using the existing guarded transaction", async () => {
    const f = fixture("SUPER_ADMIN");
    expect((await f.request()).status).toBe(200);
    expect(f.rpc).toHaveBeenCalledWith("platform_change_business_status", {
      p_business_id: BUSINESS, p_actor_id: "actor", p_status: "ACTIVE", p_expected_status: "ONBOARDING", p_reason: "Ready for launch",
    });
  });
  it.each([null, "ADMIN", "MAIN_ADMIN"])("rejects activation by %s", async role => {
    const f = fixture(role);
    expect((await f.request()).status).toBe(403);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("rejects activation targeting a different operator", async () => {
    const f = fixture("SUPER_ADMIN");
    expect((await f.request({ business_id: "22222222-2222-2222-2222-222222222222" })).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("rejects activation without a valid reason", async () => {
    const f = fixture("SUPER_ADMIN");
    expect((await f.request({ reason: "" })).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("reports a rejected status transaction", async () => {
    const f = fixture("SUPER_ADMIN", "Status changed. Refresh before trying again.");
    const response = await f.request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Status changed. Refresh before trying again." });
  });
});
