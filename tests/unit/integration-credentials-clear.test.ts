import { expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

function fixture(options: { role?: string; business?: string; active?: boolean; verified?: boolean; rpcError?: boolean } = {}) {
  const role = options.role ?? "MAIN_ADMIN";
  const rpc = vi.fn(async () => ({ error: options.rpcError ? { message: "database detail" } : null }));
  const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: "business", subscription_status: options.active === false ? "SUSPENDED" : "ACTIVE" }, error: null }) };
  const route = sourceHandler("app/api/credentials/route.ts", {
    "@supabase/supabase-js": { createClient: () => ({ rpc, from: () => query }) },
    "../../lib/api-auth": { getCallerAdmin: async () => role === "anonymous" ? null : ({ id: "actor", role, business_id: options.business ?? "business" }), isPrivilegedRole: (role: string) => ["MAIN_ADMIN", "SUPER_ADMIN"].includes(role) },
    "../../lib/mfa-sensitive": { requireSensitiveMfa: async () => options.verified === false ? { ok: false, status: 403, message: "Account cannot change settings" } : { ok: true } },
  });
  const request = (section = "wa", action: unknown = "clear", headers: Record<string, string> = {}) => new Request("https://fixture.invalid", {
    method: "POST", headers, body: JSON.stringify({ business_id: "business", section, action }),
  });
  return { route, rpc, request };
}

it.each(["MAIN_ADMIN", "SUPER_ADMIN"])("lets %s remove each integration through the audited RPC without reading or sending secrets", async role => {
  for (const section of ["wa", "yoco", "yoco_test"]) {
    const { route, rpc, request } = fixture({ role });
    const response = await route(request(section, "clear", { "x-admin-business-id": "business" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("clear_sensitive_credentials_audited", {
      p_actor_id: "actor", p_business_id: "business", p_section: section,
    });
  }
});

it.each([
  { role: "anonymous" }, { role: "ADMIN" }, { role: "GUIDE" },
  { business: "other-business" }, { active: false }, { verified: false },
  { role: "SUPER_ADMIN" },
])("denies removal before mutation for %j", async options => {
  const { route, rpc, request } = fixture(options);
  expect((await route(request())).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it("rejects a Super Admin target mismatch", async () => {
  const { route, rpc, request } = fixture({ role: "SUPER_ADMIN" });
  expect((await route(request("wa", "clear", { "x-admin-business-id": "other" }))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it.each([["all", "clear"], ["yoco_test_mode", "clear"], ["wa", "typo"]])("rejects unsupported section/action %s/%s", async (section, action) => {
  const { route, rpc, request } = fixture();
  expect((await route(request(section, action))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it("reports a failed removal without claiming success or exposing database details", async () => {
  const { route, request } = fixture({ rpcError: true });
  const response = await route(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Failed to remove configuration. Try again." });
});

it.each(["null", "[]", "{broken"])("rejects a malformed request body %s before mutation", async body => {
  const { route, rpc } = fixture();
  expect((await route(new Request("https://fixture.invalid", { method: "POST", body }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
