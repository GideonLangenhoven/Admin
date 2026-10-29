import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

// M2: Mark Paid records the amount received (a deposit is fine), the method
// and a reference, and tells the guest once: the booking confirmation when it
// was still pending, otherwise a receipt (the updated invoice), never a second
// "Booking Confirmed!".
const pending = {
  id: "bk-pending", business_id: "biz-a", status: "PENDING", qty: 2, unit_price: 500, total_amount: 1000, original_total: 1000, total_captured: 0,
  customer_name: "Pending Guest", email: "pending@example.invalid", phone: null, slots: { start_time: "2026-11-08T06:00:00Z" }, tours: { name: "Harbour paddle" },
};
const confirmed = { ...pending, id: "bk-confirmed", status: "CONFIRMED", qty: 3, total_amount: 1500, original_total: 1500, customer_name: "Deposit Guest", email: "Deposit@Example.invalid " };

function fixture(booking: Record<string, unknown>, rpcResult: Record<string, unknown>, opts: { capturedAfter?: number; failQueue?: boolean } = {}) {
  const writes: Array<{ table: string; op: string; value: any }> = [];
  const rpc = vi.fn(async (name: string) => name === "next_invoice_number" ? { data: "INV-7" } : rpcResult);
  const from = (table: string) => {
    const q: any = {};
    for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: table === "bookings" ? booking : null });
    q.single = async () => table === "bookings" ? { data: { total_captured: opts.capturedAfter } } : { data: { id: "inv-1", invoice_number: "INV-7", discount_amount: 0 } };
    for (const op of ["insert", "update", "upsert"]) q[op] = (value: any) => {
      writes.push({ table, op, value });
      const done: any = Promise.resolve({ error: table === "notification_jobs" && opts.failQueue ? { message: "queue down" } : null });
      done.select = () => q; done.eq = () => done;
      return done;
    };
    return q;
  };
  const fetchImpl = vi.fn(async () => Response.json({ ok: true, queued: true }, { status: 202 }));
  const whatsapp = vi.fn(async () => ({ channel: "text" }));
  const handler = sourceHandler("supabase/functions/manual-mark-paid/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => ({ from, rpc }), getTenantByBusinessId: async () => ({ business: { id: "biz-a", currency: "ZAR" }, credentials: {} }),
      getBusinessDisplayName: () => "Fixture Tours", formatTenantDate: () => "27 Oct 2026", formatTenantDateTime: () => "Sat 8 Nov, 08:00",
      sendWhatsappTextForTenant: whatsapp,
    },
    "../_shared/waiver.ts": { getWaiverContext: async () => ({ waiverStatus: "PENDING", waiverLink: "https://waiver.invalid/x" }) },
    "../_shared/auth.ts": { requireAuth: async () => ({ userId: "admin-a", businessId: "biz-a" }), canAccessBusiness: (_auth: unknown, id: string) => id === "biz-a" },
  }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" }, fetchImpl as unknown as typeof fetch);
  const post = async (body: Record<string, unknown>) => {
    const res = await handler(new Request("https://fixture.invalid/manual-mark-paid", {
      method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body: JSON.stringify({ action: "mark_paid", ...body }),
    }));
    return { status: res.status, body: await res.json() };
  };
  const manualRpc = () => rpc.mock.calls.find(([name]) => name === "account_manual_booking")?.[1];
  const emails = () => fetchImpl.mock.calls.map(([url, init]: any) => ({ url, body: JSON.parse(init.body) }));
  return { handler, post, writes, manualRpc, emails, whatsapp };
}

