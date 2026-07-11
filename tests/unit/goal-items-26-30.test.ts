import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Items 26/27/29/30 — source-level regression guards.

describe("item 26 — booking-site T&Cs come from operator settings", () => {
  const terms = readFileSync("booking/app/terms/page.tsx", "utf8");
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  it("the terms page reads the operator's terms_conditions column", () => {
    expect(terms).toContain('select("terms_conditions")');
    expect(terms).toContain("isPlaceholderPolicy");
  });
  it("the settings editor explains the platform-default fallback rule", () => {
    expect(settings).toContain("platform-default terms");
  });
});

describe("item 27 — chat handoff, unified inbox, date-grouped history", () => {
  const webChat = readFileSync("supabase/functions/web-chat/index.ts", "utf8");
  const inbox = readFileSync("app/inbox/page.tsx", "utf8");
  it("web-chat escalations create a real HUMAN conversation in the inbox", () => {
    expect(webChat).toContain("flagHumanHandoff");
    expect(webChat).toContain('status: "HUMAN"');
    // both escalation paths route through the handoff
    expect(webChat.split("flagHumanHandoff(").length - 1).toBeGreaterThanOrEqual(3);
  });
  it("the inbox lists every conversation — no status fork, no history tab", () => {
    expect(inbox).not.toContain('.in("status"');
    expect(inbox).not.toContain("loadHistoryConvos");
    expect(inbox).toContain("need attention");
  });
  it("threads show the full history with day separators", () => {
    expect(inbox).not.toContain("filterHumanConversation");
    expect(inbox).toContain("showDate");
  });
});

describe("item 29 — booking questions are a plain form, not raw JSON", () => {
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  it("the raw JSON textarea is gone", () => {
    expect(settings).not.toContain("bookingCustomFieldsJson");
    expect(settings).not.toContain("Configuration Code (JSON)");
  });
  it("the form serialises to the same booking_custom_fields structure", () => {
    expect(settings).toContain("saveBookingQuestions");
    expect(settings).toContain("booking_custom_fields: cleaned");
  });
  it("existing question keys are preserved (answers are keyed on them)", () => {
    expect(settings).toContain("key: q.key ||");
  });
  it("the section lives inside Tours & Activities", () => {
    const toursStart = settings.indexOf('id="tours"');
    const nextSection = settings.indexOf('id="addons"');
    const questions = settings.indexOf("Custom Booking Questions");
    expect(toursStart).toBeGreaterThan(-1);
    expect(questions).toBeGreaterThan(toursStart);
    expect(questions).toBeLessThan(nextSection);
  });
});

describe("item 30 — operator-cancellation remediation", () => {
  const rebook = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");
  const webhook = readFileSync("supabase/functions/yoco-webhook/index.ts", "utf8");
  const cronTasks = readFileSync("supabase/functions/cron-tasks/index.ts", "utf8");
  const weatherCancel = readFileSync("supabase/functions/weather-cancel/index.ts", "utf8");
  const card = readFileSync("booking/app/my-bookings/BookingCard.tsx", "utf8");
  const flow = readFileSync("booking/app/my-bookings/RescheduleFlow.tsx", "utf8");

  it("credit-claim reschedules may cross tours; active bookings may not", () => {
    expect(rebook).toContain('newSlot.tour_id !== booking.tour_id && !isCreditClaim');
  });
  it("party size may shrink on a credit-claim reschedule, refunding the difference", () => {
    expect(rebook).toContain("body.new_qty ?? booking.qty");
    expect(rebook).toContain("newUnitPrice * newQty");
    // the excess refund skips the 5% fee when the operator cancelled
    expect(rebook).toContain("isCreditClaim ? 1 : 0.95");
  });
  it("capacity is validated against the chosen qty", () => {
    expect(rebook).toContain("available < newQty");
  });
  it("the upgrade webhook finalises qty and hold with new_qty", () => {
    expect(webhook).toContain("pr.new_qty || rBooking.qty");
    expect(webhook).toContain("qty: finalQty");
    expect(cronTasks).toContain("new_qty");
  });
  it("full refund on operator cancels — no 5% label on the claim panel", () => {
    expect(card).not.toContain("* 0.95");
    expect(flow).toContain('isClaim ? 1 : 0.95');
  });
  it("OTA-sourced bookings are excluded from self-service remediation", () => {
    expect(weatherCancel).toContain('startsWith("OTA_")');
    expect(weatherCancel).toContain("isPaid && !isOta");
  });

  it("the refund queue only shows customer-chosen refunds, never pending decisions", () => {
    // Same rule everywhere an operator sees a refund count: queue, nav badge, dashboard tile
    for (const f of ["app/refunds/page.tsx", "components/RefundBadge.tsx", "app/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain('"ACTION_REQUIRED"');
      expect(src, f).toContain('.eq("refund_status", "REQUESTED")');
    }
  });

  it("the slot cancel action doesn't promise a refund — the guest chooses", () => {
    const slots = readFileSync("app/slots/page.tsx", "utf8");
    expect(slots).not.toContain("Cancel & refund");
    expect(slots).toContain("Cancel & notify");
  });

  it("total_refunded only moves when money moves — never pre-counted at request time", () => {
    const rebook = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");
    // Any update that sets refund_status REQUESTED (→ process-refund queue)
    // must NOT also bump total_refunded — process-refund does that on success.
    // Manual-EFT paths (no gateway step) may still track it.
    expect(rebook).not.toMatch(/refund_status: [^\n]*REQUESTED[^\n]*,[\s\S]{0,120}?total_refunded:\s*\w+\s*\+/);
  });

  it("voucher cancellation emails show the code, not the three options again", () => {
    const sendEmail = readFileSync("supabase/functions/send-email/index.ts", "utf8");
    expect(sendEmail).toContain("const hasVoucher = Boolean(d.voucher_code)");
    expect(sendEmail).toContain("Your voucher");
  });

  it("pending reschedules live on the bookings page (Due column + Send link), not a separate tab", () => {
    const bookings = readFileSync("app/bookings/page.tsx", "utf8");
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(bookings).toContain("sendRescheduleLink");
    expect(bookings).toContain("rescheduleDue");
    expect(layout).not.toContain("pending-reschedules");
    expect(existsSync("app/bookings/pending-reschedules")).toBe(false);
  });
});
