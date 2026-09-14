import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Week-3 de-branding: BookingTours is multi-tenant, so no shared code path may
// emit the origin tenant's brand, address or Google Place ID to another
// operator's people.
//
// Found this round: send-otp's admin-settings verification email bypassed
// send-email's branding layer entirely and called Resend directly with a
// template that said "Cape Kayak" in the header and footer — every operator's
// admins saw it. It now takes the brand name as a required argument, joined
// off the authorisation query it was already running.
//
// Two functions are exempt from the literal scan because they ARE the branding
// layer and must hold the legacy strings in order to rewrite them:
// send-email's applyBranding, and marketing-dispatch, which rewrites templates
// seeded with the origin tenant's name to the sending tenant's brand.
const FN_DIR = "supabase/functions";
const BRANDING_LAYER = ["send-email", "marketing-dispatch"];
const BANNED = [
  { pattern: /Cape Kayak/, what: "the origin tenant's brand name" },
  { pattern: /Three Anchor Bay|180 Beach Rd|179 Beach Road/, what: "the origin tenant's street address" },
  { pattern: /ChIJ9a9I09RHzB0Rh9R8O4pM7aQ/, what: "the origin tenant's Google Place ID" },
];

// Strip comments: an explanation of what was removed is not a leak.
function codeOnly(src: string) {
  return src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");
}

describe("no shared edge function leaks the origin tenant's identity", () => {
  const fns = readdirSync(FN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !BRANDING_LAYER.includes(d.name))
    .map((d) => d.name);

  for (const fn of fns) {
    let src: string;
    try { src = readFileSync(`${FN_DIR}/${fn}/index.ts`, "utf8"); } catch { continue; }
    const code = codeOnly(src);
    for (const { pattern, what } of BANNED) {
      it(`${fn} does not hardcode ${what}`, () => {
        expect(pattern.test(code), `${fn} still contains ${pattern}`).toBe(false);
      });
    }
  }
});

describe("send-otp admin mail is branded per tenant", () => {
  const SRC = readFileSync(`${FN_DIR}/send-otp/index.ts`, "utf8");

  it("takes the brand name as a required argument, with no tenant default", () => {
    expect(SRC).toContain("function otpEmailHtml(code: string, brandName: string)");
    // A default would silently reintroduce one operator's brand for everyone.
    expect(SRC).not.toMatch(/brandName: string = /);
  });

  it("falls back to the platform, never to another operator", () => {
    expect(SRC).toContain('|| "BookingTours"');
  });

  it("names the FK on the businesses embed", () => {
    // Three constraints link admin_users and businesses; a bare embed returns
    // PGRST201 and would 403 every admin out of settings verification.
    expect(SRC).toContain("businesses!admin_users_business_id_fkey");
  });
});
