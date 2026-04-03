import { Block, uid } from "./blocks/block-types";

export interface StarterTemplate {
  name: string;
  category: string;
  description: string;
  subject: string;
  blocks: () => Block[];
}

var defaultFooter = (): Block => ({
  type: "footer",
  id: uid(),
  companyName: "Cape Kayak",
  address: "V&A Waterfront, Cape Town",
  phone: "+27 21 555 0123",
  socials: { facebook: "https://facebook.com/capekayak", instagram: "https://instagram.com/capekayak" },
});

var defaultSocial = (): Block => ({
  type: "social",
  id: uid(),
  platforms: { facebook: "https://facebook.com/capekayak", instagram: "https://instagram.com/capekayak", whatsapp: "https://wa.me/27215550123" },
});

export var starterTemplates: StarterTemplate[] = [
  /* 1 — Blank */
  {
    name: "Blank",
    category: "general",
    description: "Start from scratch with a blank canvas.",
    subject: "",
    blocks: () => [
      { type: "text", id: uid(), content: "<p>Start writing your email here...</p>" },
    ],
  },

  /* 2 — Welcome Email */
  {
    name: "Welcome Email",
    category: "follow-up",
    description: "Greet new subscribers and introduce your brand.",
    subject: "Welcome to Cape Kayak!",
    blocks: () => [
      { type: "header", id: uid(), text: "Welcome to Cape Kayak!", level: "h1", color: "#0f5dd7" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>Thanks for joining the Cape Kayak family! We're thrilled to have you on board. From sunset paddles along the Atlantic coast to unforgettable whale watching trips, there's so much to explore.</p><p>Stay tuned for exclusive offers, tour updates, and paddling tips straight to your inbox.</p>" },
      { type: "button", id: uid(), text: "View Our Tours", url: "https://your-booking-site.bookingtours.co.za", color: "#0f5dd7" },
      defaultSocial(),
      defaultFooter(),
    ],
  },

  /* 3 — Newsletter */
  {
    name: "Newsletter",
    category: "newsletter",
    description: "A classic newsletter layout with columns and featured content.",
    subject: "Cape Kayak Monthly Update",
    blocks: () => [
      { type: "header", id: uid(), text: "Cape Kayak Monthly", level: "h1", color: "#111827" },
      { type: "text", id: uid(), content: "<p>Hi {first_name}, here's what's been happening at Cape Kayak this month.</p>" },
      { type: "divider", id: uid() },
      {
        type: "columns", id: uid(), columnCount: 2, columns: [
          [
            { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600", alt: "Kayaking at sunset", width: "100%" } as Block,
            { type: "text", id: uid(), content: "<p><strong>Sunset Paddles Are Back</strong></p><p>Our most popular evening tour returns for the summer season. Limited spots available.</p>" } as Block,
          ],
          [
            { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=600", alt: "Whale watching from kayak", width: "100%" } as Block,
            { type: "text", id: uid(), content: "<p><strong>Whale Season Update</strong></p><p>Southern right whales have been spotted along the coast. Book your whale watching paddle today!</p>" } as Block,
          ],
        ],
      },
      { type: "button", id: uid(), text: "Read More on Our Blog", url: "https://your-booking-site.bookingtours.co.za", color: "#0f5dd7" },
      defaultFooter(),
    ],
  },

  /* 4 — Promotional Sale */
  {
    name: "Promotional Sale",
    category: "promotional",
    description: "Drive urgency with a countdown timer and bold offer.",
    subject: "Summer Special - 25% Off All Tours!",
    blocks: () => [
      { type: "header", id: uid(), text: "Summer Special - 25% Off!", level: "h1", color: "#dc2626" },
      { type: "countdown", id: uid(), targetDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16), label: "Offer ends in" },
      { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1472745433479-4556f22e32c2?w=800", alt: "Kayakers on open water", width: "100%" },
      { type: "text", id: uid(), content: "<p>For a limited time only, enjoy <strong>25% off</strong> all Cape Kayak tours. Whether it's a family paddle, a sunrise expedition, or a guided whale watching trip — now is the perfect time to get on the water.</p><p>Use code <strong>SUMMER25</strong> at checkout.</p>" },
      { type: "button", id: uid(), text: "Claim Your Discount", url: "https://your-booking-site.bookingtours.co.za", color: "#dc2626" },
      defaultFooter(),
    ],
  },

  /* 5 — Event Announcement */
  {
    name: "Event Announcement",
    category: "announcement",
    description: "Announce an upcoming event with a countdown and details.",
    subject: "You're Invited: Full Moon Paddle",
    blocks: () => [
      { type: "header", id: uid(), text: "Full Moon Paddle Experience", level: "h1", color: "#1e40af" },
      { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800", alt: "Full moon over the ocean", width: "100%" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>Join us for a magical evening on the water! Paddle under the full moon along Cape Town's coastline with our experienced guides. Hot chocolate and snacks included.</p><p><strong>Date:</strong> Saturday, 15 February 2026<br/><strong>Time:</strong> 7:00 PM - 9:30 PM<br/><strong>Meeting point:</strong> V&A Waterfront Jetty</p>" },
      { type: "countdown", id: uid(), targetDate: "2026-02-15T19:00:00", label: "Event starts in" },
      { type: "button", id: uid(), text: "Reserve Your Spot", url: "https://your-booking-site.bookingtours.co.za", color: "#1e40af" },
      defaultSocial(),
      defaultFooter(),
    ],
  },

  /* 6 — Booking Follow-up */
  {
    name: "Booking Follow-up",
    category: "follow-up",
    description: "Thank customers after their tour with a review prompt.",
    subject: "Thanks for paddling with us, {first_name}!",
    blocks: () => [
      { type: "header", id: uid(), text: "Thanks for Paddling With Us!", level: "h1", color: "#0f5dd7" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>We hope you had an incredible time on the water with Cape Kayak! Your support means the world to our small team of ocean lovers.</p><p>We'd love to hear how your experience was. Your feedback helps us keep improving and lets other adventurers know what to expect.</p>" },
      { type: "quote", id: uid(), text: "Absolutely breathtaking! The guides were fantastic and the views were unreal. Can't wait to come back!", attribution: "Sarah M., Sunset Paddle", photoUrl: "" },
      { type: "button", id: uid(), text: "Leave a Review", url: "https://g.page/capekayak/review", color: "#0f5dd7" },
      defaultFooter(),
    ],
  },

  /* 7 — Birthday */
  {
    name: "Birthday",
    category: "promotional",
    description: "Celebrate a birthday with a gift or discount.",
    subject: "Happy Birthday, {first_name}! A gift for you",
    blocks: () => [
      { type: "header", id: uid(), text: "Happy Birthday, {first_name}!", level: "h1", color: "#9333ea" },
      { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=800", alt: "Celebration", width: "100%" },
      { type: "text", id: uid(), content: "<p>It's your special day and we want to celebrate with you! As a thank you for being part of the Cape Kayak family, here's a <strong>15% birthday discount</strong> on any tour.</p><p>Valid for the next 30 days. Treat yourself (or a friend!) to an adventure on the water.</p>" },
      { type: "button", id: uid(), text: "Redeem Your Birthday Gift", url: "https://your-booking-site.bookingtours.co.za", color: "#9333ea" },
      defaultFooter(),
    ],
  },

  /* 8 — Re-engagement */
  {
    name: "Re-engagement",
    category: "follow-up",
    description: "Win back inactive subscribers with a personal touch.",
    subject: "We miss you, {first_name}!",
    blocks: () => [
      { type: "header", id: uid(), text: "We Miss You!", level: "h1", color: "#0891b2" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>It's been a while since your last paddle with us and we'd love to see you back on the water. Cape Town's coastline is calling!</p><p>As a welcome-back treat, enjoy <strong>10% off</strong> your next booking with code <strong>COMEBACK10</strong>.</p>" },
      { type: "button", id: uid(), text: "Book Your Next Adventure", url: "https://your-booking-site.bookingtours.co.za", color: "#0891b2" },
      { type: "spacer", id: uid(), height: 24 },
      { type: "text", id: uid(), content: "<p style=\"text-align:center;\">Not interested in kayaking anymore? No worries — you can update your preferences or unsubscribe below.</p>" },
      defaultFooter(),
    ],
  },

  /* 9 — Feedback Request */
  {
    name: "Feedback Request",
    category: "follow-up",
    description: "Ask customers for feedback to improve your service.",
    subject: "We'd love your feedback, {first_name}",
    blocks: () => [
      { type: "header", id: uid(), text: "How Did We Do?", level: "h1", color: "#059669" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>Your opinion matters to us! We're always looking for ways to make the Cape Kayak experience even better. It only takes 2 minutes to share your thoughts.</p>" },
      { type: "button", id: uid(), text: "Share Your Feedback", url: "https://your-booking-site.bookingtours.co.za", color: "#059669" },
      { type: "spacer", id: uid(), height: 20 },
      defaultSocial(),
      defaultFooter(),
    ],
  },

  /* 10 — Holiday Special */
  {
    name: "Holiday Special",
    category: "promotional",
    description: "Seasonal promotion with a tour card and countdown.",
    subject: "Holiday Special: Exclusive Tour Deals!",
    blocks: () => [
      { type: "header", id: uid(), text: "Holiday Specials Are Here!", level: "h1", color: "#b91c1c" },
      { type: "image", id: uid(), src: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800", alt: "Holiday adventure on the water", width: "100%" },
      { type: "countdown", id: uid(), targetDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16), label: "Holiday deal ends in" },
      { type: "tourcard", id: uid(), imageUrl: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600", title: "Sunset Paddle", price: "R 450", ctaText: "Book Now", ctaUrl: "https://your-booking-site.bookingtours.co.za" },
      { type: "button", id: uid(), text: "View All Holiday Deals", url: "https://your-booking-site.bookingtours.co.za", color: "#b91c1c" },
      defaultFooter(),
    ],
  },

  /* 11 — Tour Showcase */
  {
    name: "Tour Showcase",
    category: "promotional",
    description: "Highlight multiple tours with cards and booking links.",
    subject: "Explore Our Top Tours",
    blocks: () => [
      { type: "header", id: uid(), text: "Our Most Popular Tours", level: "h1", color: "#0f5dd7" },
      { type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>Looking for your next adventure? Check out our most-loved experiences on the water. Each tour is led by certified guides who know the Cape Town coastline inside out.</p>" },
      { type: "tourcard", id: uid(), imageUrl: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600", title: "Sunset Paddle", price: "R 450", ctaText: "Book Now", ctaUrl: "https://your-booking-site.bookingtours.co.za" },
      { type: "spacer", id: uid(), height: 16 },
      { type: "tourcard", id: uid(), imageUrl: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=600", title: "Whale Watching Kayak Tour", price: "R 650", ctaText: "Book Now", ctaUrl: "https://your-booking-site.bookingtours.co.za" },
      { type: "button", id: uid(), text: "View All Tours", url: "https://your-booking-site.bookingtours.co.za", color: "#0f5dd7" },
      defaultSocial(),
      defaultFooter(),
    ],
  },
];
