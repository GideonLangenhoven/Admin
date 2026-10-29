import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sourceExports } from "../helpers/source-handler";

// M6: the operator's public contact details show on every booking-site page,
// under "Contact us" in the footer; blank ones stay hidden.
function footer(contact: Record<string, string | null>) {
  const Footer = sourceExports("booking/app/components/Footer.tsx", {
    "react/jsx-runtime": jsx,
    "./ThemeProvider": { useTheme: () => ({ business_name: "Fixture Kayak", public_email: null, public_phone: null, public_whatsapp: null, ...contact }) },
    "./BrandLogo": { BrandMark: () => null, BrandWordmark: () => null },
    "../lib/cookie-consent": { COOKIE_SETTINGS_EVENT: "bt:cookie-settings" },
  }).default as (props: { withBottomNav: boolean }) => any;
  return renderToStaticMarkup(jsx.jsx(Footer, { withBottomNav: false }));
}

describe("booking-site footer contact details", () => {
  it("links every saved contact detail under Contact us", () => {
    const html = footer({ public_email: "hello@fixture.invalid", public_phone: "+27 21 555 0100", public_whatsapp: "+27 82 555 0100" });
    expect(html).toContain("Contact us");
    expect(html).toContain('href="mailto:hello@fixture.invalid"');
    expect(html).toContain('href="tel:+27215550100"');
    expect(html).toContain('href="https://wa.me/27825550100"');
  });

  it("shows only the details that are saved", () => {
    const html = footer({ public_email: "hello@fixture.invalid" });
    expect(html).toContain('href="mailto:hello@fixture.invalid"');
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("wa.me");
  });

  it("hides the block when no contact details are saved", () => {
    expect(footer({})).not.toContain("Contact us");
  });
});
