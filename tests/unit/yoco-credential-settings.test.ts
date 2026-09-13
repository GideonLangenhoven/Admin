import { expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

it.each([
  ["yoco", "sk_test_fixture", 400],
  ["yoco_test", "sk_live_fixture", 400],
  ["yoco", "sk_live_fixture", 200],
  ["yoco_test", "sk_test_fixture", 200],
])("saves %s credentials only in the matching environment (%s)", async (section, key, status) => {
  const rpc = vi.fn(async () => ({ error: null }));
  const handler = sourceHandler("app/api/credentials/route.ts", {
    "@supabase/supabase-js": { createClient: () => ({ rpc }) },
    "../../lib/api-auth": { getCallerAdmin: async () => ({ role: "MAIN_ADMIN", business_id: "a" }), isPrivilegedRole: () => true },
  }, { SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-".repeat(2) });
  const body = { business_id: "a", section, [`${section}_secret_key`]: key, [`${section}_webhook_secret`]: "whsec_fixture" };
  const response = await handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify(body) }));
  expect(response.status).toBe(status);
  expect(rpc).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
});

it("rejects test keys during live onboarding before registering a webhook or saving credentials", async () => {
  const rpc = vi.fn();
  const gateway = { validateYocoKey: vi.fn(), registerYocoWebhook: vi.fn() };
  const query: any = { select: () => query, eq: () => query, is: () => query, gt: () => query, maybeSingle: async () => ({ data: { id: "invite", business_id: "a" }, error: null }) };
  const handler = sourceHandler("supabase/functions/onboarding-wizard/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({ rpc, from: () => query }) },
    "../_shared/otp-attempts.ts": { getClientIp: () => "" },
    "../_shared/slot-generation.ts": {}, "../_shared/yoco.ts": gateway,
    "../_shared/onboarding-guards.ts": {},
  }, { SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-".repeat(2) });
  const response = await handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ action: "save-credentials", token: "11111111-1111-4111-8111-111111111111", yoco_secret_key: "sk_test_fixture" }) }));
  expect(response.status).toBe(400);
  expect(gateway.validateYocoKey).not.toHaveBeenCalled();
  expect(gateway.registerYocoWebhook).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
