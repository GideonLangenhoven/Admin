import { describe, expect, it } from "vitest";
import { sourceExports } from "../helpers/source-handler";

function adminDb(role: string, options: { readOnly?: boolean; suspended?: boolean; subscription?: string; missing?: boolean } = {}) {
  const calls: string[] = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "synthetic-user" } }, error: null }) },
    from(table: string) {
      calls.push(table);
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: table === "admin_users"
          ? options.missing ? null : {
            id: "synthetic-admin", business_id: "synthetic-business", role,
            suspended: options.suspended ?? false, read_only: options.readOnly ?? false,
          }
          : { subscription_status: options.subscription ?? "ACTIVE" }, error: null }),
      };
      return query;
    },
  };
  return { db, calls };
}

function apiAuth(db: unknown) {
  return sourceExports("app/lib/api-auth.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "./role-utils": {},
  }).getCallerAdmin as (request: Request, options?: { skipSubscriptionCheck?: boolean }) => Promise<unknown>;
}

function edgeAuth(db: unknown, env: Record<string, string> = {}) {
  return sourceExports("supabase/functions/_shared/auth.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db },
  }, env).requireAuth as (request: Request, options?: { allowReadOnly?: boolean }) => Promise<unknown>;
}

function request(method = "POST") {
  return new Request("https://fixture.invalid/protected", {
    method, headers: { authorization: "Bearer synthetic-user" },
  });
}

describe("exact staff authority at shared server boundaries", () => {
  it.each(["OPERATOR", "ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"])("retains %s in both helpers", async role => {
    expect(await apiAuth(adminDb(role).db)(request())).toMatchObject({ role });
    await expect(edgeAuth(adminDb(role).db)(request())).resolves.toMatchObject({ role });
  });

  it.each(["FUTURE_STAFF", "SUPER_PREFIX", "", "operator"])("denies unknown role %s before tenant work", async role => {
    const api = adminDb(role);
    expect(await apiAuth(api.db)(request())).toBeNull();
    expect(await apiAuth(api.db)(request(), { skipSubscriptionCheck: true })).toBeNull();
    expect(api.calls).toEqual(["admin_users", "admin_users"]);
    const edge = adminDb(role);
    await expect(edgeAuth(edge.db)(request())).rejects.toThrow("active admin");
    await expect(edgeAuth(edge.db)(request(), { allowReadOnly: true })).rejects.toThrow("active admin");
    expect(edge.calls).toEqual(["admin_users", "admin_users"]);
  });

  it("keeps read-only browsing, blocks mutation, and retains billing recovery", async () => {
    const demo = adminDb("OPERATOR", { readOnly: true });
    expect(await apiAuth(demo.db)(request("GET"))).toMatchObject({ role: "OPERATOR" });
    expect(await apiAuth(demo.db)(request())).toBeNull();
    await expect(edgeAuth(demo.db)(request(), { allowReadOnly: true })).resolves.toMatchObject({ readOnly: true });
    await expect(edgeAuth(demo.db)(request())).rejects.toThrow("read-only");

    const paused = adminDb("MAIN_ADMIN", { subscription: "PAUSED" });
    expect(await apiAuth(paused.db)(request())).toBeNull();
    expect(await apiAuth(paused.db)(request(), { skipSubscriptionCheck: true })).toMatchObject({ role: "MAIN_ADMIN" });
  });

  it("keeps suspended and missing staff denied, and permits internal service identity", async () => {
    expect(await apiAuth(adminDb("MAIN_ADMIN", { suspended: true }).db)(request())).toBeNull();
    expect(await apiAuth(adminDb("MAIN_ADMIN", { missing: true }).db)(request())).toBeNull();
    await expect(edgeAuth(adminDb("MAIN_ADMIN", { suspended: true }).db)(request())).rejects.toThrow("active admin");
    const db = adminDb("FUTURE_STAFF");
    const internal = edgeAuth(db.db, { SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" });
    await expect(internal(new Request("https://fixture.invalid/internal", {
      headers: { authorization: "Bearer synthetic-service" },
    }))).resolves.toMatchObject({ isServiceRole: true });
    expect(db.calls).toEqual([]);
  });
});
