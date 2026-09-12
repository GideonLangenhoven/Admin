/* HTTPS PNG icons render in email clients; inline SVG/data URIs do not. */

function favicon(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

export const SOCIAL_PLATFORMS: Record<string, { label: string; icon: string; brandColor: string; defaultUrl: string }> = {
  facebook: {
    label: "Facebook",
    brandColor: "#1877F2",
    icon: favicon("facebook.com"),
    defaultUrl: "https://facebook.com/",
  },
  instagram: {
    label: "Instagram",
    brandColor: "#E4405F",
    icon: favicon("instagram.com"),
    defaultUrl: "https://instagram.com/",
  },
  twitter: {
    label: "X (Twitter)",
    brandColor: "#000000",
    icon: favicon("x.com"),
    defaultUrl: "https://x.com/",
  },
  youtube: {
    label: "YouTube",
    brandColor: "#FF0000",
    icon: favicon("youtube.com"),
    defaultUrl: "https://youtube.com/",
  },
  tiktok: {
    label: "TikTok",
    brandColor: "#000000",
    icon: favicon("tiktok.com"),
    defaultUrl: "https://tiktok.com/@",
  },
  linkedin: {
    label: "LinkedIn",
    brandColor: "#0A66C2",
    icon: favicon("linkedin.com"),
    defaultUrl: "https://linkedin.com/company/",
  },
  whatsapp: {
    label: "WhatsApp",
    brandColor: "#25D366",
    icon: favicon("whatsapp.com"),
    defaultUrl: "https://wa.me/",
  },
};
