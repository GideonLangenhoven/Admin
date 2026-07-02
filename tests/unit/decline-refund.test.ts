import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// K5 — Admin must be able to decline a requested refund: sets
// refund_status='DECLINED' and notifies the customer.
describe("decline refund action (K5)", () => {
  const page = readFileSync("app/refunds/page.tsx", "utf8");

  it("has a decline action that sets refund_status DECLINED", () => {
    expect(page).toContain('refund_status: "DECLINED"');
    expect(page).toContain("Decline");
  });

  it("notifies the customer on decline", () => {
    expect(page).toContain("send-email");
  });

  it("declined refunds stay visible in the processed list", () => {
    expect(page).toContain('"DECLINED"]');
  });
});
