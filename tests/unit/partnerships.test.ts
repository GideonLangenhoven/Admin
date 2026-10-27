import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const P = "10000000-0000-4000-8000-000000000003";
const TOKEN = "a".repeat(64);

function fixture(status = "PENDING", emailWorks = true) {
  let caller = { role: "MAIN_ADMIN", business_id: A };
  const partnership: any = { id: P, business_a_id: A, business_b_id: B, status, initiated_by: A, invite_token: TOKEN, invite_email: "partner@example.invalid", accepted_at: "old", revoked_at: "old" };
  let beforeUpdate: (() => void) | undefined;
  const tables: Record<string, any[]> = {
    business_partnerships: [partnership],
    admin_users: [{ business_id: B, email: "partner@example.invalid", name: "Partner" }],
    businesses: [{ id: A, name: '<script>alert("x")</script>' }, { id: B, name: "Partner", subdomain: "partner" }],
  };
  const db = { from(table: string) {
    const filters: Array<(row: any) => boolean> = [];
    let update: any, inserted: any, columns = "*";
    const chain: any = {
      select: (value = "*") => { columns = value; return chain; },
      update: (value: any) => { update = value; return chain; },
      insert: (value: any) => { inserted = value; return chain; },
      eq: (key: string, value: any) => { filters.push(row => row[key] === value); return chain; },
      neq: (key: string, value: any) => { filters.push(row => row[key] !== value); return chain; },
      in: () => chain,
      or: (value: string) => { filters.push(row => value.split(",").some(part => { const [key, , expected] = part.split("."); return row[key] === expected; })); return chain; },
      order: () => chain,
      single: () => result(true), maybeSingle: () => result(true),
      then: (done: any, fail: any) => result(false).then(done, fail),
    };
    async function result(single: boolean) {
      if (update) { beforeUpdate?.(); beforeUpdate = undefined; }
      if (inserted) tables[table].push({ id: P, ...inserted });
      const rows = tables[table].filter(row => filters.every(test => test(row)));
      if (update) rows.forEach(row => Object.assign(row, update));
      const selected = rows.map(row => {
        const result: any = columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map(key => key.trim()).filter(key => key in row).map(key => [key, row[key]]));
        if (columns.includes("business_a:")) {
          result.business_a = tables.businesses[0]; result.business_b = tables.businesses[1];
        }
        return result;
      });
      return { data: single ? selected[0] || null : selected, error: null };
    }
    return chain;
  } };
  const fetchEmail = vi.fn(async () => Response.json({ ok: emailWorks }, { status: emailWorks ? 200 : 503 }));
  const mocks = {
    "@supabase/supabase-js": { createClient: () => db },
    "../../lib/api-auth": { getCallerAdmin: async () => caller, isPrivilegedRole: (role: string) => ["MAIN_ADMIN", "SUPER_ADMIN"].includes(role) },
  };
  const api = sourceExports("app/api/partnerships/route.ts", mocks, {}, fetchEmail) as Record<string, (request: Request) => Promise<Response>>;
  const approve = sourceExports("app/api/partnerships/approve/route.ts", {
    "@supabase/supabase-js": { createClient: () => db }, "../route": api,
    "next/server": { NextRequest: Request },
  }) as typeof api;
  const request = (body: any) => new Request("https://fixture.invalid/api/partnerships", { method: "POST", body: JSON.stringify(body) });
  const post = (action: string, extra: any = {}) => api.POST(request({ action, business_id: caller.business_id, partnership_id: P, ...extra }));
  const get = (url: string) => Object.assign(new Request(url), { nextUrl: new URL(url) });
  return { api, approve, post, get, partnership, tables, fetchEmail, setCaller: (role: string, business_id = A) => { caller = { role, business_id }; }, race: (fn: () => void) => { beforeUpdate = fn; } };
}

