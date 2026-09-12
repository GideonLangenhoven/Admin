import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blocksToHtml } from "../../components/marketing/blocks/blocks-to-html";
import { replaceLegacyMarketingSocialIcons } from "../../supabase/functions/_shared/marketing-email-html.ts";

describe("marketing social icons", () => {
  it("renders new social blocks with email-safe HTTPS images", () => {
    const html = blocksToHtml([{
      type: "social",
      id: "social-1",
      platforms: { facebook: "https://facebook.com/kayak", instagram: "https://instagram.com/kayak" },
    }]);

    expect(html).toContain("https://www.google.com/s2/favicons?domain=facebook.com&amp;sz=64");
    expect(html).toContain("https://www.google.com/s2/favicons?domain=instagram.com&amp;sz=64");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("upgrades legacy saved icons without touching unrelated inline images", () => {
    const legacy = [
      '<img src="data:image/svg+xml,%3Csvg%3Efacebook%3C%2Fsvg%3E" alt="Facebook" width="32">',
      '<img src="data:image/svg+xml,%3Csvg%3Elogo%3C%2Fsvg%3E" alt="Company logo">',
    ].join("");
    const html = replaceLegacyMarketingSocialIcons(legacy);

    expect(html).toContain('src="https://www.google.com/s2/favicons?domain=facebook.com&sz=64" alt="Facebook"');
    expect(html).toContain('src="data:image/svg+xml,%3Csvg%3Elogo%3C%2Fsvg%3E" alt="Company logo"');
  });

  it("upgrades legacy icons in every marketing email path", () => {
    for (const path of [
      "supabase/functions/marketing-dispatch/index.ts",
      "supabase/functions/marketing-automation-dispatch/index.ts",
      "supabase/functions/send-email/index.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("marketing-email-html.ts");
      expect(source).toContain("replaceLegacyMarketingSocialIcons(html)");
    }
  });
});
