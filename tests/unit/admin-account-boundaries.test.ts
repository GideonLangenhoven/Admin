import { describe, expect, it } from "vitest";
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
    auth: {
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
  const invoke = async (route: "update" | "setup-link" | "login", body: object) => {
    const handler = sourceHandler(`app/api/admin/${route}/route.ts`, {
      "@supabase/supabase-js": { createClient: () => db },
      "../../../lib/api-auth": { getCallerAdmin: async () => caller, canManageAdmin, isPrivilegedRole },
      "../../../lib/admin-password": { setAdminAuthPassword },
    });
    const req = Object.assign(new Request("https://admin.example.invalid/api/admin/" + route, { method: "POST", body: JSON.stringify(body) }), { nextUrl: new URL("https://admin.example.invalid") });
    return handler(req);
  };
  return { target, updates, emails, passwords, invoke };
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
    expect(f.emails[0].body.data.business_id).toBe("business-b");
  });
});

describe("password reset completion", () => {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  for (const role of ["ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"]) {
    for (const route of ["setup-link", "update"] as const) {
      for (const fails of [false, true]) {
        it(`${role} ${route} ${fails ? "keeps its previous password and link on Auth failure" : "updates both password stores"}`, async () => {
          const f = fixture("business-a", role, { ...main, role: "SUPER_ADMIN" }, fails);
          Object.assign(f.target, { password_hash: hash("Previous-password"), setup_token_hash: hash("fixture-token"), setup_token_expires_at: new Date(Date.now() + 60000).toISOString() });
          const before = { ...f.target };
          const res = await f.invoke(route, route === "setup-link"
            ? { action: "complete", email: f.target.email, token: "fixture-token", password: "Replacement-password" }
            : { action: "reset_password", admin_id: f.target.id, password: "Replacement-password" });
          expect(res.status).toBe(fails ? 502 : 200);
          expect(f.passwords).toHaveLength(1);
          if (fails) { expect(f.target).toEqual(before); expect(f.updates).toEqual([]); }
          else expect(f.target.password_hash).toBe(hash("Replacement-password"));
          const login = await f.invoke("login", { email: f.target.email, password: fails ? "Previous-password" : "Replacement-password" });
          expect(login.status).toBe(200);
        });
      }
    }
  }
  it("keeps self-service password changes retryable when Auth fails", async () => {
    const f = fixture("business-a", "ADMIN", null, true);
    f.target.password_hash = hash("Previous-password");
    const res = await f.invoke("update", { action: "change_password", email: f.target.email, current_password: "Previous-password", new_password: "Replacement-password" });
    expect(res.status).toBe(502);
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
});
