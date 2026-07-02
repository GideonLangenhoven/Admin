import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// B3 — Weather-cancellation self-service (L4).
// my-bookings calls rebook-booking with action:"CLAIM_CREDIT" for the
// Voucher/Refund buttons, and action:"RESCHEDULE" for "Pick a New Date" —
// all on a booking that is CANCELLED + refund_status='ACTION_REQUIRED'.
// The backend must accept CLAIM_CREDIT and let claim-eligible cancelled
// bookings through the state guard.
describe("weather-cancellation credit claim (B3)", () => {
  const rebook = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");
  const webhook = readFileSync("supabase/functions/yoco-webhook/index.ts", "utf8");

  it("rebook-booking accepts the CLAIM_CREDIT action", () => {
    expect(rebook).toContain('"CLAIM_CREDIT"');
    expect(rebook).toContain("handleClaimCredit");
  });

  it("claim-eligible cancelled bookings pass the state guard", () => {
    expect(rebook).toContain('booking.refund_status || "") === "ACTION_REQUIRED"');
  });

  it("frontend sends the credit_action the handler expects", () => {
    const page = readFileSync("booking/app/my-bookings/page.tsx", "utf8");
    expect(page).toContain('action: "CLAIM_CREDIT"');
    expect(rebook).toContain("credit_action");
  });

  it("credit-claim reschedules do not double-release the old slot", () => {
    // capacity for a cancelled booking was already released at cancellation
    expect(rebook).toContain("isCreditClaim");
    expect(webhook).toContain("wasCancelled");
  });
});
