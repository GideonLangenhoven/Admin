import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillMarketingTokens } from "../../supabase/functions/_shared/marketing-tokens.ts";

// Reported live: an operator received the "Voucher Expiry · Final Day" email
// with a literal {voucher_code} and {business_name} in the body — no voucher
// number, no company name. Three senders render marketing HTML and each kept
// its own token list: the admin test-send (send-email MARKETING_TEST) replaced
// only {first_name}, and the campaign dispatcher never knew about the voucher
// tokens at all. Any token missing from a sender's list reaches the inbox raw.
const SHARED = "supabase/functions/_shared/marketing-tokens.ts";
const SENDERS = [
  "supabase/functions/send-email/index.ts",
  "supabase/functions/marketing-dispatch/index.ts",
  "supabase/functions/marketing-automation-dispatch/index.ts",
];

// Every token any starter template can contain.
const TOKENS = ["first_name", "last_name", "email", "voucher_code", "voucher_amount", "promo_code", "promo_discount", "business_name", "company_name", "site_url"];

describe("fillMarketingTokens leaves no token unrendered", () => {
  it("replaces every token the templates use", () => {
    const body = TOKENS.map((t) => `{${t}}`).join(" ");
    const out = fillMarketingTokens(body, {
      first_name: "Jerry", last_name: "K", email: "j@example.com",
      voucher_code: "GV-123", voucher_amount: "R500",
      promo_code: "SAVE10", promo_discount: "10%",
      business_name: "Kayak Marine", site_url: "https://jerrys.booking.bookingtours.co.za",
    });
    expect(out).not.toMatch(/\{[a-z_]+\}/);
    expect(out).toContain("GV-123");
    expect(out).toContain("Kayak Marine");
  });

  it("renders a missing value as empty, never as literal braces", () => {
    // A blank line beats "{voucher_code}" in a customer's inbox.
    const out = fillMarketingTokens("Code: {voucher_code} from {business_name}", { first_name: "Jerry" });
    expect(out).not.toContain("{voucher_code}");
    expect(out).not.toContain("{business_name}");
  });

  it("handles the double-brace brand aliases older templates use", () => {
    for (const raw of ["{{company_name}}", "{{ business_name }}", "{brand_name}"]) {
      expect(fillMarketingTokens(raw, { business_name: "Kayak Marine" })).toBe("Kayak Marine");
    }
  });

  it("defaults first_name so no email opens with a bare comma", () => {
    expect(fillMarketingTokens("Hi {first_name},", {})).toBe("Hi there,");
  });
});

describe("every marketing sender routes through the shared map", () => {
  for (const path of SENDERS) {
    it(`${path.split("/")[2]} imports and calls fillMarketingTokens`, () => {
      const src = readFileSync(path, "utf8");
      expect(src).toContain("marketing-tokens.ts");
      expect(src).toContain("fillMarketingTokens(");
    });
  }

  it("no sender hand-rolls a {first_name} replace of its own", () => {
    // The drift that caused this bug: a private token list in one sender.
    for (const path of SENDERS) {
      expect(readFileSync(path, "utf8")).not.toContain("\\{first_name\\}");
    }
    expect(readFileSync(SHARED, "utf8")).toContain("\\{first_name\\}");
  });
});
