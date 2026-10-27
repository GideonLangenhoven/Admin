import { Block, uid } from "./blocks/block-types";
import { formatDuration } from "../../app/lib/duration";

/* ── Starter template library ─────────────────────────────────────────────
   One designed email per automation step (see AUTOMATION recipe keys in
   app/marketing/automations/page.tsx — each send_email step carries a
   template_key that resolves here). Installing an automation auto-creates
   its templates, so operators never hunt for "which template goes with
   which automation".

   Merge tokens (replaced by marketing dispatch at send time):
   {first_name} {last_name} {email} {voucher_code} {voucher_amount}
   {promo_code} {promo_discount} {business_name} {site_url}              */

export interface StarterTemplate {
  key?: string;
  name: string;
  category: string;
  description: string;
  subject: string;
  blocks: () => Block[];
}

/* ── Brand tokens (mirror blocks-to-html.ts) ── */
const PINE = "#1b3b36";
const INK = "#17221C";
const BODY = "#4A5651";
const AMBER = "#D9822F";
const MUTED = "#66736B";
const MONO = "'Courier New',monospace";

/* ── Composable pieces ── */

const defaultFooter = (): Block => ({
  type: "footer",
  id: uid(),
  companyName: "{business_name}",
  address: "",
  phone: "",
  socials: { facebook: "", instagram: "" },
});

const defaultSocial = (): Block => ({
  type: "social",
  id: uid(),
  platforms: { facebook: "", instagram: "", whatsapp: "" },
});

// Courier micro-label — the signature editorial device.
const eyebrow = (label: string): Block => ({
  type: "text",
  id: uid(),
  content: `<p style="margin:0;letter-spacing:.16em;text-transform:uppercase;">${label}</p>`,
  fontFamily: MONO,
  fontSize: 11,
  color: MUTED,
});

const h1 = (text: string): Block => ({ type: "header", id: uid(), text, level: "h1", color: INK });
const h2 = (text: string): Block => ({ type: "header", id: uid(), text, level: "h2", color: INK });

const para = (html: string): Block => ({ type: "text", id: uid(), content: html, color: BODY });

const cta = (text: string, url = "{site_url}", color = PINE): Block => ({ type: "button", id: uid(), text, url, color });

const gap = (height = 8): Block => ({ type: "spacer", id: uid(), height });

// Amber voucher chip — code + value set at send time by the automation.
const voucherPanel = (note: string): Block => ({
  type: "text",
  id: uid(),
  content:
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;"><tr>` +
    `<td style="background:#FDF6EE;border:1px dashed ${AMBER};border-radius:14px;padding:22px 24px;text-align:center;">` +
    `<p style="margin:0 0 6px;font-family:${MONO};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${AMBER};">Your voucher</p>` +
    `<p style="margin:0;font-family:Georgia,serif;font-size:30px;letter-spacing:.06em;color:${INK};">{voucher_code}</p>` +
    `<p style="margin:8px 0 0;font-size:14px;color:${BODY};">${note}</p>` +
    `</td></tr></table>`,
});

const factList = (items: string[]): Block =>
  para(`<ul style="margin:6px 0;padding-left:20px;">${items.map((i) => `<li style="margin:6px 0;">${i}</li>`).join("")}</ul>`);

const signoff = (): Block =>
  para(`<p style="margin:14px 0 0;">See you out there,<br/><span style="font-family:Georgia,serif;font-style:italic;color:${INK};">The {business_name} team</span></p>`);

// Standard shell: eyebrow → headline → body → (extras) → CTA → footer
function shell(opts: { eyebrow: string; title: string; body: Block[]; ctaText?: string; ctaUrl?: string }): Block[] {
  return [
    eyebrow(opts.eyebrow),
    h1(opts.title),
    ...opts.body,
    ...(opts.ctaText ? [gap(4), cta(opts.ctaText, opts.ctaUrl)] : []),
    signoff(),
    gap(10),
    defaultSocial(),
    defaultFooter(),
  ];
}

/* ── The library ─────────────────────────────────────────────────────── */