describe("partnership consent and invitations", () => {
  it.each([["23514", 409], ["XX000", 503]])("stops checkout before holds or payment when the partnership check fails (%s)", async (code, status) => {
    const reads: string[] = [];
    const db = {
      from(table: string) {
        reads.push(table);
        if (table !== "combo_offers") throw new Error("Unexpected checkout side effect: " + table);
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: P, active: true }, error: null }) };
        return chain;
      },
      rpc: vi.fn(async () => ({ error: { code } })),
    };
    const handler = sourceHandler("supabase/functions/create-paysafe-checkout/index.ts", {
      "../_shared/tenant.ts": { createServiceClient: () => db },
      "../_shared/combo.ts": {}, "../_shared/subscription.ts": {},
    });
    const response = await handler(new Request("https://fixture.invalid/checkout", {
      method: "POST", body: JSON.stringify({ combo_offer_id: P, qty: 1 }),
    }));
    expect(response.status).toBe(status);
    expect(db.rpc).toHaveBeenCalledWith("assert_combo_offer_partnerships", { p_offer_id: P });
    expect(reads).toEqual(["combo_offers"]);
  });

  it("denies sender self-acceptance, allows recipient, consumes token and returns no invitation secrets", async () => {
    const f = fixture();
    expect((await f.post("accept")).status).toBe(409);
    expect(f.partnership.status).toBe("PENDING");
    f.setCaller("MAIN_ADMIN", B);
    const response = await f.post("accept");
    expect(response.status).toBe(200);
    expect(f.partnership.status).toBe("ACTIVE");
    expect(f.partnership.invite_token).toBeNull();
    expect((await response.json()).partnership).not.toHaveProperty("invite_token");
  });

  it("hides invitation secrets from dashboard reads and denies non-owner roles", async () => {
    const f = fixture(), req = f.get("https://fixture.invalid/api/partnerships?business_id=" + A);
    const response = await f.api.GET(req), data = await response.json();
    expect(response.status).toBe(200);
    expect(data.partnerships[0]).not.toHaveProperty("invite_token");
    expect(data.partnerships[0]).not.toHaveProperty("invite_email");
    f.setCaller("ADMIN"); expect((await f.api.GET(req)).status).toBe(403);
    f.setCaller("MAIN_ADMIN", B); expect((await f.api.GET(req)).status).toBe(403);
  });

  it("reinvites the same revoked pair with a new token and preserves its identity", async () => {
    const f = fixture("REVOKED");
    const response = await f.post("invite", { partner_email: " PARTNER@EXAMPLE.INVALID " });
    expect(response.status).toBe(200);
    expect(f.tables.business_partnerships).toHaveLength(1);
    expect(f.partnership).toMatchObject({ id: P, status: "PENDING", accepted_at: null, revoked_at: null });
    expect(f.partnership.invite_token).not.toBe(TOKEN);
    const data = await response.json(); expect(data.email_sent).toBe(true);
    expect(data.partnership).not.toHaveProperty("invite_token");
    expect((await f.post("invite", { partner_email: "partner@example.invalid" })).status).toBe(409);
    expect(f.fetchEmail).toHaveBeenCalledOnce();
  });

  it("reports failed email delivery without losing the dashboard invitation", async () => {
    const f = fixture("REVOKED", false), log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { const result = await f.post("invite", { partner_email: "partner@example.invalid" });
      expect((await result.json()).email_sent).toBe(false); expect(f.partnership.status).toBe("PENDING");
    } finally { log.mockRestore(); }
  });

  it("requires the correct email, consumes tokens once, and rejects a token changed during acceptance", async () => {
    const f = fixture();
    expect((await f.post("accept_token", { token: TOKEN, invite_email: "wrong@example.invalid" })).status).toBe(403);
    f.race(() => { f.partnership.invite_token = "b".repeat(64); });
    expect((await f.post("accept_token", { token: TOKEN, invite_email: "partner@example.invalid" })).status).toBe(409);
    expect(f.partnership.status).toBe("PENDING");
    expect((await f.post("accept_token", { token: "b".repeat(64), invite_email: "partner@example.invalid" })).status).toBe(200);
    expect((await f.post("accept_token", { token: "b".repeat(64), invite_email: "partner@example.invalid" })).status).toBe(404);
  });

  it("email GET is read-only and escapes names; only the explicit form POST accepts", async () => {
    const f = fixture();
    const response = await f.approve.GET(f.get("https://fixture.invalid/api/partnerships/approve?token=" + TOKEN));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('method="post"'); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
    expect(f.partnership.status).toBe("PENDING");
    const form = new URLSearchParams({ token: TOKEN, invite_email: "partner@example.invalid" });
    const accepted = await f.approve.POST(new Request("https://fixture.invalid/api/partnerships/approve", { method: "POST", body: form }));
    expect(accepted.status).toBe(200); expect(f.partnership.status).toBe("ACTIVE");
    expect((await f.approve.GET(f.get("https://fixture.invalid/api/partnerships/approve?token=" + TOKEN))).status).toBe(404);
  });
});
