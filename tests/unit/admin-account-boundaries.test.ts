import { describe, expect, it, vi } from "vitest";
import { canManageAdmin, isPrivilegedRole } from "../../app/lib/role-utils";
import { sourceHandler } from "../helpers/source-handler";
import { setAdminAuthPassword } from "../../app/lib/admin-password";
import { createHash } from "node:crypto";

const main = { id: "main-a", role: "MAIN_ADMIN", business_id: "business-a" };
function fixture(targetBusiness = "business-a", targetRole = "ADMIN", caller: typeof main | null = main, authFails = false) {
  const target: Record<string, unknown> = { id: "target", user_id: "auth-target", email: "staff@example.invalid", name: "Staff", role: targetRole, business_id: targetBusiness };
  const updates: unknown[] = [];
  const emails: any[] = [];
  const passwords: unknown[] = [];
  let authPassword = "Previous-password";
  const db = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | undefined;
      const execute = async () => {
        const matches = table === "admin_users" && filters.every(([key, value]) => target[key] === value);
        if (matches && patch) { updates.push(patch); Object.assign(target, patch); }
        return { data: matches ? target : null, error: null };
      };
      const q = { select: () => q, update: (value: Record<string, unknown>) => { patch = value; return q; }, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, maybeSingle: execute, then: (resolve: (value: unknown) => unknown) => execute().then(resolve) };
      return q;
    },
    functions: { invoke: async (_name: string, body: unknown) => { emails.push(body); return { error: null }; } },
    rpc: async (name: string, args: Record<string, any>) => {
      if (name === "issue_admin_setup_token") {
        const claimedAt = Date.parse(String(target.setup_token_claimed_at || ""));
        if (target.setup_token_claim_id && Number.isFinite(claimedAt) && claimedAt > Date.now() - 5 * 60 * 1000) {
          return { data: { status: "BUSY" }, error: null };
        }
        Object.assign(target, {
          setup_token_hash: args.p_token_hash,
          setup_token_expires_at: args.p_expires_at,
          setup_token_claim_id: null,
          setup_token_claimed_at: null,
          ...(args.p_force_setup ? { must_set_password: true } : {}),
        });
        return { data: { status: "ISSUED" }, error: null };
      }
      if (name === "claim_admin_setup_token") {
        if (target.setup_token_hash !== args.p_token_hash) return { data: { status: "INVALID" }, error: null };
        if (target.setup_token_claim_id && target.setup_token_claim_id !== args.p_claim_id) {
          return { data: { status: "BUSY" }, error: null };
        }
        target.setup_token_claim_id = args.p_claim_id;
        target.setup_token_claimed_at = new Date().toISOString();
        return { data: { status: "CLAIMED", admin: { ...target } }, error: null };
      }
      if (name === "complete_admin_setup_token") {
        if (target.setup_token_claim_id !== args.p_claim_id || target.setup_token_hash !== args.p_token_hash) {
          return { data: false, error: null };
        }
        Object.assign(target, {
          user_id: args.p_user_id,
          password_hash: null,
          must_set_password: false,
          setup_token_hash_used: args.p_token_hash,
          setup_token_hash: null,
          setup_token_expires_at: null,
          setup_token_claim_id: null,
          setup_token_claimed_at: null,
        });
        return { data: true, error: null };
      }
      if (name === "release_admin_setup_token_claim") {
        if (target.setup_token_claim_id === args.p_claim_id) {
          target.setup_token_claim_id = null;
          target.setup_token_claimed_at = null;
        }
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: target.user_id } }, error: null }),
      admin: { updateUserById: async (...args: any[]) => {
        passwords.push(args);
        if (!authFails) authPassword = args[1].password;
        return { error: authFails ? new Error("Password service unavailable") : null };
      } },
      signInWithPassword: async ({ password }: { password: string }) => password === authPassword
        ? { data: { session: { access_token: "fixture-session", refresh_token: "fixture-refresh" } }, error: null }
        : { data: null, error: { message: "Wrong sign-in password" } },
    },
  };
  const invoke = async (route: "update" | "setup-link" | "login", body: object, token?: string) => {
    const handler = sourceHandler(`app/api/admin/${route}/route.ts`, {
      "@supabase/supabase-js": { createClient: () => db },
      "../../../lib/api-auth": { getCallerAdmin: async () => caller, canManageAdmin, isPrivilegedRole },
      "../../../lib/admin-password": { setAdminAuthPassword },
    }, { ADMIN_RECOVERY_ORIGIN: "https://trusted.example.invalid" });
    const req = Object.assign(new Request("https://admin.example.invalid/api/admin/" + route, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: JSON.stringify(body),
    }), { nextUrl: new URL("https://admin.example.invalid") });
    return handler(req);
  };
  return { target, updates, emails, passwords, invoke, authPassword: () => authPassword };
}

