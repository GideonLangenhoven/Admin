import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The storefront backdrop used to fall back to the first active tour's photo
// when no background was uploaded. The result was an image on the booking site
// that appears nowhere in its settings: the settings screen offers "Upload
// background" and correctly reports none is set, while the site displayed a
// tour photo anyway. Reported live on jerrys.booking.bookingtours.co.za, where
// Morning Kayak's photo was serving as the page background.
describe("storefront backdrop only uses an uploaded background", () => {
  const src = readFileSync("booking/app/components/GlassBackdrop.tsx", "utf8");

  it("never reads tour imagery", () => {
    expect(src).not.toContain('from("tours")');
    expect(src).not.toContain("image_url");
    // The query was the only reason this component touched the database.
    expect(src).not.toContain("createTenantSupabase");
  });

  it("clears the image when the operator removes their background", () => {
    // Assigning only when a hero_image exists left a deleted background on
    // screen until remount. The tour-photo fallback used to mask that by
    // swapping in another image.
    expect(src).toContain("setImageUrl(hero || null)");
  });

  it("still lets an uploaded background win", () => {
    expect(src).toContain("theme.hero_image");
    expect(src).toContain("<img");
  });

  it("keeps the palette mesh as the backdrop when nothing is uploaded", () => {
    expect(src).toContain('className="glass-backdrop-mesh"');
    const css = readFileSync("booking/app/globals.css", "utf8");
    expect(css).toContain(".glass-backdrop-mesh");
    expect(css).toContain("var(--cfg-bg, var(--bg))");
  });

  it("still renders nothing inside the embed widget", () => {
    // The embed iframes onto a host page with a transparent background; a
    // fixed backdrop would paint over the operator's own site.
    expect(src).toContain('pathname.startsWith("/embed")');
    expect(src).toContain("if (isEmbed) return null;");
  });
});
