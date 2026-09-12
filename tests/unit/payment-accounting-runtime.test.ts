import { describe, expect, it, vi } from "vitest";
import { sourceFunction, sourceHandler } from "../helpers/source-handler";
import { getPaidPortions } from "../../supabase/functions/_shared/vouchers";
import * as voucherBalances from "../../supabase/functions/_shared/voucher-balances";

const serviceKey = "fixture-service-not-a-real-credential";
const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: serviceKey };

function paymentFixture(overrides: Record<string, any> = {}) {
  const booking: any = { id: "booking-a", business_id: "a", slot_id: "slot-a", customer_name: "Fixture guest", qty: 1, status: "HELD", total_amount: 600, original_total: 1000, voucher_amount_paid: 400, total_captured: 600, total_refunded: 0, yoco_checkout_id: "checkout-a", yoco_payment_id: null, ...overrides };
  const calls: any[] = [];
  const operations: any[] = [];
  const db = {
    from(table: string) {
      let patch: any, insert: any;
      const execute = async () => {
        if (patch || insert) calls.push({ table, patch, insert });
        if (table === "bookings") {
          if (patch) Object.assign(booking, patch);
          return { data: { ...booking }, error: null };
        }
        if (table === "holds") return { data: [], error: null };
        if (table === "refund_operations") return { data: operations, error: null };
        if (table === "slots") return { data: { id: "slot-a", status: "OPEN" }, error: null };
        if (table === "vouchers") return { data: null, error: null }; // not a gift-voucher checkout
        if (table === "voucher_reservations") return { data: [], error: null };
        // Confirmation was already sent: this suite isolates accounting, not delivery.
        if (table === "logs" || table === "idempotency_keys") return { data: { id: "fixture-log" }, error: null };
        if (table === "conversations") return { data: [], error: null };
        throw new Error("Unexpected financial fixture table: " + table);
      };
      const q: any = {
        select: () => q, eq: () => q, is: () => q, limit: () => q,
        insert: (value: any) => { insert = value; return q; }, update: (value: any) => { patch = value; return q; },
        maybeSingle: execute, single: execute, then: (yes: any, no: any) => execute().then(yes, no),
      };
      return q;
    },
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "reserve_refund_request") {
        const op = { id:"refund-op", request_id:"request-a", booking_id:booking.id, source_business_id:"a", checkout_id:"checkout-a", amount:args.p_amount, status:"PENDING", keep_booking:args.p_keep_booking };
        operations.push(op); booking.total_refunded += args.p_amount; booking.refund_request_id="request-a"; booking.refund_status="REFUND_PENDING";
        if (!args.p_keep_booking) booking.status="CANCELLED";
        return {data:{ok:true,request_id:"request-a",operations},error:null};
      }
      if (name === "finish_refund_operation") {
        const op=operations.find(o=>o.id===args.p_operation_id);
        if(op.status === "PENDING") { op.status=args.p_status; if(args.p_status === "FAILED") booking.total_refunded-=op.amount; }
        return {data:{ok:true},error:null};
      }
      if (name === "cancel_booking_transaction") { booking.status="CANCELLED"; return {data:{ok:true},error:null}; }
      // R11 lease: first claim succeeds; financial completion is atomic.
      if (name === "claim_yoco_payment") return { data: args.p_key.startsWith("refund_notice:") ? "duplicate" : "claimed", error: null };
      if (name === "finish_yoco_payment") return { data: null, error: null };
      // R12/R14/R15: single-writer confirmation reconciles the immutable
      // expected charge, settles reservations, converts capacity.
      if (name === "confirm_booking_payment") {
        booking.status = "PAID";
        booking.yoco_payment_id = "payment-a";
        booking.total_captured = args.p_captured_cents / 100;
        booking.payment_status = "CAPTURED";
        return { data: { ok: true, captured_cents: args.p_captured_cents }, error: null };
      }
      if (name === "release_voucher_reservations") return { data: null, error: null };
      return { data: true, error: null };
    },
  };
  const tenant = {
    createServiceClient: () => db,
    getTenantByBusinessId: async (_db: any, id: string) => {
      expect(id).toBe("a");
      return { business: { id, name: "A" }, credentials: { activeYocoWebhookSecret: "fixture-signature-key", activeYocoSecretKey: "fixture-yoco-key" } };
    },
    getBusinessDisplayName: () => "A", getAdminAppOrigins: () => ["https://fixture.invalid"], isAllowedOrigin: () => true,
  };
  const reissueVoucherPortion = vi.fn(async () => booking.voucher_amount_paid > 0 ? { code: "FIXTURE1", amount: booking.voucher_amount_paid } : null);
  const gateway = vi.fn<typeof fetch>(async () => Response.json({ status: "successful", refundId: "refund-fixture" }));
  const mocks = {
    "../_shared/voucher-balances.ts": voucherBalances,
    "../_shared/tenant.ts": tenant,
    "../_shared/vouchers.ts": { getPaidPortions, reissueVoucherPortion },
    "../_shared/combo.ts": { getComboLegPolicy: async () => null }, "../_shared/waiver.ts": {},
    "../_shared/sentry.ts": { withSentry: (_name: string, fn: any) => fn },
    "npm:standardwebhooks": { Webhook: class { verify(_raw: string, headers: any) { if (headers["webhook-signature"] !== "fixture-verified") throw new Error("Invalid fixture signature"); } } },
  };
  const webhook = sourceHandler("supabase/functions/yoco-webhook/index.ts", mocks, env, gateway);
  const refund = sourceHandler("supabase/functions/process-refund/index.ts", mocks, env, gateway);
  return {
    booking, calls, gateway, reissueVoucherPortion,
    webhook: (amount: any, metadata: any = {}) => webhook(new Request("https://fixture.invalid/yoco", {
      method: "POST", headers: { "webhook-signature": "fixture-verified" },
      body: JSON.stringify({ type: "payment.succeeded", payload: { id: "payment-a", amount, currency: "ZAR", metadata: { checkoutId: "checkout-a", type: "BOOKING", ...metadata } } }),
    })),
    refund: (amount?: number) => refund(new Request("https://fixture.invalid/refund", { method: "POST", headers: { authorization: "Bearer " + serviceKey }, body: JSON.stringify({ booking_id: booking.id, ...(amount !== undefined ? { amount } : {}) }) })),
  };
}