describe("R02/R03 administrator boundaries", () => {
  for (const action of ["reset_password", "update_permissions"]) {
    for (const [business, role] of [["business-a", "SUPER_ADMIN"], ["business-b", "ADMIN"]]) {
      it(`denies ${action} of ${business}/${role} without side effects`, async () => {
        const f = fixture(business, role);
        const res = await f.invoke("update", { action, admin_id: "target", password: "Fixture-only-password", permissions: {} });
        expect(res.status).toBe(403);
        expect(f.updates).toEqual([]);
        expect(f.passwords).toEqual([]);
      });
    }
  }
  it("preserves ordinary same-tenant password resets", async () => {
    const f = fixture();
    expect((await f.invoke("update", { action: "reset_password", admin_id: "target", password: "Fixture-only-password" })).status).toBe(200);
    expect(f.updates).toHaveLength(1);
    expect(f.passwords).toHaveLength(1);
  });
  it("preserves platform administrator support across tenants", async () => {
    const f = fixture("business-b", "MAIN_ADMIN", { ...main, role: "SUPER_ADMIN" });
    expect((await f.invoke("update", { action: "reset_password", admin_id: "target", password: "Fixture-only-password" })).status).toBe(200);
  });
  for (const businessId of ["business-a", undefined]) {
    it(`rejects foreign setup targets with ${businessId || "omitted"} caller business`, async () => {
      const f = fixture("business-b");
      expect((await f.invoke("setup-link", { action: "send", admin_id: "target", business_id: businessId })).status).toBe(403);
      expect(f.updates).toEqual([]);
      expect(f.emails).toEqual([]);
    });
  }
  it("rejects a tenant admin's setup invitation for a platform admin", async () => {
    const f = fixture("business-a", "SUPER_ADMIN");
    expect((await f.invoke("setup-link", { action: "send", admin_id: "target" })).status).toBe(403);
    expect(f.updates).toEqual([]);
  });
  it("preserves staff invitations and derives branding from the target", async () => {
    const f = fixture();
    expect((await f.invoke("setup-link", { action: "send", admin_id: "target", business_id: "forged-brand" })).status).toBe(200);
    expect(f.target.must_set_password).toBe(true);
    expect(f.emails[0].body.data.business_id).toBe("business-a");
  });
  it("preserves email-only self recovery without forcing setup or accepting caller branding", async () => {
    const f = fixture("business-b", "MAIN_ADMIN", null);
    expect((await f.invoke("setup-link", { action: "send", reason: "RESET", email: "staff@example.invalid", business_id: "forged-brand" })).status).toBe(200);
    expect(f.target.must_set_password).toBeUndefined();
    await vi.waitFor(() => expect(f.emails).toHaveLength(1));
    expect(f.emails[0].body.data.business_id).toBe("business-b");
  });
  it("does not rotate or email a setup token while its password completion owns the claim", async () => {
    const f = fixture();
    Object.assign(f.target, {
      setup_token_hash: "active-token",
      setup_token_claim_id: "11111111-1111-4111-8111-111111111111",
      setup_token_claimed_at: new Date().toISOString(),
    });
    const response = await f.invoke("setup-link", { action: "send", admin_id: "target" });
    expect(response.status).toBe(409);
    expect(f.target.setup_token_hash).toBe("active-token");
    expect(f.emails).toEqual([]);
  });
});

