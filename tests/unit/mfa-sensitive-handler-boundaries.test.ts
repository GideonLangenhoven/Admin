import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ACTOR_USER = "22222222-2222-4222-8222-222222222222";
const BUSINESS = "33333333-3333-4333-8333-333333333333";
const OTHER_BUSINESS = "44444444-4444-4444-8444-444444444444";
const TARGET = "55555555-5555-4555-8555-555555555555";
const TARGET_USER = "66666666-6666-4666-8666-666666666666";
const OPERATION = "77777777-7777-4777-8777-777777777777";

describe("retired MFA recovery", () => {
  it("rejects obsolete recovery requests without touching authentication or customer data", async () => {
    const route = sourceHandler("app/api/mfa/recovery/route.ts", {});
    const response = await route(new Request("https://fixture.invalid/api/mfa/recovery", { method: "POST" }));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "MFA has been removed. Use your normal sign-in." });
  });
});

function bankHandler(options: {
  role?: string; businessId?: string; suspended?: boolean; readOnly?: boolean;
  currentLevel?: "aal1" | "aal2"; factors?: any[]; userError?: any;
  subscriptionStatus?: string; recoveryStatus?: string;
} = {}) {
  const factors = options.factors ?? [{ id: "factor", status: "verified", factor_type: "totp", created_at: "2030-01-01T00:00:00Z" }];
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const db = {
    auth: {
      getUser: vi.fn(async () => options.userError ? { data: { user: null }, error: options.userError } : { data: { user: { id: ACTOR_USER, factors } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: options.currentLevel ?? "aal2", currentAuthenticationMethods: [{ method: "mfa/totp", timestamp: 2_000_000_000 }] }, error: null })) },
    },
    from(table: string) {
      const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({
        data: table === "admin_users" ? {
          id: ACTOR, user_id: ACTOR_USER, role: options.role ?? "MAIN_ADMIN", business_id: options.businessId ?? BUSINESS,
          suspended: options.suspended ?? false, read_only: options.readOnly ?? false,
        } : table === "businesses" ? { id: BUSINESS, subscription_status: options.subscriptionStatus ?? "ACTIVE" }
          : options.recoveryStatus ? { status: options.recoveryStatus, completed_at: "2030-01-01T00:00:00Z" } : null,
        error: null,
      }), insert: vi.fn(async () => ({ error: null })) };
      return chain;
    },
    rpc,
  };
  const route = sourceHandler("supabase/functions/bank-details/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
  }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-fixture", SETTINGS_ENCRYPTION_KEY: "encryption-fixture-key-123456789012" });
  const request = (headers: Record<string, string> = {}) => new Request("https://fixture.invalid", {
    method: "POST", headers: { authorization: "Bearer signed-fixture", ...headers },
    body: JSON.stringify({ action: "set", business_id: BUSINESS, account_owner: "Fixture", account_number: "123" }),
  });
  return { route, request, rpc, db };
}

