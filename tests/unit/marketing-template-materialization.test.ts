import { describe, expect, it } from "vitest";
import { getStarterTemplateByKey, materializeStarterTemplate } from "../../components/marketing/starter-templates";

// Starter templates used to install identically for every tenant: platform
// pine/amber colors, no operator socials, no operator tours. This tests the
// install-time materialization that bakes operator branding into the blocks
// so it stops regressing back to one-size-fits-all.
describe("marketing template materialization", () => {
  const biz = {
    email_color: "#8a2be2",
    logo_url: "https://cdn.example.com/logo.png",
    business_address: "123 Safari Rd, Kruger",
    public_phone: "+27821234567",
    social_facebook: "https://facebook.com/safarico",
    social_instagram: null,
    social_tiktok: null,
    social_youtube: null,
    social_twitter: null,
    social_linkedin: null,
    social_tripadvisor: "https://tripadvisor.com/safarico",
    social_google_reviews: "https://g.page/safarico/review",
  };

  it("uses the operator's accent color on CTA buttons instead of the platform default", () => {
    const starter = getStarterTemplateByKey("welcome-series-1")!;
    const blocks = materializeStarterTemplate(starter, biz, []);
    const button = blocks.find((b) => b.type === "button") as any;
    expect(button.color).toBe("#8a2be2");
  });

  it("falls back to the platform pine when the operator has no accent color set", () => {
    const starter = getStarterTemplateByKey("welcome-series-1")!;
    const blocks = materializeStarterTemplate(starter, {}, []);
    const button = blocks.find((b) => b.type === "button") as any;
    expect(button.color).toBe("#1b3b36");
  });

  it("fills the footer with the operator's real address, phone, and socials", () => {
    const starter = getStarterTemplateByKey("welcome-series-1")!;
    const blocks = materializeStarterTemplate(starter, biz, []);
    const footer = blocks.find((b) => b.type === "footer") as any;
    expect(footer.address).toBe("123 Safari Rd, Kruger");
    expect(footer.phone).toBe("+27821234567");
    expect(footer.socials.facebook).toBe("https://facebook.com/safarico");
    expect(footer.socials.instagram).toBeUndefined();
  });

  it("points the review-request CTA at the operator's Google review link", () => {
    const starter = getStarterTemplateByKey("post-tour-review-1")!;
    const blocks = materializeStarterTemplate(starter, biz, []);
    const button = blocks.find((b) => b.type === "button") as any;
    expect(button.url).toBe("https://g.page/safarico/review");
  });

  it("falls back to TripAdvisor, then {site_url}, when Google reviews isn't set", () => {
    const starter = getStarterTemplateByKey("post-tour-review-1")!;
    const noGoogle = { ...biz, social_google_reviews: null };
    expect((materializeStarterTemplate(starter, noGoogle, []).find((b) => b.type === "button") as any).url).toBe(
      "https://tripadvisor.com/safarico"
    );
    expect(
      (materializeStarterTemplate(starter, { ...noGoogle, social_tripadvisor: null }, []).find((b) => b.type === "button") as any).url
    ).toBe("{site_url}");
  });

  it("does not redirect unrelated CTAs (e.g. voucher emails) to the review link", () => {
    const starter = getStarterTemplateByKey("welcome-series-3")!;
    const blocks = materializeStarterTemplate(starter, biz, []);
    const button = blocks.find((b) => b.type === "button") as any;
    expect(button.url).toBe("{site_url}");
  });

  it("inserts the operator's real tours as tour cards after the guest-favourites quote", () => {
    const starter = getStarterTemplateByKey("welcome-series-2")!;
    const tours = [
      { id: "tour-1", name: "Sunrise Balloon Safari", duration_minutes: 180, image_url: "" },
      { id: "tour-2", name: "Bush Walk", duration_minutes: 90, image_url: "" },
    ];
    const blocks = materializeStarterTemplate(starter, biz, tours);
    const quoteIdx = blocks.findIndex((b) => b.type === "quote");
    const cards = blocks.slice(quoteIdx + 1, quoteIdx + 3) as any[];
    expect(cards.map((c) => c.type)).toEqual(["tourcard", "tourcard"]);
    expect(cards[0].title).toBe("Sunrise Balloon Safari");
    expect(cards[0].ctaUrl).toBe("{site_url}/book?tour=tour-1");
    expect(cards[1].title).toBe("Bush Walk");
  });

  it("prepends the operator's logo when one is set, and skips it otherwise", () => {
    const starter = getStarterTemplateByKey("welcome-series-1")!;
    const withLogo = materializeStarterTemplate(starter, biz, []);
    expect(withLogo[0]).toMatchObject({ type: "image", src: "https://cdn.example.com/logo.png" });

    const withoutLogo = materializeStarterTemplate(starter, { ...biz, logo_url: null }, []);
    expect(withoutLogo[0].type).not.toBe("image");
  });
});
