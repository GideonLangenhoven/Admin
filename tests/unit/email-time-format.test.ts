import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Customers were receiving "New Date & Time: 2026-07-11T10:00:00+00:00".
// Two mechanisms guard against it:
// 1. send-email centrally formats any raw ISO start_time (covers every
//    current and future caller — wa-webhook, process-refund, refunds page…).
// 2. rebook-booking's immediate-swap notification must report the NEW slot,
//    not the stale pre-swap relation.
describe("email start_time formatting", () => {
  const sendEmail = readFileSync("supabase/functions/send-email/index.ts", "utf8");
  const rebook = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");

  it("send-email formats raw ISO start_time with the tenant timezone", () => {
    expect(sendEmail).toContain('formatTenantDateTime({ id: branding.businessId, timezone: branding.timezone }, d.start_time)');
    expect(sendEmail).toMatch(/select\("id, name, business_name, subdomain, timezone/);
  });

  it("reschedule notification uses the new slot's start_time and tour name", () => {
    expect(rebook).toContain("booking.slots = { ...(booking.slots || {}), start_time: newSlot.start_time }");
    expect(rebook).toMatch(/select\("base_price_per_person, name"\)/);
  });
});
