const SOCIAL_ICON_DOMAINS: Record<string, string> = {
  facebook: "facebook.com",
  instagram: "instagram.com",
  linkedin: "linkedin.com",
  tiktok: "tiktok.com",
  twitter: "x.com",
  "x (twitter)": "x.com",
  "x / twitter": "x.com",
  youtube: "youtube.com",
  whatsapp: "whatsapp.com",
};

function favicon(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// Templates saved before 2026-08-31 contain inline SVG data URIs. Gmail and
// other major clients strip those images, so upgrade only the known social
// icons at send time; unrelated inline images remain untouched.
export function replaceLegacyMarketingSocialIcons(html: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=")data:image\/svg\+xml,[^"]*("[^>]*\balt="([^"]+)"[^>]*>)/gi,
    (match, before: string, after: string, alt: string) => {
      const domain = SOCIAL_ICON_DOMAINS[alt.trim().toLowerCase()];
      return domain ? before + favicon(domain) + after : match;
    },
  );
}
