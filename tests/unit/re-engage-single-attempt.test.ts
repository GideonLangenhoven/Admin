import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Live incident 2026-08-15: the RE_ENGAGE dedup marker was only written after
// a SUCCESSFUL WhatsApp send. A number Meta permanently rejects (#131030) never
// got the marker, so the 5-minute cron retried it forever: 578 failed sends per
// number in two days, each popping a fresh failure toast for the operator.
// The invariants: one attempt per customer per window (marker written whether
// the send worked or not), and a WA failure falls back to the email version.
const SRC = readFileSync("supabase/functions/auto-messages/index.ts", "utf8");
const fn = SRC.slice(
  SRC.indexOf("async function sendReEngagementForBusiness"),
  SRC.indexOf("async function autoTimeoutHumanChatsForBusiness"),
);

describe("re-engagement sends are attempted exactly once per customer", () => {
  it("writes the RE_ENGAGE marker outside the send try-block (success or failure)", () => {
    const marker = 'type: "RE_ENGAGE" })';
    expect(fn).toContain(marker);
    expect(fn.indexOf(marker)).toBe(fn.lastIndexOf(marker)); // exactly one insert site
    // The marker insert must come after the catch, so a failed send still writes it.
    expect(fn.indexOf(marker)).toBeGreaterThan(fn.indexOf("RE_ENGAGE_ERR"));
  });

  it("falls back to the email version when WhatsApp rejects the customer", () => {
    expect(fn).toContain('"CUSTOMER_MESSAGE"');
    expect(fn).toContain("if (booking.email)");
    expect(fn).toContain("RE_ENGAGE_EMAIL_ERR");
    // The bookings query must actually fetch the email for the fallback.
    expect(fn).toContain('.select("phone, customer_name, email")');
  });
});
