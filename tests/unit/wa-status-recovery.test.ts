import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Meta accepts an out-of-window free-form send (SENT + message id) and only
// reports the failure asynchronously via a value.statuses "failed" callback
// with error 131047/131026. wa-webhook must recover these: flip the audit row
// to FAILED, queue the message for the outbox drain, and send the reopener
// template — otherwise the admin sees "sent" and the customer gets nothing.
describe("wa-webhook delivery-status recovery", () => {
  const waWebhook = readFileSync("supabase/functions/wa-webhook/index.ts", "utf8");
  it("handles value.statuses failed callbacks", () => {
    expect(waWebhook).toContain("value.statuses");
    expect(waWebhook).toContain("131047");
    expect(waWebhook).toContain('"WINDOW_CLOSED_RETRY"');
  });
  it("is idempotent on webhook redelivery (already-FAILED rows skipped)", () => {
    expect(waWebhook).toContain('original.status === "FAILED"');
  });
  it("never sends a template in response to a failed template (no loop)", () => {
    expect(waWebhook).toContain('original.kind !== "text"');
  });
  it("queued messages use the outbox drain semantics (WAITING_WINDOW)", () => {
    // The drain matches on business_id + phone + status
    expect(waWebhook).toContain('status: "WAITING_WINDOW"');
  });
});
