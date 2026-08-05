import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reissueVoucherPortion } from "../../supabase/functions/_shared/vouchers.ts";

// Reported live: a split-tender booking cancelled by the operator refunded the
// policy percentage of the CASH and silently dropped the voucher portion.
// process-refund even capped the cash at (total - voucher) with an error text
// saying the voucher "must be reissued" — but no code on that path ever
// reissued it. The rule now lives in _shared/vouchers.ts and process-refund
// (the funnel for admin refunds, batch-refund, yoco-webhook auto-cancels)
// calls it on every refund; converted_to_voucher_id makes it a no-op for the
// flows that already reissue (rebook-booking cancel handlers, CLAIM_CREDIT).

// Minimal chainable/thenable supabase stub: every builder method returns the
// chain; awaiting it resolves with the queued result for that table+verb.
function stubClient(results: Record<string, any>, calls: any[] = []) {
  function chain(key: string, payload: any) {
    const c: any = {
      _key: key, _payload: payload,
      select: () => c, single: () => c, eq: () => c, is: () => c,
      then: (res: any) => res(results[key] ?? { data: null, error: null }),
    };
    return c;
  }
  return {
    calls,
    from(table: string) {
      return {
        insert: (p: any) => { calls.push({ table, verb: "insert", p }); return chain(table + ".insert", p); },
        update: (p: any) => { calls.push({ table, verb: "update", p }); return chain(table + ".update", p); },
      };
    },
  };
}

describe("reissueVoucherPortion", () => {
  const booking = { id: "b1", business_id: "biz1", voucher_amount_paid: 500, converted_to_voucher_id: null };

  it("creates a CREDIT voucher for the voucher portion and stamps the booking", async () => {
    const sb = stubClient({
      "vouchers.insert": { data: { id: "v1", code: "ABCD2345" }, error: null },
      "bookings.update": { data: [{ id: "b1" }], error: null },
    });
    const out = await reissueVoucherPortion(sb, booking);
    expect(out).toEqual({ code: "ABCD2345", amount: 500 });
    const ins = sb.calls.find(c => c.table === "vouchers" && c.verb === "insert")!.p;
    expect(ins.type).toBe("CREDIT");
    expect(ins.value).toBe(500);
    expect(ins.current_balance).toBe(500);
    expect(ins.source_booking_id).toBe("b1");
    expect(sb.calls.some(c => c.table === "bookings" && c.verb === "update" && c.p.converted_to_voucher_id === "v1")).toBe(true);
  });

  it("does nothing when there is no voucher portion", async () => {
    const sb = stubClient({});
    expect(await reissueVoucherPortion(sb, { ...booking, voucher_amount_paid: 0 })).toBeNull();
    expect(sb.calls.length).toBe(0);
  });

  it("does nothing when a voucher was already issued for this booking", async () => {
    const sb = stubClient({});
    expect(await reissueVoucherPortion(sb, { ...booking, converted_to_voucher_id: "v-old" })).toBeNull();
    expect(sb.calls.length).toBe(0);
  });

  it("voids its voucher when another flow stamped the booking first", async () => {
    const sb = stubClient({
      "vouchers.insert": { data: { id: "v2", code: "ZZZZ9999" }, error: null },
      "bookings.update": { data: [], error: null }, // race lost: 0 rows stamped
    });
    expect(await reissueVoucherPortion(sb, booking)).toBeNull();
    const voided = sb.calls.find(c => c.table === "vouchers" && c.verb === "update");
    expect(voided?.p.status).toBe("VOID");
  });
});

describe("process-refund reissues on every cancellation path it owns", () => {
  const PR = readFileSync("supabase/functions/process-refund/index.ts", "utf8");

  it("imports the shared rule and calls it on the cash-refund success path", () => {
    expect(PR).toContain('from "../_shared/vouchers.ts"');
    expect(PR.match(/reissueVoucherPortion\(supabase, booking\)/g)?.length).toBe(2); // voucher-only branch + success path
  });

  it("voucher-only bookings get a reissue instead of a dead-end error", () => {
    expect(PR).toContain("maxCashRefund <= 0 && voucherPaid > 0");
    expect(PR).toContain('channel: "voucher"');
  });

  it("the customer is told about the reissued voucher", () => {
    expect(PR).toContain("reissued as voucher ");
    expect(PR).toContain("voucher_code: reissued.code");
  });
});