export const starterTemplates: StarterTemplate[] = [
  /* ═══ Welcome Series ═══ */
  {
    key: "welcome-series-1",
    name: "Welcome · The Story",
    category: "follow-up",
    description: "Introduce your business and what to expect.",
    subject: "Welcome to {business_name}",
    blocks: () =>
      shell({
        eyebrow: "Welcome aboard",
        title: "Welcome to {business_name}",
        body: [
          para(`<p>Hi {first_name},</p><p>Welcome to {business_name}. We hope to see you on a trip soon.</p>`),
          para(`<p>We'll send you:</p>`),
          factList([
            "Tips on conditions, seasons and local spots",
            "Early access to new experiences",
            "Trip photos and stories",
          ]),
        ],
        ctaText: "Browse experiences",
      }),
  },
  {
    key: "welcome-series-2",
    name: "Welcome · Guest Favourites",
    category: "follow-up",
    description: "Introduce guest favourites with a review.",
    subject: "Guest favourites",
    blocks: () => [
      eyebrow("Guest favourites"),
      h1("Guest favourites"),
      para(`<p>Hi {first_name},</p><p>Browse the trips our guests recommend and book again.</p>`),
      para(`<p>Explore our current tours and ask our team which experience suits your group.</p>`),
      para(`<p>Our trips are guided, in small groups and suitable for beginners.</p>`),
      gap(4),
      cta("See what's on"),
      signoff(),
      gap(10),
      defaultSocial(),
      defaultFooter(),
    ],
  },
  {
    key: "welcome-series-3",
    name: "Welcome · Plan Your Visit",
    category: "follow-up",
    description: "Help subscribers choose their first trip.",
    subject: "Plan your visit, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "Plan your visit",
        title: "Plan your first trip",
        body: [
          para(`<p>Hi {first_name},</p><p>Choose a trip and date, or ask us for help finding one for your group.</p>`),
        ],
        ctaText: "Plan my visit",
      }),
  },

  /* ═══ Post-Tour Review Request ═══ */
  {
    key: "post-tour-review-1",
    name: "Review · Thank You + Ask",
    category: "follow-up",
    description: "Post-trip thank-you and review links.",
    subject: "How was it, {first_name}?",
    blocks: () =>
      shell({
        eyebrow: "Trip complete",
        title: "Thanks for joining us",
        body: [
          para(`<p>Hi {first_name},</p><p>Thanks for joining us today. A short review helps other guests choose a trip.</p>`),
        ],
        ctaText: "Leave a review",
      }),
  },
  {
    key: "post-tour-review-2",
    name: "Review · Gentle Nudge",
    category: "follow-up",
    description: "One reminder for eligible guests. Completed reviews cannot be tracked.",
    subject: "How was your trip, {first_name}?",
    blocks: () =>
      shell({
        eyebrow: "While it's fresh",
        title: "Leave a review",
        body: [
          para(`<p>Hi {first_name},</p><p>How was your trip? A few words about your experience help other guests. If you've already left a review, thank you.</p>`),
        ],
        ctaText: "Write a review",
      }),
  },

  /* ═══ Win-Back ═══ */
  {
    key: "win-back-1",
    name: "Welcome Back · We Miss You",
    category: "follow-up",
    description: "Invite past guests to browse current trips.",
    subject: "It's been a while, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "Since you've been gone",
        title: "Join us again",
        body: [
          para(`<p>Hi {first_name},</p><p>We'd love to see you again. Browse our current trips and dates.</p>`),
        ],
        ctaText: "See what's new",
      }),
  },
  {
    key: "win-back-2",
    name: "Welcome Back · Plan Another Visit",
    category: "follow-up",
    description: "Follow up with guests who have not rebooked.",
    subject: "Another trip, {first_name}?",
    blocks: () =>
      shell({
        eyebrow: "Welcome back",
        title: "Plan another visit",
        body: [
          para(`<p>Hi {first_name},</p><p>Planning another visit? Browse available trips and dates.</p>`),
        ],
        ctaText: "Explore available dates",
      }),
  },
  {
    key: "win-back-3",
    name: "Welcome Back · One More Invitation",
    category: "follow-up",
    description: "The final follow-up in the welcome-back sequence.",
    subject: "One more invitation, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "Until next time",
        title: "We'd love to see you again",
        body: [
          para(`<p>Hi {first_name},</p><p>This is our last reminder. Find trips and available dates below whenever you're ready to return.</p>`),
        ],
        ctaText: "View experiences",
      }),
  },

  /* ═══ Birthday Special ═══ */
  {
    key: "birthday-special-1",
    name: "Birthday · The Gift",
    category: "promotional",
    description: "Birthday greeting and voucher.",
    subject: "Happy birthday, {first_name}: gift inside",
    blocks: () =>
      shell({
        eyebrow: "It's your day",
        title: "Happy birthday, {first_name}",
        body: [
          para(`<p>Happy birthday! Here's a voucher for your next trip:</p>`),
          voucherPanel("Valid for 30 days."),
        ],
        ctaText: "Use birthday voucher",
      }),
  },
  {
    key: "birthday-special-2",
    name: "Birthday · Voucher Reminder",
    category: "promotional",
    description: "Birthday voucher reminder after two weeks.",
    subject: "Your birthday gift is still waiting, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "Don't leave it unwrapped",
        title: "Your birthday gift expires soon",
        body: [
          para(`<p>Hi {first_name},</p><p>Your unused birthday voucher expires soon:</p>`),
          voucherPanel("Use this code at checkout."),
        ],
        ctaText: "Use voucher",
      }),
  },

  /* ═══ Referral ═══ */
  {
    key: "referral-program-1",
    name: "Referral · Share the Adventure",
    category: "promotional",
    description: "Shareable reward after a positive review.",
    subject: "{first_name}, share the adventure: get rewarded",
    blocks: () =>
      shell({
        eyebrow: "For our favourite people",
        title: "Share a trip",
        body: [
          para(`<p>Hi {first_name},</p><p>Thanks for your review. Here's a reward for sharing your trip:</p>`),
          voucherPanel("Use this code or share it with a friend. You both get a reward when they book."),
        ],
        ctaText: "Plan another trip",
      }),
  },

  /* ═══ Voucher Expiry ═══ */
  {
    key: "voucher-expiry-1",
    name: "Voucher Expiry · 30 Days",
    category: "follow-up",
    description: "Voucher reminder: 30 days left.",
    subject: "Your voucher expires in 30 days",
    blocks: () =>
      shell({
        eyebrow: "30 days remaining",
        title: "30 days left",
        body: [
          para(`<p>Hi {first_name},</p><p>Your voucher expires in 30 days.</p>`),
          voucherPanel("Use on any experience. Book weekends early."),
        ],
        ctaText: "Browse and book",
      }),
  },
  {
    key: "voucher-expiry-2",
    name: "Voucher Expiry · 7 Days",
    category: "promotional",
    description: "Voucher reminder: 7 days left.",
    subject: "7 days left on your voucher",
    blocks: () =>
      shell({
        eyebrow: "One week left",
        title: "7 days left",
        body: [
          para(`<p>Hi {first_name},</p><p>Your voucher expires in 7 days.</p>`),
          voucherPanel("Any experience, any available date inside the week."),
        ],
        ctaText: "Pick my date",
      }),
  },
  {
    key: "voucher-expiry-3",
    name: "Voucher Expiry · Final Day",
    category: "promotional",
    description: "Voucher reminder on its final day.",
    subject: "Final day: your voucher expires tonight",
    blocks: () =>
      shell({
        eyebrow: "Expires today",
        title: "Last call",
        body: [
          para(`<p>Hi {first_name},</p><p>Your voucher expires at midnight. Book today for any future date to use its value.</p>`),
          voucherPanel("Book by midnight for any future date."),
        ],
        ctaText: "Use voucher",
      }),
  },

  /* ═══ VIP ═══ */
  {
    key: "vip-treatment-1",
    name: "VIP · Welcome",
    category: "announcement",
    description: "Explain VIP status and benefits.",
    subject: "Your VIP benefits, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "VIP status unlocked",
        title: "Your VIP benefits",
        body: [
          para(`<p>Hi {first_name},</p><p>Thanks for coming back. You're now a {business_name} VIP, with:</p>`),
          factList([
            "Priority booking on high-demand dates",
            "Early access to new experiences",
            "Exclusive VIP-only offers through the year",
            "Direct contact for special requests",
          ]),
          para(`<p>No points or apps required.</p>`),
        ],
        ctaText: "View trips",
      }),
  },
  {
    key: "vip-treatment-2",
    name: "VIP · Exclusive Offer",
    category: "promotional",
    description: "VIP voucher with an expiry date.",
    subject: "Your VIP offer is here, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "VIP only",
        title: "Your VIP offer",
        body: [
          para(`<p>Hi {first_name},</p><p>Here's your private VIP code:</p>`),
          voucherPanel("VIP offer for any experience or group size."),
        ],
        ctaText: "Book as a VIP",
      }),
  },

  /* ═══ Seasonal Launch ═══ */
  {
    key: "seasonal-launch-1",
    name: "Season · Sneak Peek",
    category: "newsletter",
    description: "Preview routes, gear and season dates.",
    subject: "The new season is almost here",
    blocks: () =>
      shell({
        eyebrow: "Season preview",
        title: "Next season",
        body: [
          para(`<p>Hi {first_name},</p><p>Coming next season:</p>`),
          factList([
            "New routes we scouted in the off-season",
            "Upgraded gear across every experience",
            "Extended tours during the best seasonal conditions",
          ]),
          para(`<p>We'll email a pre-season offer soon.</p>`),
        ],
        ctaText: "Preview the season",
      }),
  },
  {
    key: "seasonal-launch-2",
    name: "Season · Early-Bird Offer",
    category: "promotional",
    description: "Early-bird voucher before bookings open.",
    subject: "Early bird: book before everyone else",
    blocks: () =>
      shell({
        eyebrow: "Before the crowds",
        title: "Book early",
        body: [
          para(`<p>Hi {first_name},</p><p>Thanks for reading the preview. Use this code before public bookings open:</p>`),
          voucherPanel("Valid on all pre-season bookings. Prime dates go first."),
        ],
        ctaText: "Book early",
      }),
  },

  /* ═══ Anniversary ═══ */
  {
    key: "booking-anniversary-1",
    name: "Anniversary · One Year Ago",
    category: "follow-up",
    description: "Invite guests back on their trip anniversary.",
    subject: "{first_name}, remember this time last year?",
    blocks: () =>
      shell({
        eyebrow: "One year ago today",
        title: "A year since your trip",
        body: [
          para(`<p>Hi {first_name},</p><p>A year ago today, you joined us for a trip. Come back for the same experience or try another.</p>`),
        ],
        ctaText: "Book again",
      }),
  },

  /* ═══ Photo Delivery ═══ */
  {
    key: "photo-share-1",
    name: "Photos · Gallery",
    category: "follow-up",
    description: "Send the trip photo gallery.",
    subject: "Your trip photos, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "Fresh from the water",
        title: "Your trip photos",
        body: [
          para(`<p>Hi {first_name},</p><p>Your edited trip photos are ready to download and print.</p>`),
        ],
        ctaText: "View my photos",
      }),
  },
  {
    key: "photo-share-2",
    name: "Photos · Share & Tag Us",
    category: "follow-up",
    description: "Invite guests to share photos and tag you.",
    subject: "Share your trip photos",
    blocks: () =>
      shell({
        eyebrow: "Show it off",
        title: "Share your photos",
        body: [
          para(`<p>Hi {first_name},</p><p>Tag us if you post your trip photos. We share favourites each week.</p>`),
        ],
        ctaText: "Book another trip",
      }),
  },

  /* ═══ Generics (campaign starting points) ═══ */
  {
    name: "Blank Canvas",
    category: "general",
    description: "Blank branded email.",
    subject: "",
    blocks: () =>
      shell({
        eyebrow: "Your label here",
        title: "Your headline here",
        body: [para(`<p>Start writing your email here. Add images, quotes, tour cards and more from the block toolbar.</p>`)],
        ctaText: "Call to action",
      }),
  },
  {
    name: "Newsletter",
    category: "newsletter",
    description: "Monthly news and a booking link.",
    subject: "What's new at {business_name}",
    blocks: () => [
      eyebrow("The monthly dispatch"),
      h1("News from out there"),
      para(`<p>Hi {first_name},</p><p>Here's our latest news.</p>`),
      h2("What's new"),
      factList([
        "New experience or route announcement",
        "A seasonal highlight worth booking early",
        "One great guest story or photo from this month",
      ]),
      gap(4),
      cta("Book your next trip"),
      signoff(),
      gap(10),
      defaultSocial(),
      defaultFooter(),
    ],
  },
  {
    name: "Flash Sale",
    category: "promotional",
    description: "Limited offer with a promo code and deadline.",
    subject: "48 hours: {promo_discount} off everything",
    blocks: () =>
      shell({
        eyebrow: "Limited window",
        title: "48-hour offer",
        body: [
          para(`<p>Hi {first_name},</p><p>Get {promo_discount} off any experience for the next 48 hours with this code:</p>`),
          para(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;"><tr>` +
              `<td style="background:#FDF6EE;border:1px dashed ${AMBER};border-radius:14px;padding:22px 24px;text-align:center;">` +
              `<p style="margin:0 0 6px;font-family:${MONO};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${AMBER};">Promo code</p>` +
              `<p style="margin:0;font-family:Georgia,serif;font-size:30px;letter-spacing:.06em;color:${INK};">{promo_code}</p>` +
              `</td></tr></table>`
          ),
        ],
        ctaText: "Shop the sale",
      }),
  },
];

