import { Block, uid } from "./blocks/block-types";

export interface StarterTemplate {
  name: string;
  category: string;
  description: string;
  subject: string;
  blocks: () => Block[];
}

const defaultFooter = (): Block => ({
  type: "footer",
  id: uid(),
  companyName: "{company_name}",
  address: "",
  phone: "",
  socials: { facebook: "", instagram: "" },
});

const defaultSocial = (): Block => ({
  type: "social",
  id: uid(),
  platforms: { facebook: "", instagram: "", whatsapp: "" },
});

export const starterTemplates: StarterTemplate[] = [
  /* ── 1 — Blank Canvas ── */
  {
    name: "Blank Canvas",
    category: "general",
    description: "A clean starting point with essential structure.",
    subject: "",
    blocks: () => [
      { type: "header", id: uid(), text: "Your Headline Here", level: "h1", color: "#111827" },
      { type: "text", id: uid(), content: "<p>Start writing your email content here. You can add images, buttons, and more using the block toolbar above.</p>" },
      { type: "button", id: uid(), text: "Call to Action", url: "https://your-booking-site.bookingtours.co.za", color: "#111827" },
      defaultFooter(),
    ],
  },

  /* ── 2 — Welcome Email ── */
  {
    name: "Welcome Email",
    category: "follow-up",
    description: "A warm first impression for new subscribers.",
    subject: "Welcome — here's what to expect",
    blocks: () => [
      { type: "header", id: uid(), text: "Welcome Aboard", level: "h1", color: "#0f172a" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>Thanks for signing up! We're excited to have you with us.</p><p>Here's what you can look forward to:</p><ul><li>Exclusive offers and early access to new experiences</li><li>Seasonal updates and insider tips</li><li>Photos and stories from recent trips</li></ul><p>In the meantime, take a look at what we have on offer.</p>" },
      { type: "button", id: uid(), text: "Browse Experiences", url: "https://your-booking-site.bookingtours.co.za", color: "#0f172a" },
      { type: "spacer", id: uid(), height: 16 },
      defaultSocial(),
      defaultFooter(),
    ],
  },

  /* ── 3 — Newsletter ── */
  {
    name: "Newsletter",
    category: "newsletter",
    description: "A polished two-column layout for regular updates.",
    subject: "This month's highlights",
    blocks: () => [
      { type: "header", id: uid(), text: "Monthly Highlights", level: "h1", color: "#0f172a" },
      { type: "text", id: uid(), content: "<p>Hi {first_name}, here's a roundup of what's been happening and what's coming up next.</p>" },
      { type: "divider", id: uid() },
      {
        type: "columns", id: uid(), columnCount: 2, columns: [
          [
            { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&q=80", alt: "Featured experience", width: "100%" } as Block,
            { type: "text", id: uid(), content: "<p><strong>Featured This Month</strong></p><p>Our most popular experience is back for the new season — with limited availability. Don't miss out.</p>" } as Block,
          ],
          [
            { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=600&q=80", alt: "What's new", width: "100%" } as Block,
            { type: "text", id: uid(), content: "<p><strong>What's New</strong></p><p>We've added a brand new experience to the lineup. Perfect for groups, families, or solo adventurers.</p>" } as Block,
          ],
        ],
      },
      { type: "button", id: uid(), text: "View All Experiences", url: "https://your-booking-site.bookingtours.co.za", color: "#0f172a" },
      defaultFooter(),
    ],
  },

  /* ── 4 — Flash Sale ── */
  {
    name: "Flash Sale",
    category: "promotional",
    description: "Drive urgency with a countdown and bold styling.",
    subject: "Flash sale — 25% off for 48 hours",
    blocks: () => [
      { type: "header", id: uid(), text: "Flash Sale — 25% Off", level: "h1", color: "#dc2626" },
      { type: "countdown", id: uid(), targetDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16), label: "Offer expires in" },
      { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1472745433479-4556f22e32c2?w=800&q=80", alt: "Special offer", width: "100%" },
      { type: "text", id: uid(), content: "<p>For 48 hours only, every experience is <strong>25% off</strong>. Whether it's a morning outing, a sunset adventure, or a full-day expedition — now is the time to book.</p><p>Use code <strong>FLASH25</strong> at checkout.</p>" },
      { type: "button", id: uid(), text: "Shop the Sale", url: "https://your-booking-site.bookingtours.co.za", color: "#dc2626" },
      defaultFooter(),
    ],
  },

  /* ── 5 — Event Invitation ── */
  {
    name: "Event Invitation",
    category: "announcement",
    description: "Announce a special event with all the details.",
    subject: "You're invited — save the date",
    blocks: () => [
      { type: "header", id: uid(), text: "You're Invited", level: "h1", color: "#1e40af" },
      { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80", alt: "Upcoming event", width: "100%" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>We're hosting a special event and we'd love for you to join us.</p><p><strong>Date:</strong> TBC<br/><strong>Time:</strong> TBC<br/><strong>Location:</strong> TBC</p><p>Spaces are limited — reserve yours now.</p>" },
      { type: "countdown", id: uid(), targetDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16), label: "Event starts in" },
      { type: "button", id: uid(), text: "Reserve Your Spot", url: "https://your-booking-site.bookingtours.co.za", color: "#1e40af" },
      defaultSocial(),
      defaultFooter(),
    ],
  },

  /* ── 6 — Post-Trip Follow-up ── */
  {
    name: "Post-Trip Follow-up",
    category: "follow-up",
    description: "Thank customers and ask for a review.",
    subject: "Thanks for joining us, {first_name}!",
    blocks: () => [
      { type: "header", id: uid(), text: "Thanks for Joining Us", level: "h1", color: "#0f172a" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>We hope you had an incredible time! Your support means the world to our team.</p><p>If you enjoyed the experience, we'd love to hear about it. A quick review helps us improve and lets others know what to expect.</p>" },
      { type: "quote", id: uid(), text: "Absolutely amazing! The guides were fantastic and the views were breathtaking. Can't wait to come back!", attribution: "Happy Customer", photoUrl: "" },
      { type: "button", id: uid(), text: "Leave a Review", url: "https://your-booking-site.bookingtours.co.za", color: "#0f172a" },
      defaultFooter(),
    ],
  },

  /* ── 7 — Birthday Treat ── */
  {
    name: "Birthday Treat",
    category: "promotional",
    description: "Celebrate subscribers' birthdays with a personal offer.",
    subject: "Happy Birthday, {first_name}! Here's a gift",
    blocks: () => [
      { type: "header", id: uid(), text: "Happy Birthday!", level: "h1", color: "#7c3aed" },
      { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800&q=80", alt: "Birthday celebration", width: "100%" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>It's your special day! As a thank you for being part of our community, here's a <strong>15% birthday discount</strong> on any experience.</p><p>Valid for the next 30 days — treat yourself or share it with a friend.</p>" },
      { type: "button", id: uid(), text: "Redeem Your Gift", url: "https://your-booking-site.bookingtours.co.za", color: "#7c3aed" },
      defaultFooter(),
    ],
  },

  /* ── 8 — Win-Back ── */
  {
    name: "Win-Back",
    category: "follow-up",
    description: "Re-engage inactive subscribers with a personal touch.",
    subject: "It's been a while, {first_name}",
    blocks: () => [
      { type: "header", id: uid(), text: "We Miss You", level: "h1", color: "#0891b2" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>It's been a while since we last saw you, and we'd love to have you back.</p><p>Here's a little something to sweeten the deal: <strong>10% off</strong> your next booking with code <strong>COMEBACK10</strong>.</p>" },
      { type: "button", id: uid(), text: "Book Again", url: "https://your-booking-site.bookingtours.co.za", color: "#0891b2" },
      { type: "spacer", id: uid(), height: 20 },
      { type: "text", id: uid(), content: "<p style=\"text-align:center;font-size:13px;\">Not interested anymore? No worries — you can update your preferences or unsubscribe below.</p>" },
      defaultFooter(),
    ],
  },

  /* ── 9 — Feedback Request ── */
  {
    name: "Feedback Request",
    category: "follow-up",
    description: "A clean, focused ask for customer feedback.",
    subject: "Quick question, {first_name}",
    blocks: () => [
      { type: "header", id: uid(), text: "How Did We Do?", level: "h1", color: "#059669" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>Your feedback helps us get better. It only takes 2 minutes and makes a real difference.</p>" },
      { type: "button", id: uid(), text: "Share Your Feedback", url: "https://your-booking-site.bookingtours.co.za", color: "#059669" },
      { type: "spacer", id: uid(), height: 16 },
      defaultSocial(),
      defaultFooter(),
    ],
  },

  /* ── 10 — Seasonal Promo ── */
  {
    name: "Seasonal Promo",
    category: "promotional",
    description: "Showcase top experiences with tour cards and a countdown.",
    subject: "Seasonal deals — limited time only",
    blocks: () => [
      { type: "header", id: uid(), text: "Seasonal Specials", level: "h1", color: "#b91c1c" },
      { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80", alt: "Seasonal deals", width: "100%" },
      { type: "countdown", id: uid(), targetDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16), label: "Deal ends in" },
      { type: "tourcard", id: uid(), imageUrl: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&q=80", title: "Featured Experience", price: "R 450", ctaText: "Book Now", ctaUrl: "https://your-booking-site.bookingtours.co.za" },
      { type: "button", id: uid(), text: "View All Deals", url: "https://your-booking-site.bookingtours.co.za", color: "#b91c1c" },
      defaultFooter(),
    ],
  },

  /* ── 11 — Experience Showcase ── */
  {
    name: "Experience Showcase",
    category: "promotional",
    description: "Highlight your best experiences with tour cards.",
    subject: "Our top-rated experiences",
    blocks: () => [
      { type: "header", id: uid(), text: "Our Most Popular Experiences", level: "h1", color: "#0f172a" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>Looking for your next adventure? Here are our most-loved experiences — handpicked by our team and rated highly by past guests.</p>" },
      { type: "tourcard", id: uid(), imageUrl: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&q=80", title: "Signature Experience", price: "R 450", ctaText: "Book Now", ctaUrl: "https://your-booking-site.bookingtours.co.za" },
      { type: "spacer", id: uid(), height: 12 },
      { type: "tourcard", id: uid(), imageUrl: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=600&q=80", title: "Premium Adventure", price: "R 650", ctaText: "Book Now", ctaUrl: "https://your-booking-site.bookingtours.co.za" },
      { type: "button", id: uid(), text: "View All Experiences", url: "https://your-booking-site.bookingtours.co.za", color: "#0f172a" },
      defaultSocial(),
      defaultFooter(),
    ],
  },
];
