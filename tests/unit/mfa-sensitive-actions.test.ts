import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const BUSINESS = "33333333-3333-4333-8333-333333333333";
const OTHER_BUSINESS = "44444444-4444-4444-8444-444444444444";
const FACTOR = "55555555-5555-4555-8555-555555555555";

function jwt(payload: Record<string, unknown> = { sub: USER, aal: "aal2", iat: 2_000_000_000 }) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.fixture`;
}

function mfaClient(options: {
  role?: string;
  suspended?: boolean;
  readOnly?: boolean;
  currentLevel?: "aal1" | "aal2";
  factors?: Array<Record<string, unknown>>;
  methods?: Array<Record<string, unknown>>;
  userError?: Error | null;
  recovery?: { status: string; completed_at: string | null } | null;
} = {}) {
  const factors = options.factors ?? [{ id: FACTOR, factor_type: "totp", status: "verified", created_at: "2026-09-21T07:00:00.000Z", updated_at: "2026-09-21T07:01:00.000Z" }];
  const admin = {
    id: ACTOR, user_id: USER, role: options.role ?? "SUPER_ADMIN", business_id: BUSINESS,
    suspended: options.suspended ?? false, read_only: options.readOnly ?? false,
  };
  const query = (table: string) => {
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: table === "admin_users" ? admin : options.recovery ?? null, error: null }),
    };
    return chain;
  };
  return {
    auth: {
      getUser: vi.fn(async () => options.userError
        ? { data: { user: null }, error: options.userError }
        : { data: { user: { id: USER, factors } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({
        data: {
          currentLevel: options.currentLevel ?? "aal2",
          nextLevel: factors.some((factor) => factor.status === "verified") ? "aal2" : "aal1",
          currentAuthenticationMethods: options.methods ?? [{ method: "mfa/totp", timestamp: 2_000_000_000 }],
        },
        error: null,
      })) },
    },
    from: vi.fn(query),
  };
}

async function inspect(options: Parameters<typeof mfaClient>[0], token = jwt(), allowedRoles = ["MAIN_ADMIN", "SUPER_ADMIN"]) {
  const client = mfaClient(options);
  const exports = sourceExports("app/lib/mfa-sensitive.ts", {
    "@supabase/supabase-js": { createClient: () => client },
  });
  const result = await (exports.requireSensitiveMfa as any)(new Request("https://test.invalid", {
    headers: { authorization: `Bearer ${token}` },
  }), { allowedRoles, expectedActorId: ACTOR });
  return { result, client };
}

describe("sensitive-action MFA authority", () => {
  it.each(["OPERATOR", "ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"])("does not require MFA for operator role %s", async (role) => {
    const { result, client } = await inspect({ role, currentLevel: "aal1", factors: [] }, jwt({ sub: USER, aal: "aal1" }), [role]);
    expect(result).toMatchObject({ ok: true, actor: { id: ACTOR, role }, ready: true, reEnrollRequired: false });
    expect(client.auth.getUser).toHaveBeenCalledOnce();
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalledWith("mfa_recovery_state");
  });

  it.each(["PENDING", "PARTIAL", "COMPLETED"])("does not block an operator with a legacy %s recovery record", async (status) => {
    const { result, client } = await inspect({ role: "MAIN_ADMIN", currentLevel: "aal1", factors: [], recovery: { status, completed_at: "2030-01-01T00:00:00Z" } });
    expect(result).toMatchObject({ ok: true, ready: true, recoveryState: "none", reEnrollRequired: false });
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalledWith("mfa_recovery_state");
  });

  it.each([
    ["ADMIN", false, false, "ROLE_FORBIDDEN"],
    ["UNKNOWN", false, false, "ROLE_FORBIDDEN"],
    ["MAIN_ADMIN", true, false, "ACCOUNT_INACTIVE"],
    ["MAIN_ADMIN", false, true, "DEMO_READ_ONLY"],
  ])("rejects role=%s suspended=%s demo=%s", async (role, suspended, readOnly, code) => {
    const { result } = await inspect({ role, suspended, readOnly });
    expect(result).toMatchObject({ ok: false, code });
  });

  it("rejects malformed, forged, or expired JWTs when Auth validation fails", async () => {
    const { result } = await inspect({ role: "MAIN_ADMIN", userError: new Error("invalid token") }, "not-a-jwt");
    expect(result).toMatchObject({ ok: false, status: 401, code: "INVALID_SESSION" });
  });

  it.each(["PENDING", "PARTIAL", "COMPLETED"])("does not block Super Admin sign-in for legacy %s recovery", async (status) => {
    const { result, client } = await inspect({ role: "SUPER_ADMIN", currentLevel: "aal1", factors: [], recovery: { status, completed_at: "2030-01-01T00:00:00Z" } });
    expect(result).toMatchObject({ ok: true, ready: true, recoveryState: "none", reEnrollRequired: false });
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalledWith("mfa_recovery_state");
  });

});

describe("credentials handler", () => {
  function handler(mfa: any, caller: any = { id: ACTOR, role: "MAIN_ADMIN", business_id: BUSINESS }) {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: BUSINESS, subscription_status: "ACTIVE" }, error: null }) };
    const route = sourceHandler("app/api/credentials/route.ts", {
      "@supabase/supabase-js": { createClient: () => ({ rpc, from: () => query }) },
      "../../lib/api-auth": { getCallerAdmin: async () => caller, isPrivilegedRole: (role: string) => role === "MAIN_ADMIN" || role === "SUPER_ADMIN" },
      "../../lib/mfa-sensitive": { requireSensitiveMfa: typeof mfa === "function" ? mfa : async () => mfa },
    }, { SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-".repeat(2) });
    return { route, rpc };
  }

  it.each(["MAIN_ADMIN", "SUPER_ADMIN"])("lets %s save credentials with normal sign-in and no authenticator", async (role) => {
    const client = mfaClient({ role, currentLevel: "aal1", factors: [] });
    const { requireSensitiveMfa } = sourceExports("app/lib/mfa-sensitive.ts", { "@supabase/supabase-js": { createClient: () => client } });
    const { route, rpc } = handler(requireSensitiveMfa, { id: ACTOR, role, business_id: BUSINESS });
    const response = await route(new Request("https://test.invalid", { method: "POST", headers: { authorization: `Bearer ${jwt({ sub: USER, aal: "aal1" })}`, "x-admin-business-id": BUSINESS }, body: JSON.stringify({ business_id: BUSINESS, section: "yoco", yoco_secret_key: "sk_live_fixture", yoco_webhook_secret: "whsec_fixture" }) }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_sensitive_credentials_audited", expect.objectContaining({ p_actor_id: ACTOR, p_business_id: BUSINESS }));
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });

  it("does not reach database effects when server identity verification fails", async () => {
    const { route, rpc } = handler({ ok: false, status: 401, code: "INVALID_SESSION", message: "Sign in again" }, { id: ACTOR, role: "SUPER_ADMIN", business_id: BUSINESS });
    const response = await route(new Request("https://test.invalid", { method: "POST", headers: { authorization: `Bearer ${jwt()}`, "x-admin-business-id": BUSINESS }, body: JSON.stringify({ business_id: BUSINESS, section: "yoco", yoco_secret_key: "sk_live_fixture", yoco_webhook_secret: "whsec_fixture" }) }));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets a verified Super Admin act for the explicitly selected target", async () => {
    const caller = { id: ACTOR, role: "SUPER_ADMIN", business_id: OTHER_BUSINESS };
    const { route, rpc } = handler({ ok: true, actor: { id: ACTOR, role: "SUPER_ADMIN" } }, caller);
    const response = await route(new Request("https://test.invalid", { method: "POST", headers: { authorization: `Bearer ${jwt()}`, "x-admin-business-id": OTHER_BUSINESS }, body: JSON.stringify({ business_id: OTHER_BUSINESS, section: "yoco", yoco_secret_key: "sk_live_fixture", yoco_webhook_secret: "whsec_fixture" }) }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("denies a Super Admin body/header target mismatch", async () => {
    const caller = { id: ACTOR, role: "SUPER_ADMIN", business_id: OTHER_BUSINESS };
    const { route, rpc } = handler({ ok: true, actor: { id: ACTOR, role: "SUPER_ADMIN" } }, caller);
    const response = await route(new Request("https://test.invalid", { method: "POST", headers: { authorization: `Bearer ${jwt()}`, "x-admin-business-id": OTHER_BUSINESS }, body: JSON.stringify({ business_id: BUSINESS, section: "yoco", yoco_secret_key: "sk_live_fixture", yoco_webhook_secret: "whsec_fixture" }) }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
