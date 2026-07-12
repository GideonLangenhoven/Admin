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
    expect(src).toMatch(/type === "BOOKING" && bookingId && sendPaymentLink/);
    expect(src).toMatch(/const sendPaymentLink = body\.send_payment_link === true/);
  });

  it("customer booking paths never request the payment link", () => {
    for (const p of [
      "supabase/functions/web-chat/index.ts",
      "supabase/functions/wa-webhook/index.ts",
      "supabase/functions/external-booking/index.ts",
      "booking/app/book/page.tsx",
    ]) {
      expect(read(p), p).not.toContain("send_payment_link");
    }
  });

  it("admin resend paths do request it", () => {
    for (const p of ["app/bookings/page.tsx", "app/bookings/[id]/page.tsx"]) {
      expect(read(p), p).toContain("send_payment_link: true");
    }
  });
});
