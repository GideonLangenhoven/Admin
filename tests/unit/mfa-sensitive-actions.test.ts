import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";
import { MfaSensitiveActionPanel } from "../../components/MfaSensitiveActionPanel";

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
    id: ACTOR, user_id: USER, role: options.role ?? "MAIN_ADMIN", business_id: BUSINESS,
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
    from: query,
  };
}

async function inspect(options: Parameters<typeof mfaClient>[0], token = jwt()) {
  const client = mfaClient(options);
  const exports = sourceExports("app/lib/mfa-sensitive.ts", {
    "@supabase/supabase-js": { createClient: () => client },
  });
  const result = await (exports.requireSensitiveMfa as any)(new Request("https://test.invalid", {
    headers: { authorization: `Bearer ${token}` },
  }), { allowedRoles: ["MAIN_ADMIN", "SUPER_ADMIN"], expectedActorId: ACTOR });
  return { result, client };
}

describe("sensitive-action MFA authority", () => {
  it("denies AAL1 before a sensitive effect", async () => {
    const { result } = await inspect({ currentLevel: "aal1" });
    expect(result).toMatchObject({ ok: false, status: 403, code: "MFA_REQUIRED" });
  });

  it("accepts a signed AAL2 session only while a verified TOTP factor still exists", async () => {
    const { result } = await inspect({});
    expect(result).toMatchObject({ ok: true, actor: { id: ACTOR, role: "MAIN_ADMIN" } });
  });

  it("rejects stale aal2 when its verified factors have been deleted", async () => {
    const { result } = await inspect({ factors: [] });
    expect(result).toMatchObject({ ok: false, status: 403, code: "MFA_FACTOR_MISSING" });
  });

  it.each([
    ["ADMIN", false, false, "ROLE_FORBIDDEN"],
    ["MAIN_ADMIN", true, false, "ACCOUNT_INACTIVE"],
    ["MAIN_ADMIN", false, true, "DEMO_READ_ONLY"],
  ])("rejects role=%s suspended=%s demo=%s", async (role, suspended, readOnly, code) => {
    const { result } = await inspect({ role, suspended, readOnly });
    expect(result).toMatchObject({ ok: false, code });
  });

  it("rejects malformed, forged, or expired JWTs when Auth validation fails", async () => {
    const { result } = await inspect({ userError: new Error("invalid token") }, "not-a-jwt");
    expect(result).toMatchObject({ ok: false, status: 401, code: "INVALID_SESSION" });
  });

  it("keeps an operator blocked while recovery is pending", async () => {
    const { result } = await inspect({ recovery: { status: "PARTIAL", completed_at: null } });
    expect(result).toMatchObject({ ok: false, status: 423, code: "MFA_RECOVERY_PENDING" });
  });

  it("requires a factor and challenge created after completed recovery", async () => {
    const { result } = await inspect({
      recovery: { status: "COMPLETED", completed_at: "2030-01-01T00:00:00.000Z" },
      factors: [{ id: FACTOR, factor_type: "totp", status: "verified", created_at: "2026-09-21T07:00:00.000Z", updated_at: "2026-09-21T07:01:00.000Z" }],
    });
    expect(result).toMatchObject({ ok: false, code: "MFA_REENROLL_REQUIRED" });
  });

  it("accepts only a new verified factor and challenge after completed recovery", async () => {
    const { result } = await inspect({
      recovery: { status: "COMPLETED", completed_at: "2030-01-01T00:00:00.000Z" },
      factors: [{ id: FACTOR, factor_type: "totp", status: "verified", created_at: "2030-01-01T00:01:00.000Z", updated_at: "2030-01-01T00:02:00.000Z" }],
      methods: [{ method: "mfa/totp", timestamp: Date.parse("2030-01-01T00:03:00.000Z") / 1000 }],
    });
    expect(result).toMatchObject({ ok: true, ready: true });
  });
});

describe("credentials handler", () => {
  function handler(mfa: any, caller: any = { id: ACTOR, role: "MAIN_ADMIN", business_id: BUSINESS }) {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: BUSINESS, subscription_status: "ACTIVE" }, error: null }) };
    const route = sourceHandler("app/api/credentials/route.ts", {
      "@supabase/supabase-js": { createClient: () => ({ rpc, from: () => query }) },
      "../../lib/api-auth": { getCallerAdmin: async () => caller, isPrivilegedRole: (role: string) => role === "MAIN_ADMIN" || role === "SUPER_ADMIN" },
      "../../lib/mfa-sensitive": { requireSensitiveMfa: async () => mfa },
    }, { SETTINGS_ENCRYPTION_KEY: "fixture-encryption-key-".repeat(2) });
    return { route, rpc };
  }

  it("does not reach provider or database effects for AAL1", async () => {
    const { route, rpc } = handler({ ok: false, status: 403, code: "MFA_REQUIRED", message: "Authenticator code required" });
    const response = await route(new Request("https://test.invalid", { method: "POST", headers: { authorization: `Bearer ${jwt()}` }, body: JSON.stringify({ business_id: BUSINESS, section: "yoco", yoco_secret_key: "sk_live_fixture", yoco_webhook_secret: "whsec_fixture" }) }));
    expect(response.status).toBe(403);
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

describe("MFA inline UI", () => {
  it("renders enrollment, recovery guidance, and a cancel path without owning form values", () => {
    const markup = renderToStaticMarkup(React.createElement(MfaSensitiveActionPanel, {
      mode: "enroll", actionLabel: "Save bank details", code: "", qrCode: "data:image/svg+xml,fixture",
      secret: "FIXTURE", error: "", busy: false, onCodeChange: () => {}, onVerify: () => {}, onCancel: () => {},
    }));
    expect(markup).toContain("Set up an authenticator");
    expect(markup).toContain("Continue bookings");
    expect(markup).toContain("Cancel");
    expect(markup).not.toContain("bank_account_number");
  });
});
