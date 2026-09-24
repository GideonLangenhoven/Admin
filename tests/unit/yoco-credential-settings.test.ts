import { expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

it.each([
  ["yoco", "sk_test_fixture", 400],
  ["yoco_test", "sk_live_fixture", 400],
  ["yoco", "sk_live_fixture", 200],
  ["yoco_test", "sk_test_fixture", 200],
])("saves %s credentials only in the matching environment (%s)", async (section, key, status) => {
  const rpc = vi.fn(async () => ({ error: null }));
  const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: "a", subscription_status: "ACTIVE" }, error: null }) };
  const handler = sourceHandler("app/api/credentials/route.ts", {
    "@supabase/supabase-js": { createClient: () => ({ rpc, from: () => query }) },
    "../../lib/api-auth": { getCallerAdmin: async () => ({ id: "actor", role: "MAIN_ADMIN", business_id: "a" }), isPrivilegedRole: () => true },
    "../../lib/mfa-sensitive": { requireSensitiveMfa: async () => ({ ok: true, actor: { id: "actor", role: "MAIN_ADMIN" } }) },
  }, { SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-".repeat(2) });
  const body = { business_id: "a", section, [`${section}_secret_key`]: key, [`${section}_webhook_secret`]: "whsec_fixture" };
  const response = await handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify(body) }));
  expect(response.status).toBe(status);
  expect(rpc).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
});

it("blocks anonymous onboarding credential linking before provider or credential effects", async () => {
  const rpc = vi.fn(() => ({ abortSignal: async () => ({ data: true, error: null }) }));
  const gateway = { validateYocoKey: vi.fn(), registerYocoWebhook: vi.fn() };
  const query: any = { select: () => query, eq: () => query, is: () => query, gt: () => query, maybeSingle: async () => ({ data: { id: "invite", business_id: "a" }, error: null }) };
  const handler = sourceHandler("supabase/functions/onboarding-wizard/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({ rpc, from: () => query }) },
    "../_shared/otp-attempts.ts": { getClientIp: () => "" },
    "../_shared/slot-generation.ts": {}, "../_shared/yoco.ts": gateway,
    "../_shared/onboarding-guards.ts": {},
  }, { SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-".repeat(2) });
  const response = await handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ action: "save-credentials", token: "11111111-1111-4111-8111-111111111111", yoco_secret_key: "sk_test_fixture" }) }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ success: false, code: "MFA_REQUIRED" });
  expect(gateway.validateYocoKey).not.toHaveBeenCalled();
  expect(gateway.registerYocoWebhook).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenCalledWith("check_rate_limit", expect.any(Object));
});
