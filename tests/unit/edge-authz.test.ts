import { describe, expect, it } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";

// S5 (security test I): one authorization path for the money functions.
//  - exact role matching (a role that merely contains "super" is not a super admin)
//  - authenticate BEFORE touching the booking; "not found" and "not yours" are indistinguishable
//  - CORS never echoes localhost / unknown origins on the admin-facing functions
//  - service-key calls leave an audit row naming the function, the caller and the tenant

const ENV = { SUPABASE_URL: "https://fn.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key-fixture" };
const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2";

const BIZ_A = "biz-a";
const BIZ_B = "biz-b";
const bookings: Record<string, Record<string, unknown>> = {
  "bk-a": { id: "bk-a", business_id: BIZ_A, status: "PAID", email: "a@example.invalid", total_amount: 100, total_captured: 100, qty: 2, slot_id: "slot-a" },
  "bk-b": { id: "bk-b", business_id: BIZ_B, status: "PAID", email: "b@example.invalid", total_amount: 100, total_captured: 100, qty: 2, slot_id: "slot-b" },
};
const users: Record<string, { id: string; email: string; email_confirmed_at: string }> = Object.fromEntries(
  ["admin-a", "supervisor-a", "super-admin", "demo-a", "suspended-a", "no-admin-row"].map((t) => [`token-${t}`, { id: t, email: `${t}@example.invalid`, email_confirmed_at: "2026-01-01T00:00:00Z" }]),
);
const admins: Record<string, Record<string, unknown>> = {
  "admin-a": { business_id: BIZ_A, role: "MAIN_ADMIN", suspended: false, read_only: false },
  "supervisor-a": { business_id: BIZ_A, role: "SUPERVISOR", suspended: false, read_only: false },
  "super-admin": { business_id: null, role: "SUPER_ADMIN", suspended: false, read_only: false },
  "demo-a": { business_id: BIZ_A, role: "MAIN_ADMIN", suspended: false, read_only: true },
  "suspended-a": { business_id: BIZ_A, role: "MAIN_ADMIN", suspended: true, read_only: false },
};

function makeDb() {
  const state = { bookingLookups: [] as unknown[], inserts: [] as Array<{ table: string; row: Record<string, unknown> }> };
  const db = {
    auth: {
      getUser: async (token: string) => (users[token] ? { data: { user: users[token] }, error: null } : { data: { user: null }, error: { message: "invalid" } }),
    },
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      const resolve = () => {
        if (table === "admin_users") return { data: admins[eqs.user_id as string] ?? null, error: null };
        if (table === "bookings") {
          state.bookingLookups.push(eqs.id);
          const row = bookings[eqs.id as string];
          return row ? { data: row, error: null } : { data: null, error: { message: "not found" } };
        }
        return { data: null, error: null };
      };
      const q: any = {
        select: () => q, update: () => q, order: () => q, limit: () => q, in: () => q,
        eq: (c: string, v: unknown) => { eqs[c] = v; return q; },
        insert: async (row: Record<string, unknown>) => { state.inserts.push({ table, row }); return { error: null }; },
        single: async () => resolve(), maybeSingle: async () => resolve(),
        then: (res: (v: unknown) => unknown) => Promise.resolve(resolve()).then(res),
      };
      return q;
    },
    rpc: async () => ({ data: { ok: false, error: "stopped after authorization" }, error: null }),
  };
  return { db, state };
}

function load(fnName: string) {
  const { db, state } = makeDb();
  const auth = sourceExports("supabase/functions/_shared/auth.ts", { [SUPABASE_JS]: { createClient: () => db } }, ENV);
  const tenant = {
    ...sourceExports("supabase/functions/_shared/tenant.ts", { [SUPABASE_JS]: { createClient: () => db }, "./pagination.ts": { fetchAllRows: async () => [] } }, ENV),
    createServiceClient: () => db,
    getTenantByBusinessId: async () => ({ business: { id: "x", name: "Test Operator" } }),
    sendWhatsappTextForTenant: async () => ({}),
    sendWhatsappWithWindowReopen: async () => ({}),
  };
  const mocks: Record<string, unknown> = {
    "../_shared/tenant.ts": tenant,
    "../_shared/auth.ts": auth,
    "../_shared/vouchers.ts": { getPaidPortions: () => ({ cashPaid: 100, voucherPaid: 0 }), reissueVoucherPortion: async () => null },
    "../_shared/combo.ts": { getComboLegPolicy: async () => null, validateComboDates: () => null },
    "../_shared/waiver.ts": { getWaiverContext: async () => ({}) },
    "../_shared/customer-session.ts": { verifyCustomerSession: async () => ({ valid: false }) },
  };
  return { handler: sourceHandler(`supabase/functions/${fnName}/index.ts`, mocks, ENV), state };
}

