import { describe, expect, it } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";

// S4: once admins have enrolled TOTP, privileged edge functions and API routes reject sessions below AAL2.
// The gate is off until ENFORCE_ADMIN_AAL2_ROLES is set, so rolling it out cannot lock anyone out by surprise.

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tokenWith = (claims: object) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.fake-signature-for-tests`;
const AAL1 = tokenWith({ aal: "aal1", sub: "u" });
const AAL2 = tokenWith({ aal: "aal2", sub: "u" });
const NO_CLAIM = "not-a-jwt";

const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2";
const ENV = { SUPABASE_URL: "https://fn.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key-fixture" };

function fakeDb(role: string) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "a@example.invalid", email_confirmed_at: "2026-01-01T00:00:00Z" } }, error: null }) },
    from: () => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "a1", business_id: "biz-a", role, suspended: false, read_only: false }, error: null }) };
      return q;
    },
  };
}
const request = (token: string) => new Request("https://fn.invalid/", { headers: { authorization: `Bearer ${token}` } });

describe("edge requireAuth AAL2 gate", () => {
  const authFor = (role: string, enforce?: string) =>
    sourceExports("supabase/functions/_shared/auth.ts", { [SUPABASE_JS]: { createClient: () => fakeDb(role) } }, { ...ENV, ...(enforce !== undefined ? { ENFORCE_ADMIN_AAL2_ROLES: enforce } : {}) }) as any;

  it("is off by default: an aal1 SUPER_ADMIN session is accepted", async () => {
    expect(await authFor("SUPER_ADMIN").requireAuth(request(AAL1))).toMatchObject({ role: "SUPER_ADMIN" });
  });

  it.each(["SUPER_ADMIN", "MAIN_ADMIN"])("rejects an aal1 %s session once enforced", async (role) => {
    await expect(authFor(role, "SUPER_ADMIN,MAIN_ADMIN").requireAuth(request(AAL1))).rejects.toMatchObject({ kind: "mfa_required" });
  });

  it("accepts the same admin with an aal2 session", async () => {
    expect(await authFor("MAIN_ADMIN", "SUPER_ADMIN,MAIN_ADMIN").requireAuth(request(AAL2))).toMatchObject({ role: "MAIN_ADMIN" });
  });

  it("fails closed when the assurance level cannot be read", async () => {
    await expect(authFor("MAIN_ADMIN", "MAIN_ADMIN").requireAuth(request(NO_CLAIM))).rejects.toMatchObject({ kind: "mfa_required" });
  });

  it("does not touch roles outside the enforced list", async () => {
    expect(await authFor("OPERATOR", "SUPER_ADMIN,MAIN_ADMIN").requireAuth(request(AAL1))).toMatchObject({ role: "OPERATOR" });
  });

  it("does not affect internal service-key callers", async () => {
    expect(await authFor("MAIN_ADMIN", "SUPER_ADMIN,MAIN_ADMIN").requireAuth(request("service-key-fixture"))).toMatchObject({ isServiceRole: true });
  });

  it("process-refund answers 403 with the reason", async () => {
    const db = { ...fakeDb("MAIN_ADMIN"), from: fakeDb("MAIN_ADMIN").from };
    const auth = sourceExports("supabase/functions/_shared/auth.ts", { [SUPABASE_JS]: { createClient: () => db } }, { ...ENV, ENFORCE_ADMIN_AAL2_ROLES: "MAIN_ADMIN" });
    const handler = sourceHandler("supabase/functions/process-refund/index.ts", {
      "../_shared/tenant.ts": { createServiceClient: () => db, getTenantByBusinessId: async () => ({}), sendWhatsappTextForTenant: async () => ({}), getAdminAppOrigins: () => ["https://admin.bookingtours.co.za"], isAllowedOrigin: () => true },
      "../_shared/auth.ts": auth, "../_shared/vouchers.ts": {}, "../_shared/combo.ts": {},
    }, ENV);
    const r = await handler(new Request("https://fn.invalid/", { method: "POST", headers: { authorization: `Bearer ${AAL1}` }, body: JSON.stringify({ booking_id: "bk" }) }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Multi-factor authentication required" });
  });
});

describe("admin app getCallerAdmin AAL2 gate", () => {
  const serviceKey = "k".repeat(50); // api-auth refuses short keys
  const callerFor = (role: string, enforce?: string) => {
    const mod = sourceExports(
      "app/lib/api-auth.ts",
      { "@supabase/supabase-js": { createClient: () => fakeDb(role) }, "./role-utils": { isPrivilegedRole: () => true, canManageAdmin: () => true } },
      { NEXT_PUBLIC_SUPABASE_URL: "https://fn.invalid", SUPABASE_SERVICE_ROLE_KEY: serviceKey, ...(enforce !== undefined ? { ENFORCE_ADMIN_AAL2_ROLES: enforce } : {}) },
    ) as any;
    return (token: string) => mod.getCallerAdmin(request(token), { skipSubscriptionCheck: true });
  };

  it("is off by default", async () => expect(await callerFor("SUPER_ADMIN")(AAL1)).toMatchObject({ role: "SUPER_ADMIN" }));
  it("rejects an aal1 MAIN_ADMIN once enforced", async () => expect(await callerFor("MAIN_ADMIN", "SUPER_ADMIN,MAIN_ADMIN")(AAL1)).toBeNull());
  it("accepts aal2", async () => expect(await callerFor("MAIN_ADMIN", "SUPER_ADMIN,MAIN_ADMIN")(AAL2)).toMatchObject({ role: "MAIN_ADMIN" }));
  it("fails closed on an unreadable token", async () => expect(await callerFor("MAIN_ADMIN", "MAIN_ADMIN")(NO_CLAIM)).toBeNull());
  it("leaves other roles alone", async () => expect(await callerFor("OPERATOR", "SUPER_ADMIN,MAIN_ADMIN")(AAL1)).toMatchObject({ role: "OPERATOR" }));
});
