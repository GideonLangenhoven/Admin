import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

const webhook = "supabase/functions/yoco-webhook/index.ts";

describe("invoice issuance", () => {
  it("does not return an invoice number when the invoice insert fails", async () => {
    const linked = vi.fn();
    const supabase = {
      from(table: string) {
        if (table === "bookings") return { update: linked };
        const query: any = {
          select: () => query, eq: () => query, order: () => query, limit: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          insert: () => query,
          single: async () => ({ data: null, error: { message: "duplicate invoice number" } }),
        };
        return query;
      },
      rpc: async () => ({ data: "INV-00001", error: null }),
    };
    const createInvoice = sourceFunction(webhook, "createInvoice", { supabase });
    await expect(createInvoice({ id: "booking-a", business_id: "business-a", total_amount: 1200, qty: 2 }, "Morning Kayak", "Thu, 01 Oct, 09:00", "p_test")).rejects.toThrow("Invoice insert failed: duplicate invoice number");
    expect(linked).not.toHaveBeenCalled();
  });

  it("uses the payment time when invoice creation fails, never the yearless tour label", async () => {
    const sent: any[] = [];
    const now = "2026-09-29T07:04:20Z";
    const FixedDate = class extends Date {
      constructor(value?: string) { super(value ?? now); }
      static now() { return Date.parse(now); }
    };
    const supabase = {
      from(table: string) {
        if (table === "logs") return {
          select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
          insert: async () => ({ error: null }),
        };
        if (table === "bookings") return { update: () => ({ eq: () => ({ is: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "booking-a" } }) }) }) }) }) };
        throw new Error("Unexpected table " + table);
      },
      rpc: async () => ({ data: null, error: null }),
    };
    const sendBookingConfirmation = sourceFunction(webhook, "sendBookingConfirmation", {
      Date: FixedDate, supabase, SUPABASE_URL: "https://fixture.invalid", SUPABASE_KEY: "fixture-key",
      getTenantByBusinessId: async () => ({ business: { id: "business-a", currency: "ZAR" } }),
      getBusinessDisplayName: () => "Kayak",
      formatTenantDateTime: () => "Thu, 01 Oct, 09:00",
      formatTenantDate: (_business: unknown, value: string) => {
        expect(Date.parse(value)).toBe(Date.parse(now));
        return "29 September 2026";
      },
      getWaiverContext: async () => ({ waiverStatus: "SIGNED", waiverLink: "" }),
      createInvoice: async () => { throw new Error("Invoice insert failed"); },
      fetch: async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({ ok: true });
      },
    });
    await sendBookingConfirmation({ id: "booking-a", business_id: "business-a", email: "guest@fixture.invalid", customer_name: "Guest", total_amount: 1200, qty: 2, slots: { start_time: "2026-10-01T07:00:00Z" }, tours: { name: "Morning Kayak" } }, "p_test", "checkout-a", 1200);
    expect(sent[0].data.invoice_date).toBe("29 September 2026");
    expect(sent[0].data.invoice_number).toBe("");
  });
});
