import { describe, expect, it } from "vitest";
import { sourceExports } from "../helpers/source-handler";
import * as layouts from "../../app/lib/dashboard-layout";
import * as roles from "../../app/lib/role-utils";

const A = "10000000-0000-4000-8000-000000000001", B = "10000000-0000-4000-8000-000000000002";
const defaults = () => structuredClone(layouts.DEFAULT_DASHBOARD_LAYOUT);
function fixture() {
  const admin = { id: "admin", user_id: "user", role: "MAIN_ADMIN", business_id: A, read_only: false, suspended: false };
  const tables: Record<string, any[]> = { admin_users: [admin], businesses: [A, B].map(id => ({ id, subscription_status: "ACTIVE" })), operator_dashboard_layouts: [] };
  let failure = false;
  const db = {
    auth: { getUser: async (token: string) => ({ data: { user: token === "fixture" ? { id: "user" } : null } }) },
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      let update: any, insert: any;
      const chain: any = {
        select: () => chain, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return chain; },
        update: (value: any) => { update = value; return chain; }, insert: (value: any) => { insert = value; return chain; },
        async maybeSingle() {
          if (failure && table === "operator_dashboard_layouts") return { error: { code: "XX000" }, data: null };
          if (insert) {
            if (tables[table].some(row => row.business_id === insert.business_id)) return { error: { code: "23505" }, data: null };
            tables[table].push(structuredClone(insert)); return { data: structuredClone(insert), error: null };
          }
          const row = tables[table].find(row => filters.every(test => test(row)));
          if (row && update) Object.assign(row, structuredClone(update));
          return { data: row ? structuredClone(row) : null, error: null };
        },
      };
      return chain;
    },
  };
  const supabase = { createClient: () => db };
  const auth = sourceExports("app/lib/api-auth.ts", { "@supabase/supabase-js": supabase, "./role-utils": roles });
  const api = sourceExports("app/api/dashboard-layout/route.ts", {
    "@supabase/supabase-js": supabase, "../../lib/api-auth": auth, "../../lib/dashboard-layout": layouts,
  }) as Record<"GET" | "POST", (req: Request) => Promise<Response>>;
  const request = (method: "GET" | "POST", body?: unknown, businessId = A, token = "fixture") => api[method](new Request("https://fixture.invalid/api/dashboard-layout", {
    method, headers: { authorization: `Bearer ${token}`, "x-admin-business-id": businessId }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }));
  return { admin, tables, request, fail: () => { failure = true; } };
}

