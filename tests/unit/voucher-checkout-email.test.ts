import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("gift voucher checkout email flow", () => {
  // The "please pay" email is NO LONGER sent eagerly at checkout creation.
  // The buyer is redirected straight to Yoco, so an immediate email is
  // redundant. create-checkout now persists payment_url on the voucher, and
  // cron-tasks emails the payment link ONLY if the voucher is still PENDING
  // after 15 min (payment failed / abandoned) — mirroring the booking flow.
  it("does not eagerly email a payment link at checkout, persists payment_url instead", () => {
    const checkoutSource = readFileSync("supabase/functions/create-checkout/index.ts", "utf8");
    expect(checkoutSource).not.toContain('type: "VOUCHER_PAYMENT_LINK"');
    expect(checkoutSource).toContain("payment_url: yocoData.redirectUrl");
  });

  it("sends the voucher payment link from the cron only after 15 min unpaid, once", () => {
    const cronSource = readFileSync("supabase/functions/cron-tasks/index.ts", "utf8");
    const sendEmailSource = readFileSync("supabase/functions/send-email/index.ts", "utf8");

    expect(cronSource).toContain('rpc("enqueue_voucher_payment_reminders"');
    expect(cronSource).toContain('rpc("claim_notification_jobs"');
    expect(cronSource).toContain('rpc("finish_notification_job"');
    // A current checkout/email fingerprint is queued once; changed payment
    // details produce a fresh stable key, and provider acceptance stamps source.
    const migration = readFileSync("supabase/migrations/20260921140000_durable_notification_jobs.sql", "utf8");
    expect(migration).toContain("'voucher-payment-link/' || v.id::text");
    expect(migration).toContain("payment_reminder_sent_at = COALESCE(payment_reminder_sent_at, now())");
    expect(sendEmailSource).toContain('case "VOUCHER_PAYMENT_LINK"');
  });
});