export function getStarterTemplateByKey(key: string): StarterTemplate | undefined {
  return starterTemplates.find((t) => t.key === key);
}

/* ── Install-time materialization ──────────────────────────────────────────
   Send-time {tokens} above are per-recipient. These fields are per-operator
   and known at install, so they're baked into the blocks once here instead
   of being resolved on every send. */

export interface BusinessBranding {
  email_color?: string | null;
  logo_url?: string | null;
  business_address?: string | null;
  public_phone?: string | null;
  social_facebook?: string | null;
  social_instagram?: string | null;
  social_tiktok?: string | null;
  social_youtube?: string | null;
  social_twitter?: string | null;
  social_linkedin?: string | null;
  social_tripadvisor?: string | null;
  social_google_reviews?: string | null;
}

export interface TourSummary {
  id: string;
  name: string;
  duration_minutes?: number | null;
  image_url?: string | null;
}

function socialsFromBiz(biz: BusinessBranding): Record<string, string> {
  const pairs: [string, string | null | undefined][] = [
    ["facebook", biz.social_facebook],
    ["instagram", biz.social_instagram],
    ["tiktok", biz.social_tiktok],
    ["youtube", biz.social_youtube],
    ["twitter", biz.social_twitter],
    ["linkedin", biz.social_linkedin],
  ];
  const socials: Record<string, string> = {};
  for (const [key, url] of pairs) if (url) socials[key] = url;
  return socials;
}

