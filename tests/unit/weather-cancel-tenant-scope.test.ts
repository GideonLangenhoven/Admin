import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

// Section 5 re-verify: a weather cancellation only reads and writes the
// caller's tenant, and a tenant admin cannot cancel another tenant's trips.
function fixture(auth: Record<string, unknown>) {
  const calls: { table: string; ops: unknown[][] }[] = [];
  const rpc = vi.fn(async () => ({ data: { ok: true, refund_amount: 0 }, error: null }));
  const from = (table: string) => {
    const ops: unknown[][] = [];
    calls.push({ table, ops });
    const chain: any = {};
    for (const name of ["select", "update", "insert", "eq", "in", "not"]) chain[name] = (...args: unknown[]) => { ops.push([name, ...args]); return chain; };
    chain.then = (resolve: any) => resolve({ data: table === "bookings" ? [{ id: "10000000-0000-4000-8000-000000000001", status: "PAID", slot_id: "slot-a" }] : null, error: null });
    return chain;
  };
  const handler = sourceHandler("supabase/functions/weather-cancel/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => ({ from, rpc }), getTenantByBusinessId: async (_db: unknown, id: string) => ({ business: { id } }),
      getBusinessDisplayName: () => "Synthetic operator", sendWhatsappWithWindowReopen: vi.fn(), resolveManageBookingsUrl: () => "",
      getAdminAppOrigins: () => ["https://synthetic.invalid"], isAllowedOrigin: () => true, formatTenantDateTime: () => "",
    },
    "../_shared/auth.ts": { requireAuth: async () => auth },
  }, { SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" }, async () => Response.json({ ok: true }));
  const post = (body: object) => handler(new Request("https://synthetic.invalid/weather-cancel", {
    method: "POST", body: JSON.stringify({ slot_ids: ["slot-a"], log_broadcast: true, ...body }),
  }));
  return { calls, rpc, post };
}

describe("weather cancellation tenant scope", () => {
  it("refuses a tenant admin acting on another tenant, before touching data", async () => {
    const f = fixture({ role: "MAIN_ADMIN", businessId: "tenant-b" });
    expect((await f.post({ business_id: "tenant-a" })).status).toBe(403);
    expect(f.calls).toEqual([]);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("scopes every query, write and cancel to the caller's business", async () => {
    const f = fixture({ role: "MAIN_ADMIN", businessId: "tenant-a" });
    expect((await f.post({})).status).toBe(200);
    expect(f.calls.map(c => c.table)).toEqual(["slots", "bookings", "logs", "broadcasts"]);
    for (const { table, ops } of f.calls) {
      const scoped = ops.some(([op, a, b]) => op === "eq" ? a === "business_id" && b === "tenant-a" : op === "insert" && (a as any).business_id === "tenant-a");
      expect(scoped, table).toBe(true);
    }
    expect(f.rpc).toHaveBeenCalledWith("cancel_booking_transaction", expect.objectContaining({ p_business_id: "tenant-a" }));
  });
});