describe("password reset completion", () => {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  for (const role of ["ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"]) {
    for (const route of ["setup-link", "update"] as const) {
      for (const fails of [false, true]) {
        it(`${role} ${route} ${fails ? "keeps recovery retryable on Auth failure" : "uses Auth and clears the legacy password hash"}`, async () => {
          const f = fixture("business-a", role, { ...main, role: "SUPER_ADMIN" }, fails);
          Object.assign(f.target, { password_hash: hash("Previous-password"), setup_token_hash: hash("fixture-token"), setup_token_expires_at: new Date(Date.now() + 60000).toISOString() });
          const before = { ...f.target };
          const res = await f.invoke(route, route === "setup-link"
            ? { action: "complete", email: f.target.email, token: "fixture-token", password: "Replacement-password" }
            : { action: "reset_password", admin_id: f.target.id, password: "Replacement-password" });
          expect(res.status).toBe(fails ? 502 : 200);
          expect(f.passwords).toHaveLength(1);
          if (fails) {
            expect(f.target.password_hash).toBe(before.password_hash);
            expect(f.target.setup_token_hash).toBe(before.setup_token_hash);
            expect(f.authPassword()).toBe("Previous-password");
          } else {
            expect(f.target.password_hash).toBeNull();
            expect(f.authPassword()).toBe("Replacement-password");
          }
          const login = await f.invoke("login", {}, "verified-auth-session");
          expect(login.status).toBe(200);
        });
      }
    }
  }
  it("keeps self-service password changes retryable when Auth fails", async () => {
    const f = fixture("business-a", "ADMIN", { id: "target", role: "ADMIN", business_id: "business-a" }, true);
    f.target.password_hash = hash("Previous-password");
    const payload = Buffer.from(JSON.stringify({
      amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    })).toString("base64url");
    const res = await f.invoke("update", { action: "change_password", new_password: "Replacement-password" }, `header.${payload}.signature`);
    expect(res.status).toBe(502);
    expect(f.updates).toEqual([]);
  });
  it("does not treat an ordinary refreshed session as password reconfirmation", async () => {
    const f = fixture("business-a", "ADMIN", { id: "target", role: "ADMIN", business_id: "business-a" });
    const payload = Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000), amr: [] })).toString("base64url");
    const res = await f.invoke("update", { action: "change_password", new_password: "Replacement-password" }, `header.${payload}.signature`);
    expect(res.status).toBe(401);
    expect(f.passwords).toEqual([]);
    expect(f.updates).toEqual([]);
  });
  it("links an existing Auth account beyond the first page", async () => {
    const pages: number[] = [];
    const passwords: string[] = [];
    const db = { auth: { admin: {
      createUser: async () => ({ error: { code: "email_exists" } }),
      listUsers: async ({ page }: { page: number }) => {
        pages.push(page);
        return { data: { users: page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ id: String(i), email: `fixture-${i}@example.invalid` })) : [{ id: "found", email: "staff@example.invalid" }] }, error: null };
      },
      updateUserById: async (id: string) => { passwords.push(id); return { error: null }; },
    } } };
    expect(await setAdminAuthPassword(db as any, { id: "target", email: "staff@example.invalid" }, "Replacement-password")).toBe("found");
    expect(pages).toEqual([1, 2]);
    expect(passwords).toEqual(["found"]);
  });
  it("requires linked accounts to authenticate in the browser", async () => {
    const f = fixture();
    f.target.password_hash = createHash("sha256").update("Previous-password").digest("hex");
    const response = await f.invoke("login", { email: f.target.email, password: "Previous-password" });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Invalid credentials" });
    expect(body.session).toBeUndefined();
  });
});