describe("operator dashboard layouts", () => {
  it("normalizes older layouts while preserving order and hidden choices; moving preserves hidden tiles", () => {
    const saved = layouts.readDashboardLayout(["weather", "weather", "retired", "guests"], ["weather", "retired"]);
    expect(saved.order.slice(0, 2)).toEqual(["weather", "guests"]);
    expect(new Set(saved.order).size).toBe(10); expect(saved.hidden).toEqual(["weather"]);
    const moved = layouts.moveDashboardTile(saved, "guests", "weather");
    expect(moved.order.slice(0, 2)).toEqual(["guests", "weather"]); expect(moved.hidden).toEqual(["weather"]);
    expect(saved.order[0]).toBe("weather");
  });

  it.each(["MAIN_ADMIN", "SUPER_ADMIN"])("%s saves, reloads and restores a shared operator layout", async role => {
    const f = fixture(); f.admin.role = role;
    expect(await (await f.request("GET")).json()).toEqual({ layout: defaults(), revision: 0 });
    const layout = layouts.moveDashboardTile(defaults(), "weather", "next_departure"); layout.hidden = ["inbox"];
    expect((await f.request("POST", { layout, revision: 0 })).status).toBe(200);
    f.admin.role = "ADMIN";
    const get = await f.request("GET"); expect(get.headers.get("Cache-Control")).toBe("no-store");
    expect(await get.json()).toEqual({ layout, revision: 1 });
    f.admin.role = role; layout.hidden = [];
    expect((await f.request("POST", { layout, revision: 1 })).status).toBe(200);
    expect(await (await f.request("GET")).json()).toEqual({ layout, revision: 2 });
  });

  it.each(["ADMIN", "GUIDE", "VIEWER", "unknown"])("%s can view but cannot save even by calling the API", async role => {
    const f = fixture(); f.admin.role = role;
    expect((await f.request("GET")).status).toBe(200);
    expect((await f.request("POST", { layout: defaults(), revision: 0 })).status).toBe(403);
    expect(f.tables.operator_dashboard_layouts).toHaveLength(0);
  });

  it("rejects anonymous, read-only, suspended and cross-operator writes using real authentication checks", async () => {
    const f = fixture(), body = { layout: defaults(), revision: 0 };
    expect((await f.request("GET", undefined, A, "invalid")).status).toBe(401);
    expect((await f.request("POST", body, A, "invalid")).status).toBe(403);
    f.admin.read_only = true; expect((await f.request("POST", body)).status).toBe(403);
    f.admin.read_only = false; f.admin.suspended = true; expect((await f.request("POST", body)).status).toBe(403);
    f.admin.suspended = false; expect((await f.request("POST", body, B)).status).toBe(403);
    expect((await f.request("GET", undefined, B)).status).toBe(401);
    f.tables.businesses[0].subscription_status = "SUSPENDED";
    expect((await f.request("POST", body)).status).toBe(403);
    expect(f.tables.operator_dashboard_layouts).toHaveLength(0);
  });

  it("scopes super-admin edits to the selected operator and cannot pivot to a missing operator", async () => {
    const f = fixture(); f.admin.role = "SUPER_ADMIN";
    const layout = defaults(); layout.hidden = ["weather"];
    expect((await f.request("POST", { layout, revision: 0 }, B)).status).toBe(200);
    expect(await (await f.request("GET", undefined, A)).json()).toEqual({ layout: defaults(), revision: 0 });
    expect(await (await f.request("GET", undefined, B)).json()).toEqual({ layout, revision: 1 });
    expect((await f.request("POST", { layout, revision: 0 }, "10000000-0000-4000-8000-000000000099")).status).toBe(403);
  });

  it("rejects malformed, partial, duplicate or injected layouts without writing", async () => {
    const f = fixture(), layout = defaults();
    for (const body of [
      {}, null, { layout, revision: -1 }, { layout, revision: 0.5 }, { layout, revision: 2147483647 },
      { layout, revision: 0, business_id: B },
      { layout: { ...layout, order: layout.order.slice(1) }, revision: 0 },
      { layout: { ...layout, order: layout.order.map(() => "weather") }, revision: 0 },
      { layout: { ...layout, hidden: ["secret"] }, revision: 0 },
      { layout: { ...layout, hidden: ["inbox", "inbox"] }, revision: 0 },
      { layout: { ...layout, extra: true }, revision: 0 },
    ]) expect((await f.request("POST", body)).status).toBe(400);
    expect(f.tables.operator_dashboard_layouts).toHaveLength(0);
  });

  it("rejects stale first-save and update revisions instead of overwriting another admin", async () => {
    const f = fixture(), initial = defaults(), change = defaults(); change.hidden = ["weather"];
    expect((await f.request("POST", { layout: initial, revision: 0 })).status).toBe(200);
    expect((await f.request("POST", { layout: change, revision: 0 })).status).toBe(409);
    expect((await f.request("POST", { layout: change, revision: 1 })).status).toBe(200);
    expect((await f.request("POST", { layout: initial, revision: 1 })).status).toBe(409);
    expect(await (await f.request("GET")).json()).toEqual({ layout: change, revision: 2 });
  });

  it("allows all-hidden layouts and returns failures without resetting the persisted layout", async () => {
    const f = fixture(), layout = defaults(); layout.hidden = [...layout.order];
    expect((await f.request("POST", { layout, revision: 0 })).status).toBe(200);
    f.fail();
    expect((await f.request("POST", { layout: defaults(), revision: 1 })).status).toBe(503);
    expect((await f.request("GET")).status).toBe(503);
    expect(f.tables.operator_dashboard_layouts[0].hidden_tiles).toEqual(layout.hidden);
  });
});
