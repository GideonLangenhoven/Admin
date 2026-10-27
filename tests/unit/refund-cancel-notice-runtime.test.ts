import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";
import { getPaidPortions } from "../../supabase/functions/_shared/vouchers";

// H2: refund & cancel runs in process-refund. Every guest-visible change sends
// exactly one email and adds one Activity Timeline entry, even when the
// operator retries or the provider confirms later.
const serviceKey = "fixture-service-not-a-real-credential";
const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: serviceKey };

function refundFixture(overrides: Record<string, any> = {}, yocoStatus = "succeeded") {
  const booking: any = {
    id: "booking-a", business_id: "a", status: "PAID", payment_status: "CAPTURED", qty: 3, total_amount: 300, original_total: 300,
    voucher_amount_paid: 0, total_captured: 300, total_refunded: 0, yoco_checkout_id: "checkout-a", yoco_mode: "live",
    email: "guest@example.invalid", customer_name: "Fixture guest", tours: { name: "Harbour paddle" }, slots: { start_time: "2026-10-31T06:00:00Z" },
    ...overrides,
  };
  const operations: any[] = [];
  const keys = new Map<string, string>(); // idempotency_keys
  const logs: any[] = [];
  const emails: any[] = [];
  const db = {
    from(table: string) {
      let insert: any, patch: any, key: string | undefined;
      const execute = async () => {
        if (table === "bookings") { if (patch) Object.assign(booking, patch); return { data: { ...booking }, error: null }; }
        if (table === "holds") return { data: [], error: null };
        if (table === "refund_operations") return { data: operations, error: null };
        if (table === "logs") { logs.push(insert); return { data: null, error: null }; }
        if (table === "idempotency_keys") return { data: key && keys.has(key) ? { status: keys.get(key) } : null, error: null };
        throw new Error("Unexpected table: " + table);
      };
      const q: any = {
        select: () => q, eq: (column: string, value: string) => { if (column === "key") key = value; return q; },
        insert: (value: any) => { insert = value; return q; }, update: (value: any) => { patch = value; return q; },
        single: execute, maybeSingle: execute, then: (yes: any, no: any) => execute().then(yes, no),
      };
      return q;
    },
    rpc: async (name: string, args: any) => {
      if (name === "reserve_refund_request") {
        const source = args.p_sources[0];
        operations.push({ id: "op-a", request_id: "request-a", booking_id: booking.id, source_business_id: "a", checkout_id: source.checkout_id, mode: source.mode, amount: args.p_amount, status: "PENDING", keep_booking: args.p_keep_booking });
        Object.assign(booking, { refund_request_id: "request-a", refund_status: "REFUND_PENDING", total_refunded: args.p_amount });
        if (!args.p_keep_booking) booking.status = "CANCELLED";
        return { data: { ok: true, request_id: "request-a", operations }, error: null };
      }
      if (name === "finish_refund_operation") {
        const op = operations.find(o => o.id === args.p_operation_id);
        if (op.status === "PENDING") op.status = args.p_status;
        booking.refund_status = op.status === "PENDING" ? "REFUND_PENDING" : "REFUNDED";
        return { data: { ok: true }, error: null };
      }
      if (name === "claim_yoco_payment") {
        if (keys.get(args.p_key) === "completed") return { data: "duplicate", error: null };
        keys.set(args.p_key, "processing");
        return { data: "claimed", error: null };
      }
      if (name === "finish_yoco_payment") { keys.set(args.p_key, args.p_ok ? "completed" : "failed"); return { data: null, error: null }; }
      throw new Error("Unexpected rpc: " + name);
    },
  };
  const provider = { status: yocoStatus };
  const gateway = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === env.SUPABASE_URL + "/functions/v1/send-email") { emails.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }); }
    if (url.startsWith("https://payments.yoco.com/")) return Response.json({ status: provider.status, refundId: "refund-a" });
    throw new Error("Unexpected fetch: " + url);
  });
  const handler = sourceHandler("supabase/functions/process-refund/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => db,
      getTenantByBusinessId: async () => ({ business: { id: "a" }, credentials: { yocoSecretKey: "fixture-yoco-key", activeYocoSecretKey: "fixture-yoco-key" } }),
      sendWhatsappTextForTenant: async () => undefined,
      getAdminAppOrigins: () => ["https://fixture.invalid"], isAllowedOrigin: () => true,
    },
    "../_shared/vouchers.ts": { getPaidPortions, reissueVoucherPortion: async () => null },
    "../_shared/combo.ts": { getComboLegPolicy: async () => null },
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: any) => fn },
  }, env, gateway);
  const refund = async (body: Record<string, unknown> = {}) => {
    const response = await handler(new Request("https://fixture.invalid/refund", {
      method: "POST", headers: { authorization: "Bearer " + serviceKey }, body: JSON.stringify({ booking_id: booking.id, amount: 300, ...body }),
    }));
    return { status: response.status, body: await response.json() };
  };
  const yocoCalls = () => gateway.mock.calls.filter(([url]) => String(url).startsWith("https://payments.yoco.com/")).length;
  return { booking, logs, emails, refund, provider, yocoCalls, events: () => logs.map(l => l.event) };
}

