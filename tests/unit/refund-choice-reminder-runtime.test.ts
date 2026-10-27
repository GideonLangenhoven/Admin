import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";
import { fetchAllRows } from "../../supabase/functions/_shared/pagination";

// H7: a weather/operator cancellation parks the paid amount until the guest
// chooses refund, voucher or new date. The options email is resent by the
// operator from Refunds, and once automatically after three days.
const serviceKey = "fixture-service-not-a-real-credential";
const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: serviceKey };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const waiting = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, business_id: "a", status: "CANCELLED", refund_status: "ACTION_REQUIRED", refund_amount: 1500, converted_to_voucher_id: null,
  cancellation_self_service: true, cancellation_reason: "Weather cancellation: strong wind", customer_name: "Fixture guest",
  email: id + "@example.invalid", phone: null, cancelled_at: daysAgo(4), tours: { name: "Harbour paddle" }, slots: { start_time: "2026-10-31T06:00:00Z" },
  ...overrides,
});

function fixture() {
  const bookings = [
    waiting("weather-4-days"),
    waiting("weather-1-day", { cancelled_at: daysAgo(1) }),
    waiting("operator-handles", { cancellation_self_service: false, cancellation_reason: "Weather cancellation: storm" }),
    waiting("already-claimed", { refund_status: "REQUESTED" }),
    waiting("tenant-b", { business_id: "b", cancellation_reason: "Cancelled by operator: boat repairs" }),
  ];
  const claimed = new Set<string>();
  const logs: any[] = [];
  const emails: any[] = [];
  const db = {
    from(table: string) {
      const filters: [string, string, unknown][] = [];
      let upsert: any, insert: any;
      const rows = () => table === "businesses" ? [{ id: "a" }, { id: "b" }] : table !== "bookings" ? [] : bookings.filter((b: any) =>
        filters.every(([op, column, value]) => op === "eq" ? b[column] === value : op === "is" ? (b[column] ?? null) === value
          : op === "not null" ? b[column] != null : String(b[column]) < String(value)));
      const execute = async () => {
        if (table === "auto_messages") {
          const key = upsert.booking_id + "|" + upsert.type;
          if (claimed.has(key)) return { data: [], error: null };
          claimed.add(key);
          return { data: [{ id: key }], error: null };
        }
        if (table === "logs") { logs.push(insert); return { data: null, error: null }; }
        return { data: rows(), error: null };
      };
      const q: any = {
        select: () => q, order: () => q, range: () => q,
        eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q), is: (c: string, v: unknown) => (filters.push(["is", c, v]), q),
        not: (c: string) => (filters.push(["not null", c, null]), q), lt: (c: string, v: unknown) => (filters.push(["lt", c, v]), q),
        upsert: (v: any) => (upsert = v, q), insert: (v: any) => (insert = v, q),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (yes: any, no: any) => execute().then(yes, no),
      };
      return q;
    },
  };
  const gateway = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === env.SUPABASE_URL + "/functions/v1/send-email") { emails.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }); }
    throw new Error("Unexpected fetch: " + input);
  });
  const handler = sourceHandler("supabase/functions/auto-messages/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => db, fetchAllRows, formatTenantDateTime: () => "Fri 31 Oct, 08:00",
      getBusinessDisplayName: () => "Fixture Tours", getTenantByBusinessId: async (_db: unknown, id: string) => ({ business: { id }, credentials: {} }),
      resolveManageBookingsUrl: () => "https://fixture.invalid/my-bookings", sendWhatsappTextForTenant: async () => undefined,
    },
    "../_shared/waiver.ts": { resolveWaiverLink: () => null },
    "../_shared/auth.ts": {
      requireAuth: async (req: Request) => req.headers.get("authorization") === "Bearer " + serviceKey
        ? { isServiceRole: true } : { role: "MAIN_ADMIN", businessId: "a", userId: "admin-a" },
      canAccessBusiness: () => true,
    },
  }, env, gateway);
  const call = async (body: Record<string, unknown>, token = serviceKey) => {
    const res = await handler(new Request("https://fixture.invalid/auto-messages", { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { call, emails, logs };
}

describe("refund choice reminders", () => {
  it("resends the options email once, after three days, only where the guest can choose", async () => {
    const f = fixture();
    expect((await f.call({ action: "refund_choice_reminders" })).body.results.refund_choice_reminders).toBe(2);
    expect(f.emails.map(e => [e.type, e.data.email, e.data.offer_choice, e.data.is_weather, e.data.reason, e.data.total_amount])).toEqual([
      ["CANCELLATION", "weather-4-days@example.invalid", true, true, "strong wind", 1500],
      ["CANCELLATION", "tenant-b@example.invalid", true, false, "boat repairs", 1500],
    ]);
    expect(f.logs.map(l => [l.booking_id, l.event, l.payload.source])).toEqual([
      ["weather-4-days", "refund_choice_reminder_sent", "automatic"], ["tenant-b", "refund_choice_reminder_sent", "automatic"],
    ]);
    // The cron runs every few minutes: no second automatic reminder.
    expect((await f.call({ action: "all" })).body.results.refund_choice_reminders).toBe(0);
    expect(f.emails).toHaveLength(2);
  });

  it("lets the operator resend for their own tenant's waiting bookings, with a reason when it can't", async () => {
    const f = fixture();
    expect(await f.call({ action: "refund_choice_reminder_one", booking_id: "weather-1-day" }, "admin-a")).toEqual({ status: 200, body: { ok: true } });
    expect(f.emails.map(e => e.data.email)).toEqual(["weather-1-day@example.invalid"]);
    expect(f.logs.map(l => l.payload.source)).toEqual(["operator"]);
    expect(await f.call({ action: "refund_choice_reminder_one", booking_id: "operator-handles" }, "admin-a")).toEqual({ status: 400, body: { ok: false, error: "The guest was told you will handle this one, so there are no options to resend." } });
    expect(await f.call({ action: "refund_choice_reminder_one", booking_id: "already-claimed" }, "admin-a")).toEqual({ status: 400, body: { ok: false, error: "This booking is no longer waiting for the guest to choose." } });
    expect(await f.call({ action: "refund_choice_reminder_one", booking_id: "tenant-b" }, "admin-a")).toEqual({ status: 400, body: { ok: false, error: "Booking not found" } });
    expect(f.emails).toHaveLength(1);
  });
});
