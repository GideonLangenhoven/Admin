import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// S1 — rebook-booking IDOR (CODE_AUDIT_2026-07-02).
// The function runs as service_role and performs money operations
// (CANCEL_REFUND, REMOVE_GUESTS, RESCHEDULE) from a client-supplied
// booking_id. Every caller must prove ownership of the booking before any
// action dispatches: internal service-role callers, OTP customer-session
// holders (email + business match), or admin JWTs (business match).
describe("rebook-booking caller authorization (S1)", () => {
  const rebook = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");
  const page = readFileSync("booking/app/my-bookings/page.tsx", "utf8");
  const config = readFileSync("supabase/config.toml", "utf8");

  it("authorizes the caller before dispatching any action", () => {
    expect(rebook).toContain("authorizeCaller");
    const authIdx = rebook.indexOf("const authz = await authorizeCaller(req, body, booking)");
    expect(authIdx).toBeGreaterThan(-1);
    // The gate must sit between booking load and the first action dispatch.
    const dispatchIdx = rebook.indexOf('if (action === "CLAIM_CREDIT")');
    expect(authIdx).toBeLessThan(dispatchIdx);
    expect(rebook).toContain("if (authz.ok !== true) return fail(req, authz.message, authz.status)");
  });

  it("customer sessions must match the booking email AND business", () => {
    expect(rebook).toContain("verifyCustomerSession");
    expect(rebook).toContain("session.businessId !== booking.business_id");
  });

  it("admin JWTs must belong to the booking's business (SUPER_ADMIN exempt)", () => {
    expect(rebook).toContain('admin.role === "SUPER_ADMIN" || admin.business_id === booking.business_id');
    expect(rebook).toContain("admin.suspended");
  });

  it("unauthenticated callers are rejected", () => {
    expect(rebook).toContain("Please sign in to manage this booking.");
  });

  it("my-bookings sends the customer session token with rebook calls", () => {
    expect(page).toContain('localStorage.getItem("mb_customer_session")');
    expect(page).toMatch(/customer_session: customerSession/);
  });

  it("gateway JWT check is replaced by in-function auth (service-role callers)", () => {
    expect(config).toMatch(/\[functions\.rebook-booking\]\s*\nverify_jwt = false/);
  });
});
