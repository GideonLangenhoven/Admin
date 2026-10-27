import { describe, expect, it } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// M8: a document that still asks for money is a pro forma (with the banking
// details); the tax invoice goes out once the booking is paid, including when
// the guest pays by link for a booking confirmed with money still due.
const sendEmail = "supabase/functions/send-email/index.ts";
const invoiceAmountPaid = sourceFunction(sendEmail, "invoiceAmountPaid", {});
const invoiceTitle = sourceFunction(sendEmail, "invoiceTitle", { invoiceAmountPaid });
const deps = { invoiceAmountPaid, invoiceTitle, VAT_RATE: 0.15, invoiceServiceDate: (value: unknown) => String(value) };
const invoice = {
  invoice_number: "INV-0042", customer_name: "Guest", customer_email: "guest@fixture.invalid", tour_name: "Harbour paddle",
  tour_date: "15 Oct 2026", qty: 2, unit_price: "100.00", total_amount: 200, payment_method: "EFT", payment_reference: "ABC",
};
const cases = [[0, "Pro Forma Invoice"], [100, "Pro Forma Invoice"], [200, "Tax Invoice"]] as const;

describe("pro forma until paid, tax invoice on payment", () => {
  const html = sourceFunction(sendEmail, "invoiceHtml", { ...deps, heroImg: () => "", paymentDueHtml: () => "" });

  it.each(cases)("the invoice email with R%s of R200 received is a %s", (paid, title) => {
    const out = html({ ...invoice, amount_paid: paid });
    expect(out).toContain(">" + title + " INV-0042</h1>");
    expect(out).not.toContain(title === "Tax Invoice" ? "Pro Forma" : "Tax Invoice");
  });

  it.each(cases)("the invoice PDF with R%s of R200 received is a %s with banking details", async (paid, title) => {
    const texts: string[] = [];
    const page = { drawText: (text: string) => { texts.push(text); }, drawRectangle: () => {}, drawLine: () => {}, drawImage: () => {} };
    const doc = { addPage: () => page, embedFont: async () => ({ widthOfTextAtSize: () => 0 }), save: async () => new Uint8Array() };
    const pdf = sourceFunction(sendEmail, "buildInvoicePdf", { ...deps, PDFDocument: { create: async () => doc }, StandardFonts: {}, rgb: () => ({}) });
    await pdf({ ...invoice, amount_paid: paid }, {
      companyName: "Fixture Kayak", addressLines: [], reg: "", vat: "", logoUrl: "",
      bank: { account_owner: "Fixture Kayak", account_number: "123456", account_type: "Cheque", bank_name: "Fixture Bank", branch_code: "250655" },
    });
    expect(texts).toContain(title.toUpperCase());
    expect(texts).toContain("Banking Details");
  });

  it("a guest paying by link for a confirmed booking gets the tax invoice, not a second confirmation", async () => {
    for (const [previousStatus, type] of [["CONFIRMED", "INVOICE"], ["HELD", "BOOKING_CONFIRM"]]) {
      const sent: any[] = [];
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
      const confirm = sourceFunction("supabase/functions/yoco-webhook/index.ts", "sendBookingConfirmation", {
        supabase, SUPABASE_URL: "https://fixture.invalid", SUPABASE_KEY: "fixture-key",
        getTenantByBusinessId: async () => ({ business: { id: "business-a", currency: "ZAR" } }),
        getBusinessDisplayName: () => "Kayak", formatTenantDateTime: () => "Thu, 15 Oct, 10:00", formatTenantDate: () => "15 October 2026",
        getWaiverContext: async () => ({ waiverStatus: "SIGNED", waiverLink: "" }),
        createInvoice: async () => ({ invoice_number: "INV-0042", created_at: "2026-10-15T08:00:00Z", payment_reference: "payment-a", discount_amount: 0 }),
        fetch: async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return Response.json({ ok: true }); },
      });
      await confirm({ id: "booking-a", business_id: "business-a", email: "guest@fixture.invalid", customer_name: "Guest", status: "PAID",
        qty: 2, unit_price: 100, total_amount: 200, slots: { start_time: "2026-10-15T08:00:00Z" }, tours: { name: "Harbour paddle" } },
      "payment-a", "checkout-a", 20000, previousStatus);
      expect(sent.map(body => body.type), previousStatus).toEqual([type]);
      expect(sent[0].data).toMatchObject({ booking_id: "booking-a", invoice_number: "INV-0042", unit_price: 100 });
    }
  });
});