describe("tenant bank Edge boundary", () => {
  it.each([
    [{ role: "OPERATOR" }, 403],
    [{ role: "ADMIN" }, 403],
    [{ suspended: true }, 403],
    [{ readOnly: true }, 403],
    [{ businessId: OTHER_BUSINESS }, 403],
    [{ subscriptionStatus: "SUSPENDED" }, 403],
    [{ userError: { message: "expired" } }, 401],
  ] as const)("denies before the bank setter for %j", async (options, status) => {
    const { route, request, rpc } = bankHandler(options as any);
    const response = await route(request());
    expect(response.status).toBe(status);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([undefined, "PENDING", "PARTIAL", "COMPLETED"])("lets an operator owner save without MFA despite recovery status %s", async (recoveryStatus) => {
    const { route, request, rpc, db } = bankHandler({ currentLevel: "aal1", factors: [], recoveryStatus });
    const response = await route(request());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_business_bank_details_audited", expect.objectContaining({ p_actor_id: ACTOR, p_business_id: BUSINESS }));
    expect(db.auth.getUser).toHaveBeenCalledOnce();
    expect(db.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it.each([{ currentLevel: "aal1" as const }, { factors: [] }])("allows Super Admin normal sign-in for %j without MFA", async (options) => {
    const { route, request, rpc, db } = bankHandler({ role: "SUPER_ADMIN", ...options });
    expect((await route(request({ "x-admin-business-id": BUSINESS }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    expect(db.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it("requires a Super Admin to name the target in the header", async () => {
    const { route, request, rpc } = bankHandler({ role: "SUPER_ADMIN", businessId: OTHER_BUSINESS });
    expect((await route(request())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets a verified Super Admin save for the explicit active target", async () => {
    const { route, request, rpc } = bankHandler({ role: "SUPER_ADMIN", businessId: OTHER_BUSINESS });
    const response = await route(request({ "x-admin-business-id": BUSINESS }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_business_bank_details_audited", expect.objectContaining({ p_actor_id: ACTOR, p_business_id: BUSINESS }));
  });
});

describe("platform bank Next boundary", () => {
  function platformHandler(mfa: any) {
    const invoke = vi.fn(async () => ({ data: { success: true }, error: null }));
    const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    const route = sourceHandler("app/api/platform-settings/route.ts", {
      "@/app/lib/api-auth": { getCallerAdmin: async () => ({ id: ACTOR, role: "SUPER_ADMIN", business_id: BUSINESS }) },
      "@/app/lib/mfa-sensitive": { requireSensitiveMfa: async () => mfa },
      "@supabase/supabase-js": { createClient: () => ({ from: () => ({ update }), functions: { invoke } }) },
    });
    return { route, invoke, update };
  }

  it("denies an invalid session before platform bank or logo effects", async () => {
    const { route, invoke, update } = platformHandler({ ok: false, status: 401, code: "INVALID_SESSION", message: "Sign in again" });
    const response = await route(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ logo_url: "fixture", bank: { account_number: "123" } }) }));
    expect(response.status).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps an ordinary logo-only save available at AAL1", async () => {
    const { route, invoke, update } = platformHandler({ ok: false, status: 401, code: "INVALID_SESSION", message: "Sign in again" });
    const response = await route(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify({ logo_url: "fixture" }) }));
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("credential-bearing Super Admin onboarding", () => {
  function onboardingHandler(level: "aal1" | "aal2") {
    const rpc = vi.fn(async () => ({ data: { success: true, business: { id: BUSINESS }, admin: { id: TARGET } }, error: null }));
    const db = {
      from(table: string) {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({
          data: table === "admin_users" ? { id: ACTOR, role: "SUPER_ADMIN", suspended: false } : null,
          error: null,
        }) };
        return chain;
      },
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: ACTOR_USER, factors: [{ id: "factor", status: "verified", factor_type: "totp" }] } }, error: null })),
        mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: level, currentAuthenticationMethods: [] }, error: null })) },
      },
      rpc,
    };
    const route = sourceHandler("supabase/functions/super-admin-onboard/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
      "../_shared/auth.ts": { requireAuth: async () => ({ userId: ACTOR_USER, role: "SUPER_ADMIN", isServiceRole: false, readOnly: false }) },
    }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-fixture", SETTINGS_ENCRYPTION_KEY: "encryption-fixture-key-123456789012" });
    const request = (credentials = false) => new Request("https://fixture.invalid", {
      method: "POST", headers: { authorization: "Bearer signed-fixture" },
      body: JSON.stringify({
        idempotency_key: OPERATION,
        business_name: "Fixture Tours", subdomain: "fixture-tours", admin_name: "Owner", admin_email: "owner@example.test",
        timezone: "Africa/Johannesburg", currency: "ZAR",
        ...(credentials ? { yoco_secret_key: "sk_live_fixture", yoco_webhook_secret: "whsec_fixture" } : {}),
      }),
    });
    return { route, request, rpc };
  }

  it("keeps basic onboarding available without MFA", async () => {
    const { route, request, rpc } = onboardingHandler("aal1");
    expect((await route(request(false))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("platform_onboard_business_audited", expect.anything());
  });

  it("allows first credential linking with normal Super Admin sign-in", async () => {
    const { route, request, rpc } = onboardingHandler("aal1");
    expect((await route(request(true))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("platform_onboard_business_audited", expect.objectContaining({ p_actor_id: ACTOR }));
  });

  it("uses the audited onboarding wrapper after verified AAL2", async () => {
    const { route, request, rpc } = onboardingHandler("aal2");
    expect((await route(request(true))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("platform_onboard_business_audited", expect.objectContaining({ p_actor_id: ACTOR }));
  });
});