// Google review link if set, else TripAdvisor, else fall back to the {site_url}
// token (resolved at send time) so the button always goes somewhere useful.
function reviewUrl(biz: BusinessBranding): string {
  return biz.social_google_reviews || biz.social_tripadvisor || "{site_url}";
}

function tourCard(t: TourSummary): Block {
  return {
    type: "tourcard",
    id: uid(),
    imageUrl: t.image_url || "",
    title: t.name,
    price: formatDuration(t.duration_minutes),
    ctaText: "Book this one",
    ctaUrl: "{site_url}/book?tour=" + t.id,
  };
}

export function materializeStarterTemplate(starter: StarterTemplate, biz: BusinessBranding, tours: TourSummary[] = []): Block[] {
  const accent = biz.email_color || PINE;
  const socials = socialsFromBiz(biz);
  const isReviewRequest = !!starter.key?.startsWith("post-tour-review");

  let blocks = starter.blocks().map((b): Block => {
    if (b.type === "button") return { ...b, color: accent, url: isReviewRequest ? reviewUrl(biz) : b.url };
    if (b.type === "social") return Object.keys(socials).length ? { ...b, platforms: socials } : b;
    if (b.type === "footer") {
      return {
        ...b,
        address: biz.business_address || b.address,
        phone: biz.public_phone || b.phone,
        socials: Object.keys(socials).length ? socials : b.socials,
      };
    }
    return b;
  });

  // Show verified tour records without inventing a guest testimonial.
  if (tours.length > 0) {
    const quoteIdx = starter.key === "welcome-series-2"
      ? blocks.findIndex(b => b.type === "text" && b.content.includes("Explore our current tours"))
      : blocks.findIndex((b) => b.type === "quote");
    if (quoteIdx !== -1) {
      blocks = [...blocks.slice(0, quoteIdx + 1), ...tours.slice(0, 3).map(tourCard), ...blocks.slice(quoteIdx + 1)];
    }
  }

  if (biz.logo_url) {
    blocks = [{ type: "image", id: uid(), src: biz.logo_url, alt: "", width: "140px" } as Block, ...blocks];
  }

  return blocks;
}
