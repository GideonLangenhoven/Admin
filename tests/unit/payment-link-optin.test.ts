import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression guard: payment-link email/WhatsApp for NEW bookings is admin-only
// (opt-in). Customer paths pay inline; the hold-expiry cron chases abandons.
// This broke once because create-checkout sent by default and web-chat forgot
// to opt out — so we assert the opt-in gate + that customer paths never opt in.
const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("payment-link opt-in", () => {
  it("create-checkout gates the BOOKING link on send_payment_link, not skip", () => {
    const src = read("supabase/functions/create-checkout/index.ts");
    expect(src).toMatch(/canonicalType === "BOOKING" && bookingId && sendPaymentLink/);
    expect(src).toMatch(/const sendPaymentLink = body\.send_payment_link === true/);
  });

  it("customer booking paths never request the payment link", () => {
    for (const p of [
      "supabase/functions/web-chat/index.ts",
      "supabase/functions/wa-webhook/index.ts",
      "supabase/functions/external-booking/index.ts",
    ]) {
      expect(read(p), p).not.toContain("send_payment_link");
    }
  });

  it("admin resend paths do request it", () => {
    for (const p of ["app/bookings/page.tsx", "app/bookings/[id]/page.tsx"]) {
      expect(read(p), p).toContain("send_payment_link: true");
    }
  });

  // The two automatic customer-facing payment-link emails (the only ones):
  it("hold-expiry transactionally queues the payment link for the durable worker", () => {
    const migration = read("supabase/migrations/20260921140000_durable_notification_jobs.sql");
    const worker = read("supabase/functions/cron-tasks/index.ts");
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.expire_single_hold[\s\S]*INSERT INTO notification_jobs[\s\S]*'HOLD_PAYMENT_REMINDER'[\s\S]*'PAYMENT_LINK'/);
    expect(migration).toContain("'hold-payment-link/' || h.id::text");
    expect(worker).toMatch(/rpc\("claim_notification_jobs"[\s\S]*rpc\("validate_notification_job"[\s\S]*type: job\.template_type[\s\S]*delivery_idempotency_key: job\.dedupe_key[\s\S]*rpc\("finish_notification_job"/);
  });

  it("3rd failed payment emails the payment link", () => {
    const src = read("supabase/functions/yoco-webhook/index.ts");
    expect(src).toContain('event: "booking_payment_failed"');
    expect(src).toMatch(/failCount\.count \|\| 0\) === 3/);
    expect(src).toContain("PAYMENT_FAILED_3X_PAYLINK_SENT");
  });
});
