import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";
import * as voucherBalances from "../../supabase/functions/_shared/voucher-balances";

const serviceKey = "fixture-service-not-a-real-key";
const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: serviceKey };

// R11/R12/R14/R15: lease-gated, reconciled, reservation-settling confirmation.
function webhookFixture(claim: string, confirm: any) {
  const booking: any = { id: "booking-a", business_id: "a", slot_id: "slot-a", qty: 2, status: "HELD", total_amount: 600, expected_amount_cents: 60000, expected_currency: "ZAR", yoco_payment_id: null, yoco_checkout_id: "checkout-a", email: "guest@fixture.invalid", phone: "27820000000" };
  const calls: any[] = [];
  const db = {
    from(table: string) {
      const q: any = {};
      q.select = () => q; q.eq = () => q; q.is = () => q; q.limit = () => q;
      q.single = async () => ({ data: { status: "OPEN" }, error: null });
      q.maybeSingle = async () => ({ data: null, error: null });
      q.update = (patch: any) => {
        if (table === "bookings") Object.assign(booking, patch);
        const terminal: any = { then: (yes: any) => yes({ data: null, error: null }) };
        terminal.eq = () => terminal; terminal.select = () => terminal; terminal.maybeSingle = async () => ({ data: null, error: null });
        return terminal;
      };
      q.insert = () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "log" }, error: null }) }) });
      if (table === "bookings") {
        const origMaybe = q.maybeSingle;
        q.maybeSingle = async () => { calls.push({ table }); return { data: { ...booking }, error: null }; };
      }
      if (table === "holds") {
        q.maybeSingle = async () => ({ data: { id: "hold-a", status: "ACTIVE" }, error: null });
      }
      return q;
    },
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "claim_yoco_payment") return { data: claim, error: null };
      if (name === "finish_yoco_payment") return { data: null, error: null };
      if (name === "confirm_booking_payment") {
        if (confirm instanceof Error) throw confirm;
        return { data: confirm, error: null };
      }
      if (name === "release_voucher_reservations") return { data: null, error: null };
      if (name === "slot_has_capacity") return { data: true, error: null };
      return { data: null, error: null };
    },
  };
  const mocks = {
    "../_shared/voucher-balances.ts": voucherBalances,
    "../_shared/tenant.ts": {
      createServiceClient: () => db,
      getTenantByBusinessId: async () => ({ business: { id: "a" }, credentials: { activeYocoWebhookSecret: "k", activeYocoSecretKey: "k" } }),
      getBusinessDisplayName: () => "A", formatTenantDate: () => "", formatTenantDateTime: () => "",
      sendWhatsappTextForTenant: async () => ({}), sendWhatsappFreeformOrSignal: async () => ({}),
    },
    "../_shared/waiver.ts": { getWaiverContext: async () => ({}) },
    "../_shared/combo.ts": { confirmComboAndNotify: async () => ({ ok: true }), releaseFailedCombo: async () => ({}) },
    "../_shared/sentry.ts": { withSentry: (_n: string, fn: any) => fn },
    "npm:standardwebhooks": { Webhook: class { async verify() {} } },
  };
  const fetchImpl: typeof fetch = async () => Response.json({});
  const handler = sourceHandler("supabase/functions/yoco-webhook/index.ts", mocks, env, fetchImpl);
  const post = (amount: number) => handler(new Request("https://fixture.invalid/yoco", {
    method: "POST", headers: { "webhook-signature": "x" },
    body: JSON.stringify({ type: "payment.succeeded", payload: { id: "payment-a", amount, currency: "ZAR", metadata: { checkoutId: "checkout-a", type: "BOOKING", booking_id: "booking-a" } } }),
  }));
  return { booking, calls, post };
}

describe("R11 webhook processing lease", () => {
  it("replays of completed payments ACK without touching booking state", async () => {
    const f = webhookFixture("duplicate", null);
    expect((await f.post(60000)).status).toBe(200);
    expect(f.calls.some(c => c.name === "confirm_booking_payment")).toBe(false);
  });

  it("defers while another worker holds the lease instead of double-confirming", async () => {
    const f = webhookFixture("in_progress", null);
    expect((await f.post(60000)).status).toBe(503);
    expect(f.calls.some(c => c.name === "confirm_booking_payment")).toBe(false);
  });

  it("releases a failed lease and requests redelivery after an unexpected database exception", async () => {
    const f = webhookFixture("claimed", new Error("connection interrupted"));
    expect((await f.post(60000)).status).toBe(503);
    expect(f.calls.some(c => c.name === "finish_yoco_payment" && c.args.p_ok === false)).toBe(true);
    expect(f.booking.status).toBe("HELD");
  });
});

describe("R12 strict amount reconciliation", () => {
  it("quarantines underpayments for review instead of marking PAID", async () => {
    const f = webhookFixture("claimed", { ok: false, error: "amount_mismatch", expected_cents: 60000 });
    expect((await f.post(100)).status).toBe(200);
    expect(f.booking.status).toBe("PENDING PAYMENT");
    expect(f.booking.payment_status).toBe("MISMATCH_QUARANTINE");
    expect(f.calls.some(c => c.name === "release_voucher_reservations")).toBe(true);
  });

  it("quarantines voucher shortfalls without confirming the booking", async () => {
    const f = webhookFixture("claimed", { ok: false, error: "voucher_shortfall", shortfall: 400 });
    expect((await f.post(60000)).status).toBe(200);
    expect(f.booking.status).toBe("PENDING PAYMENT");
  });

  it("retries capacity contention with 503 so Yoco redelivers", async () => {
    const f = webhookFixture("claimed", { ok: false, error: "no_capacity" });
    expect((await f.post(60000)).status).toBe(503);
    expect(f.booking.status).toBe("HELD");
  });
});