// Each entry: how to call the function so it stops right after authorization, and what "authorized" looks like.
const FUNCTIONS = [
  { fn: "process-refund", body: (id: string) => ({ booking_id: id, amount: -1 }), authorized: (s: number) => s === 400 },
  { fn: "cancel-booking", body: (id: string) => ({ booking_id: id }), authorized: (s: number) => s === 409 },
  { fn: "manual-mark-paid", body: (id: string) => ({ booking_id: id, action: "mark_paid" }), authorized: (s: number) => ![401, 403, 404].includes(s) },
];

const post = (fnName: string, token: string | null, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request("https://fn.invalid/", { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: "https://admin.bookingtours.co.za", ...headers }, body: JSON.stringify(body) });

describe.each(FUNCTIONS)("$fn authorization", ({ fn, body, authorized }) => {
  it("rejects an unauthenticated caller before looking up any booking", async () => {
    const { handler, state } = load(fn);
    const r = await handler(post(fn, "token-not-a-user", body("bk-a")));
    expect(r.status).toBe(401);
    expect(state.bookingLookups).toEqual([]);
  });

  it("answers a missing booking and another tenant's booking identically", async () => {
    const { handler } = load(fn);
    const missing = await handler(post(fn, "token-admin-a", body("bk-does-not-exist")));
    const otherTenant = await handler(post(fn, "token-admin-a", body("bk-b")));
    expect(missing.status).toBe(404);
    expect(otherTenant.status).toBe(404);
    expect(await otherTenant.text()).toBe(await missing.text());
  });

  it('does not treat a role that merely contains "super" as a super admin', async () => {
    const { handler } = load(fn);
    const r = await handler(post(fn, "token-supervisor-a", body("bk-b")));
    expect(authorized(r.status)).toBe(false); // 404 (not your booking) or 403 (role cannot use this function at all)
    expect([403, 404]).toContain(r.status);
  });

  it("lets an admin act on their own tenant's booking", async () => {
    const { handler } = load(fn);
    expect(authorized((await handler(post(fn, "token-admin-a", body("bk-a")))).status)).toBe(true);
  });

  it("lets a SUPER_ADMIN act across tenants", async () => {
    const { handler } = load(fn);
    expect(authorized((await handler(post(fn, "token-super-admin", body("bk-b")))).status)).toBe(true);
  });

  it.each(["token-demo-a", "token-suspended-a", "token-no-admin-row"])("refuses %s", async (token) => {
    const { handler } = load(fn);
    const r = await handler(post(fn, token, body("bk-a")));
    expect([401, 403]).toContain(r.status);
  });

  it("accepts the service key and writes an audit row naming the function, the caller and the tenant", async () => {
    const { handler, state } = load(fn);
    const r = await handler(post(fn, "service-key-fixture", body("bk-b"), { "x-caller-function": "wa-webhook" }));
    expect(authorized(r.status)).toBe(true);
    const audit = state.inserts.filter((i) => i.table === "logs" && i.row.event === "SERVICE_KEY_CALL");
    expect(audit).toHaveLength(1);
    expect(audit[0].row.business_id).toBe(BIZ_B);
    expect(audit[0].row.payload).toMatchObject({ function: fn, caller: "wa-webhook" });
  });

  it("marks a service-key call with no caller header as unspecified", async () => {
    const { handler, state } = load(fn);
    await handler(post(fn, "service-key-fixture", body("bk-a")));
    expect(state.inserts.find((i) => i.table === "logs")?.row.payload).toMatchObject({ caller: "unspecified" });
  });

  it("does not write a service-key audit row for admin callers", async () => {
    const { handler, state } = load(fn);
    await handler(post(fn, "token-admin-a", body("bk-a")));
    expect(state.inserts.filter((i) => i.row.event === "SERVICE_KEY_CALL")).toEqual([]);
  });

  it.each(["https://evil.example", "http://localhost:3000", "http://127.0.0.1:3001"])("does not echo the preflight origin %s", async (origin) => {
    const { handler } = load(fn);
    const r = await handler(new Request("https://fn.invalid/", { method: "OPTIONS", headers: { origin } }));
    expect(r.headers.get("access-control-allow-origin")).not.toBe(origin);
    expect(r.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("still echoes the production admin origin", async () => {
    const { handler } = load(fn);
    const r = await handler(new Request("https://fn.invalid/", { method: "OPTIONS", headers: { origin: "https://admin.bookingtours.co.za" } }));
    expect(r.headers.get("access-control-allow-origin")).toBe("https://admin.bookingtours.co.za");
  });
});

describe("rebook-booking authorization (customer-facing, so it loads the booking first)", () => {
  // RESCHEDULE without new_slot_id is rejected with 400 right after authorization, so 400 means "authorized".
  const call = (token: string, id = "bk-a", headers: Record<string, string> = {}) => {
    const loaded = load("rebook-booking");
    return loaded.handler(post("rebook-booking", token, { booking_id: id, action: "RESCHEDULE" }, headers)).then((r) => ({ r, state: loaded.state }));
  };

  it("lets an admin of the booking's tenant act", async () => expect((await call("token-admin-a")).r.status).toBe(400));
  it("lets a SUPER_ADMIN act across tenants", async () => expect((await call("token-super-admin", "bk-b")).r.status).toBe(400));

  it('refuses an admin of another tenant, including a role that merely contains "super"', async () => {
    for (const token of ["token-admin-a", "token-supervisor-a"]) {
      const { r } = await call(token, "bk-b");
      expect(r.status, token).toBe(403);
      expect((await r.json()).error).toBe("This booking belongs to a different business.");
    }
  });

  it("refuses a read-only demo admin and a suspended admin", async () => {
    expect((await call("token-demo-a")).r.status).toBe(403);
    expect((await call("token-suspended-a")).r.status).toBe(403); // suspended -> treated as a plain customer -> email does not match
  });

  it("asks an unrecognised bearer token to sign in", async () => expect((await call("token-garbage")).r.status).toBe(401));

  it("accepts the service key and records who called", async () => {
    const { r, state } = await call("service-key-fixture", "bk-b", { "x-caller-function": "web-chat" });
    expect(r.status).toBe(400);
    expect(state.inserts.find((i) => i.row.event === "SERVICE_KEY_CALL")?.row).toMatchObject({ business_id: BIZ_B, payload: { function: "rebook-booking", caller: "web-chat" } });
  });
});

describe("shared auth helpers", () => {
  const load2 = (env: Record<string, string> = {}) => {
    const { db } = makeDb();
    return sourceExports("supabase/functions/_shared/auth.ts", { [SUPABASE_JS]: { createClient: () => db } }, { ...ENV, ...env }) as any;
  };

  it("matches the service key exactly (no prefix, suffix, empty or wrong-length match)", () => {
    const { isServiceKey } = load2();
    expect(isServiceKey("service-key-fixture")).toBe(true);
    for (const bad of ["", "service-key-fixtur", "service-key-fixture!", "SERVICE-KEY-FIXTURE", "x".repeat(500)]) expect(isServiceKey(bad)).toBe(false);
  });

  it("also accepts a key from SUPABASE_SECRET_KEYS", () => {
    const { isServiceKey } = load2({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_fixture_value" }) });
    expect(isServiceKey("sb_secret_fixture_value")).toBe(true);
    expect(isServiceKey("sb_secret_fixture_valu")).toBe(false);
  });

  it("compares keys without early exit", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/_shared/auth.ts", "utf8");
    expect(src).toContain("function safeEqual");
    expect(src).not.toMatch(/serviceKeys\.includes\(/);
  });

  it("canAccessBusiness: exact SUPER_ADMIN only, tenant match otherwise, never an empty business", () => {
    const { canAccessBusiness } = load2();
    const as = (role: string, businessId = BIZ_A) => ({ userId: "u", businessId, role, isServiceRole: false, readOnly: false });
    expect(canAccessBusiness(as("SUPER_ADMIN", ""), BIZ_B)).toBe(true);
    for (const role of ["SUPERVISOR", "super_admin", "SUPER_ADMIN_LITE", "superuser", "NOT_SUPER_ADMIN"]) expect(canAccessBusiness(as(role), BIZ_B), role).toBe(false);
    expect(canAccessBusiness(as("MAIN_ADMIN"), BIZ_A)).toBe(true);
    expect(canAccessBusiness(as("MAIN_ADMIN"), "")).toBe(false);
    expect(canAccessBusiness({ ...as("service_role", ""), isServiceRole: true }, BIZ_B)).toBe(true);
  });

  it("requireAuth reports why it refused, and hands the user to the caller when they are simply not an admin", async () => {
    const { requireAuth } = load2();
    const req = (token?: string) => new Request("https://fn.invalid/", { headers: token ? { authorization: `Bearer ${token}` } : {} });
    await expect(requireAuth(req())).rejects.toMatchObject({ kind: "missing" });
    await expect(requireAuth(req("token-bogus"))).rejects.toMatchObject({ kind: "invalid" });
    await expect(requireAuth(req("token-demo-a"))).rejects.toMatchObject({ kind: "read_only" });
    await expect(requireAuth(req("token-no-admin-row"))).rejects.toMatchObject({ kind: "not_admin", user: { id: "no-admin-row" } });
    expect(await requireAuth(req("token-demo-a"), { allowReadOnly: true } as any)).toMatchObject({ readOnly: true });
  });
});