describe("H2 refund & cancel tells the guest exactly once", () => {
  it("a confirmed card refund cancels the booking and sends one cancellation email with the refund", async () => {
    const f = refundFixture();
    expect(await f.refund()).toMatchObject({ status: 200, body: { ok: true, refund_status: "REFUNDED", amount: 300 } });
    expect(f.booking.status).toBe("CANCELLED");
    expect(f.emails).toHaveLength(1);
    expect(f.emails[0]).toMatchObject({ type: "CANCELLATION", data: { booking_id: "booking-a", business_id: "a", refund_amount: "300.00" } });
    expect(f.events()).toEqual(["refund_completed"]);
    expect(f.logs[0]).toMatchObject({ business_id: "a", booking_id: "booking-a" });

    await f.refund(); // operator retries
    expect(f.emails).toHaveLength(1);
    expect(f.events()).toEqual(["refund_completed"]);
  });

  it("a refund the provider has not confirmed tells the guest now, then only the refund update once it lands", async () => {
    const f = refundFixture({}, "pending");
    expect(await f.refund()).toMatchObject({ status: 202, body: { refund_status: "REFUND_PENDING" } });
    expect(f.booking.status).toBe("CANCELLED");
    expect(f.emails.map(e => e.type)).toEqual(["CANCELLATION"]);
    expect(f.emails[0].data.refund_amount).toBe("300.00");
    expect(f.events()).toEqual(["refund_pending"]);

    expect((await f.refund()).status).toBe(202); // still pending on retry
    expect(f.emails).toHaveLength(1);

    f.provider.status = "succeeded";
    expect(await f.refund({ resume_refund: true })).toMatchObject({ status: 200, body: { refund_status: "REFUNDED" } });
    expect(f.emails.map(e => e.type)).toEqual(["CANCELLATION", "BOOKING_UPDATED"]);
    expect(f.emails[1].data.message).toMatch(/^Your refund of R300\.00 has been processed/);
    expect(f.events()).toEqual(["refund_pending", "refund_completed"]);
    expect(f.yocoCalls()).toBe(3); // one provider operation, retried with the same idempotency key
  });

  it("a cash booking becomes a bank-transfer task: no provider call, guest told once, refund update when paid", async () => {
    const f = refundFixture({ yoco_checkout_id: null, payment_method: "CASH" });
    expect(await f.refund()).toMatchObject({ status: 200, body: { pending: true, refund_status: "MANUAL_EFT_REQUIRED" } });
    expect(f.booking.status).toBe("CANCELLED");
    expect(f.emails.map(e => [e.type, e.data.refund_amount])).toEqual([["CANCELLATION", "300.00"]]);
    expect(f.events()).toEqual(["refund_bank_transfer_required"]);

    await f.refund(); // reopening the refund does not repeat the email
    expect(f.emails).toHaveLength(1);

    expect(await f.refund({ action: "confirm_manual" })).toMatchObject({ status: 200, body: { refund_status: "REFUNDED" } });
    expect(f.emails.map(e => e.type)).toEqual(["CANCELLATION", "BOOKING_UPDATED"]);
    expect(f.events()).toEqual(["refund_bank_transfer_required", "refund_completed"]);
    expect(f.yocoCalls()).toBe(0);
  });

  it("a partial refund that keeps the booking sends a refund update, never a cancellation", async () => {
    const f = refundFixture();
    expect((await f.refund({ amount: 100, keep_booking: true })).status).toBe(200);
    expect(f.booking.status).toBe("PAID");
    expect(f.emails.map(e => e.type)).toEqual(["BOOKING_UPDATED"]);
    expect(f.emails[0].data.message).toMatch(/^Your refund of R100\.00 has been processed/);
    expect(f.events()).toEqual(["refund_completed"]);
  });
});
