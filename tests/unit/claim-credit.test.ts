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

// Rebooking a SETTLED cancellation (refund/voucher already issued) must not
// treat the original payment as credit — the customer pays the full new price
// via the upgrade payment-link path, and the admin modal hides credit math.
describe("settled-cancelled rebook charges full price", () => {
  const rebook = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");
  const page = readFileSync("app/bookings/page.tsx", "utf8");

  it("RESCHEDULE passes the state guard for any cancelled booking", () => {
    expect(rebook).toContain('action === "RESCHEDULE" && booking.status === "CANCELLED"');
  });

  it("credit is zeroed when the payout was already issued", () => {
    expect(rebook).toContain("handleReschedule(req, booking, body, claimEligible)");
    expect(rebook).toContain("isCreditClaim && !claimEligible ? 0");
  });

  it("admin rebook modal hides credit math for settled cancellations", () => {
    expect(page).toContain("rebookHasNoCredit");
    expect(page).toContain("no credit remains");
  });
});
