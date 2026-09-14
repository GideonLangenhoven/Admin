import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Item 25 — trip-reminder orchestration regression guards. The reminder is
// WhatsApp-first with email ONLY on failure, the waiver ask rides inside the
// same reminder (no separate unconditional INDEMNITY blast), and waiver asks
// never fire right after booking.

const autoMessages = readFileSync("supabase/functions/auto-messages/index.ts", "utf8");
const sendEmail = readFileSync("supabase/functions/send-email/index.ts", "utf8");

describe("rule 1 — WhatsApp first, email only when WhatsApp fails", () => {
  it("a single orchestration function replaces the two independent passes", () => {
    expect(autoMessages).toContain("orchestrateTripRemindersForBusiness");
    expect(autoMessages).not.toContain("sendRemindersForBusiness");
    expect(autoMessages).not.toContain("sendIndemnityEmailsForBusiness");
  });
  it("the email send is gated on WhatsApp not having delivered", () => {
    expect(autoMessages).toContain("if (!delivered && booking.email)");
    expect(autoMessages).toContain('type: "REMINDER", data: emailData');
  });
  it("WhatsApp still carries the approved booking_reminder template fallback", () => {
    expect(autoMessages).toContain('name: "booking_reminder"');
  });
  it("send-email now has a REMINDER template (the old type was a silent 400)", () => {
    expect(sendEmail).toContain('case "REMINDER":');
    expect(sendEmail).toContain('type === "BOOKING_CONFIRM" || type === "INDEMNITY" || type === "REMINDER"');
  });
});

describe("rule 2 — waiver ask is bundled into the same reminder", () => {
  it("the reminder message embeds the booking-specific waiver link", () => {
    expect(autoMessages).toContain('from "../_shared/waiver.ts"');
    expect(autoMessages).toContain("resolveWaiverLink(tenant.business, booking.id, booking.waiver_token)");
    expect(autoMessages).toContain("please sign your waiver");
  });
  it("a waiver email goes out only for the fixed-param template edge case", () => {
    expect(autoMessages).toContain('waChannel === "template" && needsWaiver && booking.email');
  });
});

describe("rule 3 — waiver ask only when unsigned, never right after booking", () => {
  it("the waiver link is conditional on waiver_status", () => {
    expect(autoMessages).toContain('booking.waiver_status !== "SIGNED"');
  });
  it("bookings created in the last 2 hours are skipped (confirmation already covers them)", () => {
    expect(autoMessages).toContain("createdCutoffIso");
    expect(autoMessages).toContain("booking.created_at > createdCutoffIso");
  });
  it("reminders stay idempotent via the (booking_id, type) ledger", () => {
    expect(autoMessages).toContain('alreadySent(booking.id, "REMINDER")');
    expect(autoMessages).toContain('onConflict: "booking_id,type"');
  });
  it("the reminder window is time-to-trip (next 24h), tenant queries stay business-scoped", () => {
    expect(autoMessages).toContain('gt("slots.start_time", nowIso)');
    expect(autoMessages).toContain('lt("slots.start_time", in24hIso)');
    expect(autoMessages).toContain('eq("business_id", businessId)');
  });
});
