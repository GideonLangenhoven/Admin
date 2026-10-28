import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";
import { webChatFixture } from "../helpers/web-chat-fixture";

// Owner decision 2026-10-28: returning-guest discounts for VERIFIED guests on every
// channel, priced server-side. Web chat and the booking site verify an email with
// the emailed My Bookings code; WhatsApp already has Meta's verified number.
describe("web chat returning-guest discount", () => {
  async function quote(sessionEmail: string | null, bookingEmail = "") {
    const f = webChatFixture();
    Object.assign(f.discount, { type: "LOYALTY", percent: 10, minQty: 1, email: "guest@fixture.invalid", label: "Loyalty discount" });
    const customer_session = sessionEmail ? await f.verifiedCustomer(sessionEmail) : undefined;
    const response = await f.request({ chat_session: await f.session(), customer_session, message: "2", state: { ...f.bookingState, step: "ASK_QTY", email: bookingEmail } });
    return { f, result: await response.json() };
  }

  it("a My Bookings session earns the discount", async () => {
    const { f, result } = await quote("guest@fixture.invalid");
    expect(result.state).toMatchObject({ total: 720, discount: 80 });
    expect(result.reply).toContain("10% automatic discount");
    expect(result.reply).not.toContain("Booked with us before?");
    expect(f.calls.find(c => c.name === "resolve_booking_discount")?.data.p_email).toBe("guest@fixture.invalid");
  });

  it("no session: no discount, and the guest is told how to verify", async () => {
    const { f, result } = await quote(null);
    expect(result.state).toMatchObject({ total: 800, discount: 0 });
    expect(result.reply).toContain("Booked with us before? Sign in to My Bookings with the code we email you");
    expect(f.calls.find(c => c.name === "resolve_booking_discount")?.data.p_email).toBeNull();
  });

  it("a session for someone else's email doesn't price this booking", async () => {
    const { result } = await quote("guest@fixture.invalid", "friend@fixture.invalid");
    expect(result.state).toMatchObject({ total: 800, discount: 0 });
  });
});

describe("booking-site checkout", () => {
  function checkout() {
    const rpc = vi.fn(async (name: string) => name === "check_rate_limit" ? { data: true, error: null } : { data: name === "prepare_booking_checkout" ? { ok: false, error: "fixture stop" } : { applied: true }, error: null });
    const booking = { id: "booking-a", business_id: "tenant-a", tour_id: "tour-a", qty: 2, status: "PENDING", waiver_token: "booking-proof", custom_fields: {} };
    const from = (table: string) => {
      const chain: any = {};
      for (const name of ["select", "update", "eq", "in"]) chain[name] = () => chain;
      chain.maybeSingle = chain.single = async () => ({ data: table === "businesses" ? { booking_custom_fields: [] } : table === "bookings" ? booking : null, error: null });
      return chain;
    };
    const handler = sourceHandler("supabase/functions/create-checkout/index.ts", {
      "../_shared/tenant.ts": { createServiceClient: () => ({ from, rpc }), getTenantByBusinessId: async () => null, getBusinessAllowedOrigins: () => [], isAllowedOrigin: () => true, resolveBusinessSiteUrls: () => ({}) },
      "../_shared/subscription.ts": { blockIfNotTrading: async () => null },
      "../_shared/auth.ts": { requireAuth: async () => { throw new Error("anonymous"); }, canAccessBusiness: () => false },
      "../_shared/booking-success.ts": { bookingSuccessUrl: async (url: string) => url },
      "../_shared/customer-session.ts": { verifyCustomerSession: async (token: string) => token === "tenant-a-session" ? { valid: true, email: "guest@example.invalid", businessId: "tenant-a" } : token === "tenant-b-session" ? { valid: true, email: "guest@example.invalid", businessId: "tenant-b" } : { valid: false } },
      "../_shared/booking-custom-fields.ts": { applicableBookingQuestions: () => [], questionConfigurationChanged: () => false, validateQuestionAnswers: () => ({ errors: [], answers: {} }), captureQuestionFields: () => ({}) },
    });
    const post = (customer_session?: string) => handler(new Request("https://synthetic.invalid/create-checkout", {
      method: "POST", headers: { "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify({ booking_id: "booking-a", booking_token: "booking-proof", amount: 600, type: "BOOKING", customer_session }),
    }));
    const names = () => rpc.mock.calls.map(([name]) => name).filter(name => name !== "check_rate_limit");
    return { post, rpc, names };
  }

  it("a verified guest's discount is applied before the booking is priced", async () => {
    const c = checkout();
    await c.post("tenant-a-session");
    expect(c.names()).toEqual(["apply_verified_booking_discount", "prepare_booking_checkout"]);
    expect(c.rpc.mock.calls.find(([name]) => name === "apply_verified_booking_discount")?.[1]).toEqual({ p_booking_id: "booking-a", p_email: "guest@example.invalid" });
  });

  it("no session, a forged one, or another operator's session changes nothing", async () => {
    for (const session of [undefined, "forged", "tenant-b-session"]) {
      const c = checkout();
      await c.post(session);
      expect(c.names()).toEqual(["prepare_booking_checkout"]);
    }
  });

  it("the site sends the My Bookings session, and offers the emailed code", () => {
    const page = readFileSync("booking/app/book/page.tsx", "utf8");
    expect(page).toContain("customer_session: appliedPromo ? null : readCustomerSession(email) || null");
    expect(page).toMatch(/<ReturningGuest key=\{email\.trim\(\)\.toLowerCase\(\)\}/);
    const guest = readFileSync("booking/app/book/ReturningGuest.tsx", "utf8");
    expect(guest).toContain('supabase.functions.invoke("send-otp"');
    expect(guest).toContain('localStorage.setItem("mb_customer_session"');
  });
});
