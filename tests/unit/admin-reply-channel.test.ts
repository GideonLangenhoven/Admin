import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// admin-reply succeeds in three materially different ways: the message went out
// on WhatsApp, it is queued behind a reopener template until the customer
// replies, or WhatsApp refused it and we emailed instead. All three returned
// ok:true, and both callers rendered all three as an unqualified success toast.
//
// Reported live: an admin clicked WhatsApp on a booking, Meta rejected the send
// with (#131030) Recipient phone number not in allowed list (the tenant is on a
// Meta test number), the customer got an email, and the admin was told
// "WhatsApp sent". That is how a tenant stays on a broken WhatsApp number
// indefinitely — every send "succeeds".
const FN = readFileSync("supabase/functions/admin-reply/index.ts", "utf8");
const BOOKINGS = readFileSync("app/bookings/page.tsx", "utf8");
const INBOX = readFileSync("app/inbox/page.tsx", "utf8");

describe("admin-reply reports the channel it actually used", () => {
  it("labels every delivery outcome", () => {
    expect(FN).toContain('channel: "whatsapp"');
    expect(FN).toContain('channel: "reopener"');
    expect(FN).toContain('channel: "email"');
    expect(FN).toContain('channel: "web"');
  });

  it("never claims an email send without saying so", () => {
    // The invariant that actually protects the operator: an email fallback can
    // return ok:true, but only carrying channel:"email".
    const emailReturns = FN.split("via_email: true").slice(1);
    expect(emailReturns.length).toBeGreaterThan(0);
    for (const tail of emailReturns) {
      const head = FN.slice(0, FN.length - tail.length);
      const start = head.lastIndexOf("JSON.stringify({");
      expect(FN.slice(start, FN.length - tail.length + 200)).toContain('channel: "email"');
    }
  });

  it("explains a WhatsApp rejection even when the email succeeded", () => {
    // 131030 (test-number allow-list) and 190 (dead token) both have a concrete
    // remedy. Swallowing them on the success path is what hid this for weeks.
    expect(FN).toContain("function whatsappFailureHint");
    expect(FN).toContain("case 131030:");
    expect(FN).toContain("case 190:");
    // The hint rides the ok:true email response, not just the hard failure.
    const emailBlock = FN.slice(FN.indexOf("Guaranteed-communication fallback"));
    expect(emailBlock.slice(0, emailBlock.indexOf("ok: false"))).toContain("+ hint");
  });
});

describe("both callers title the toast from the channel", () => {
  for (const [name, src] of [["bookings", BOOKINGS], ["inbox", INBOX]] as const) {
    it(`${name} distinguishes email and reopener from a real send`, () => {
      expect(src).toContain("res.data?.channel");
      expect(src).toContain('channel === "email" ? "Sent by email instead"');
      expect(src).toContain('channel === "reopener" ? "Queued for WhatsApp"');
      expect(src).toContain('tone: channel === "email" || channel === "reopener" ? "warning" : "success"');
    });

    it(`${name} surfaces the remedy on a hard failure`, () => {
      // res.data.error is the bare category ("WhatsApp API Error");
      // res.data.message is the actionable remedy. Prefer the remedy.
      expect(src).toContain("res.data.message || res.data.error");
    });
  }
});