describe("Mark Paid with an amount", () => {
  it("records a deposit on a confirmed booking and queues a receipt, not a second confirmation", async () => {
    const f = fixture(confirmed, { data: { ok: true, amount: 500, balance_due: 1000, already_paid: false, previous_status: "CONFIRMED" } }, { capturedAfter: 500 });
    const res = await f.post({ booking_id: "bk-confirmed", amount: 500, payment_method: "Cash", payment_reference: "Receipt 0042", expected_captured: 0 });
    expect(res).toEqual({ status: 200, body: { ok: true, amount: 500, balance_due: 1000, paid_in_full: false, notified: "receipt" } });
    expect(f.manualRpc()).toEqual({ p_booking_id: "bk-confirmed", p_business_id: "biz-a", p_mark_paid: true, p_payment_method: "Cash", p_amount: 500, p_expected_captured: 0 });
    expect(f.emails()).toEqual([]);
    const job = f.writes.find(w => w.table === "notification_jobs")!.value;
    expect(job).toMatchObject({
      source_type: "MANUAL_PAYMENT", template_type: "INVOICE", recipient: "deposit@example.invalid", dedupe_key: "manual-payment/bk-confirmed/50000",
      payload: { booking_id: "bk-confirmed", business_id: "biz-a", invoice_number: "INV-7", tour_date_raw: "2026-11-08T06:00:00Z", payment_reference: "BK-CONFI" },
    });
    expect(f.writes.find(w => w.table === "logs")!.value).toMatchObject({ event: "payment_marked_manual", payload: {
      amount: 500, balance_due: 1000, payment_method: "Cash", payment_reference: "Receipt 0042", user_id: "admin-a",
    } });
  });

  it("confirms a pending booking once, through the booking's confirmation job", async () => {
    const f = fixture(pending, { data: { ok: true, amount: 1000, balance_due: 0, already_paid: false, previous_status: "PENDING" } }, { capturedAfter: 1000 });
    const res = await f.post({ booking_id: "bk-pending", payment_method: "EFT" });
    expect(res.body).toEqual({ ok: true, amount: 1000, balance_due: 0, paid_in_full: true, notified: "confirmation" });
    // Older callers (bulk Mark Paid, voucher-covered bookings) still mean the full balance.
    expect(f.manualRpc()).toMatchObject({ p_amount: null, p_expected_captured: null });
    expect(f.emails()).toMatchObject([{ url: "https://fixture.invalid/functions/v1/send-email", body: { type: "BOOKING_CONFIRM", data: { booking_id: "bk-pending" } } }]);
    expect(f.writes.some(w => w.table === "notification_jobs")).toBe(false);
  });

  it("tells a guest without email on WhatsApp what was received and what is due", async () => {
    const f = fixture({ ...confirmed, email: null, phone: "0820000000" }, { data: { ok: true, amount: 500, balance_due: 1000, previous_status: "CONFIRMED" } }, { capturedAfter: 500 });
    expect((await f.post({ booking_id: "bk-confirmed", amount: 500, payment_method: "EFT" })).body.notified).toBe("whatsapp");
    expect(f.whatsapp.mock.calls[0][2]).toContain("R500.00 received (EFT)\nStill due: R1000.00");
  });

  it("rejects an unusable amount before touching the booking", async () => {
    for (const amount of [0, -5, 10.005, "abc"]) {
      const f = fixture(confirmed, { data: { ok: true } });
      expect(await f.post({ booking_id: "bk-confirmed", amount })).toEqual({ status: 400, body: { error: "Enter the amount received in rand and cents." } });
      expect(f.manualRpc()).toBeUndefined();
    }
  });

  it("shows the server's reason, never raw database text", async () => {
    const over = fixture(confirmed, { data: { ok: false, error: "That is more than the R1000.00 still due." } });
    expect(await over.post({ booking_id: "bk-confirmed", amount: 1200 })).toEqual({ status: 409, body: { error: "That is more than the R1000.00 still due." } });
    const raw = fixture(confirmed, { data: null, error: { message: 'null value in column "status" violates not-null constraint' } });
    expect(await raw.post({ booking_id: "bk-confirmed", amount: 500 })).toEqual({ status: 409, body: { error: "The payment could not be recorded. Please try again." } });
  });

  // Round 2, item 5: the reply was text/plain, so supabase.functions.invoke
  // handed MarkPaidDialog a string and the toast read "R0.00 by Cash. R0.00 still due".
  it("replies as JSON, so the admin app's toast gets the amount and the balance", async () => {
    const f = fixture(confirmed, { data: { ok: true, amount: 500, balance_due: 1000, previous_status: "CONFIRMED" } }, { capturedAfter: 500 });
    const admin = createClient("https://fixture.invalid", "anon-key", {
      auth: { persistSession: false },
      global: { fetch: (input, init) => f.handler(new Request(input, init)) },
    });
    const { data, error } = await admin.functions.invoke("manual-mark-paid", {
      body: { action: "mark_paid", booking_id: "bk-confirmed", amount: 500, payment_method: "Cash", expected_captured: 0 },
    });
    expect(error).toBe(null);
    expect(data).toMatchObject({ amount: 500, balance_due: 1000, paid_in_full: false });
  });

  it("says the payment was recorded when only the guest notice fails", async () => {
    const f = fixture(confirmed, { data: { ok: true, amount: 500, balance_due: 1000, previous_status: "CONFIRMED" } }, { capturedAfter: 500, failQueue: true });
    const res = await f.post({ booking_id: "bk-confirmed", amount: 500, payment_method: "Cash" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, amount: 500, warning: "The payment was recorded, but the guest could not be notified. Check Failed Notifications or resend from Invoices." });
  });
});