describe("R13 real handler cash/voucher accounting", () => {
  it.each([0, null, undefined])("never infers refundable cash from the ticket price when capture is %s", async captured => {
    const f = paymentFixture({ total_captured: captured, payment_status: "CAPTURED" });
    expect((await f.refund()).status).toBe(409);
    expect(f.gateway).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
    expect(f.reissueVoucherPortion).not.toHaveBeenCalled();
  });
  it.each([[600, 400], [600.25, 400.50], [100, 900], [1000, 0]])("records R%s captured independently of R%s voucher funding", async (cash, voucher) => {
    const f = paymentFixture({ total_amount: cash, voucher_amount_paid: voucher, original_total: cash + voucher });
    expect((await f.webhook(Math.round(cash * 100), { amount_zar: 9999 })).status).toBe(200);
    expect(f.booking.status).toBe("PAID");
    expect(f.booking.total_captured).toBe(cash);
  });

  it.each([0, -100, 100.5, null, "invalid"])("rejects malformed successful capture %s before claiming or writing payment state", async (amount) => {
    const f = paymentFixture();
    expect((await f.webhook(amount)).status).toBe(400);
    expect(f.calls).toEqual([]);
    expect(f.booking.status).toBe("HELD");
  });

  it.each([
    [{}, 600],
    [{ total_refunded: 100 }, 500],
    [{ total_amount: 100, total_captured: 100, voucher_amount_paid: 900 }, 100],
    [{ total_amount: 1000, total_captured: 1000 }, 600], // legacy voucher-inclusive total
    [{ total_amount: 600.25, total_captured: 600.25, voucher_amount_paid: 399.75 }, 600.25],
    [{ total_captured: 200 }, 200], // never guess away an already-recorded lower capture
  ])("refunds the cash remainder without subtracting the voucher twice: %s", async (overrides, expected) => {
    const f = paymentFixture({ payment_status: "CAPTURED", ...overrides });
    const response = await f.refund();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, amount: expected });
    expect(f.calls.find(c => c.name === "reserve_refund_request").args.p_amount).toBe(expected);
    expect(JSON.parse(String(f.gateway.mock.calls[0][1]?.body))).toMatchObject({ amount: Math.round(expected * 100) });
    expect(f.reissueVoucherPortion).toHaveBeenCalledOnce();
  });

  it("fully voucher-funded refunds reissue the voucher without a gateway call", async () => {
    const f = paymentFixture({ total_amount: 0, total_captured: 0, voucher_amount_paid: 1000, payment_status:"CAPTURED" });
    expect(await (await f.refund()).json()).toMatchObject({ amount: 0, voucher_amount: 1000, channel: "voucher" });
    expect(f.gateway).not.toHaveBeenCalled();
    expect(f.calls.some(c => c.name === "reserve_refund_request")).toBe(false);
  });

  it.each([0, -1, "not-a-number"])("rejects invalid refund amount %s without reserving or calling the gateway", async amount => {
    const f = paymentFixture();
    expect((await f.refund(amount as number)).status).toBe(400);
    expect(f.gateway).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });

  it("accepts Yoco's documented succeeded refund response without releasing successful cash", async () => {
    const f = paymentFixture({payment_status:"CAPTURED"});
    f.gateway.mockResolvedValueOnce(Response.json({ status: "succeeded", refundId: "refund-fixture" }));
    expect(await (await f.refund()).json()).toMatchObject({ ok: true, amount: 600 });
    expect(f.booking.refund_status).toBe("REFUNDED");
    expect(f.calls.some(c => c.name === "release_refund_reservation")).toBe(false);
  });
  it("keeps an uncertain refund reserved and retries the identical provider operation", async () => {
    const f=paymentFixture({payment_status:"CAPTURED"});
    f.gateway.mockRejectedValueOnce(new Error("response lost"));
    expect((await f.refund()).status).toBe(202);
    expect(f.booking.total_refunded).toBe(600);
    expect(await (await f.refund()).json()).toMatchObject({ok:true,amount:600});
    expect(f.calls.filter(c=>c.name==="reserve_refund_request")).toHaveLength(1);
    const requests=f.gateway.mock.calls.map(c=>c[1]);
    expect(requests[0]?.body).toBe(requests[1]?.body);
    expect(new Headers(requests[0]?.headers).get("Idempotency-Key")).toBe(new Headers(requests[1]?.headers).get("Idempotency-Key"));
  });

});

