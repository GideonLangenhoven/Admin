import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceExports, sourceFunction, sourceHandler } from "../helpers/source-handler";
const env = { SUPABASE_SERVICE_ROLE_KEY: "fixture-secret-only" };
const tokens = sourceExports("supabase/functions/_shared/payment-deadline.ts", {}, env) as any;
const now = Date.parse("2026-10-18T09:00:00Z"), deadline = "2026-10-25T09:00:00.000Z";
afterEach(() => vi.restoreAllMocks());

describe("manual booking payment link", () => {
  it("binds booking and tenant, rejects tampering and expires at the exact deadline", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const url = new URL(await tokens.paymentDeadlineUrl("https://fixture.invalid", "b", "tenant", deadline));
    const token = url.searchParams.get("token")!;
    expect(await tokens.verifyPaymentDeadlineToken(token, "b", "tenant")).toBe(true);
    expect(await tokens.verifyPaymentDeadlineToken(token, "other", "tenant")).toBe(false);
    expect(await tokens.verifyPaymentDeadlineToken(token, "b", "other")).toBe(false);
    expect(await tokens.verifyPaymentDeadlineToken(token.replace(/^\d+/, String(now + 8 * 86400000)), "b", "tenant")).toBe(false);
    const confirmation = sourceExports("supabase/functions/_shared/booking-success.ts", {}, env) as any;
    expect(await confirmation.verifyBookingSuccessToken(token, "b", "tenant")).toBe(false);
    clock.mockReturnValue(Date.parse(deadline) - 1);
    expect(await tokens.verifyPaymentDeadlineToken(token, "b", "tenant")).toBe(true);
    clock.mockReturnValue(Date.parse(deadline));
    expect(await tokens.verifyPaymentDeadlineToken(token, "b", "tenant")).toBe(false);
  });
  it("redirects only a still-unpaid matching booking and never exposes guest details", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const url = await tokens.paymentDeadlineUrl("https://fixture.invalid", "b", "tenant", deadline);
    const original = { source: "ADMIN", status: "PENDING", total_amount: 100, total_captured: 0, payment_status: "PENDING", payment_deadline: deadline, payment_url: "https://checkout.yoco.com/fixture" };
    let booking: any = original;
    const filters: any[] = [];
    const q: any = { select: () => q, eq: (...args: any[]) => { filters.push(args); return q; }, maybeSingle: async () => ({ data: booking, error: null }) };
    const handler = sourceHandler("supabase/functions/booking-payment/index.ts", { "../_shared/tenant.ts": { createServiceClient: () => ({ from: () => q }) }, "../_shared/payment-deadline.ts": tokens }, env);
    const response = await handler(new Request(url));
    expect(response.status).toBe(303); expect(response.headers.get("Location")).toBe(original.payment_url);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).toBe(""); expect(filters).toEqual([["id", "b"], ["business_id", "tenant"]]);
    for (const change of [{ status: "PAID" }, { status: "CANCELLED" }, { total_captured: 100 }, { total_captured: 50 }, { payment_status: "MISMATCH_QUARANTINE" }, { payment_deadline: "2026-10-24T09:00:00Z" }, { source: "WEB" }]) {
      booking = { ...original, ...change }; expect((await handler(new Request(url))).status).toBe(410);
    }
    booking = { ...original, payment_url: "https://evil.invalid/checkout" };expect((await handler(new Request(url))).status).toBe(503);
  });
});

describe("payment and waiver emails", () => {
  const due = sourceFunction("supabase/functions/send-email/index.ts", "paymentDueHtml", {});
  const payment = sourceFunction("supabase/functions/send-email/index.ts", "paymentLinkHtml", { heroImg: () => "", paymentDueHtml: due });
  const waiver = sourceFunction("supabase/functions/send-email/index.ts", "indemnityHtml", { heroImg: () => "" });
  it("shows the exact due date with expiry wording instead of a conflicting trip-relative deadline", () => {
    const html = payment({ payment_due_label: "25 October 2026 at 11:00 (Africa/Johannesburg)", payment_url: "https://fixture.invalid/pay", cancel_phrase: "12 hours", total_amount: 100 });
    expect(html).toContain("25 October 2026 at 11:00 (Africa/Johannesburg)");
    expect(html).toContain("This payment link will expire at that time");expect(html).not.toContain("12 hours before the trip");
  });
  it("manual waiver requests do not claim the trip is tomorrow", () => {
    const html = waiver({ manual_waiver_request: true, waiver_url: "https://fixture.invalid/waiver", customer_name: "Alex", tour_name: "Harbour paddle" });
    expect(html).toContain("Please complete your waiver");expect(html).toContain("https://fixture.invalid/waiver");expect(html).not.toContain("tomorrow");
  });
});