describe("R13 customer cancellation branching", () => {
  const file = "supabase/functions/rebook-booking/index.ts";
  const bindings = { getPaidPortions };
  const voucher = sourceFunction(file, "isVoucherPayment", bindings);
  const split = sourceFunction(file, "isSplitTenderPayment", bindings);
  const portions = sourceFunction(file, "getSplitTenderAmounts", bindings);
  it.each([[600, 400], [100, 900], [400, 400]])("R%s cash plus R%s voucher still takes the split-refund path", (cash, credit) => {
    const booking = { total_amount: cash, voucher_amount_paid: credit, original_total: cash + credit };
    expect(voucher(booking)).toBe(false);
    expect(split(booking)).toBe(true);
    expect(portions(booking)).toEqual({ cashPortion: cash, voucherPortion: credit });
  });
  it("a fully voucher-funded cancellation uses the voucher's value, not zero cash due", async () => {
    const booking = { total_amount: 0, voucher_amount_paid: 400, original_total: 400 };
    const handler = vi.fn();
    await sourceFunction(file, "handleCancelRefund", { getPaidPortions, isVoucherPayment: voucher, handleCancelRefundVoucher: handler })({}, booking);
    expect(handler).toHaveBeenCalledWith({}, booking, 400);
  });
  it("legacy inclusive totals still split using original_total", () => {
    expect(portions({ total_amount: 1000, voucher_amount_paid: 400, original_total: 1000 })).toEqual({ cashPortion: 600, voucherPortion: 400 });
  });
});
