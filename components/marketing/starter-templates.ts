import { Block, uid } from "./blocks/block-types";

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
    description: "First touch: who you are, what makes the experience unforgettable, what to expect.",
    subject: "Welcome to {business_name}: your adventure starts here",
    blocks: () =>
      shell({
        eyebrow: "Welcome aboard",
        title: "The best stories start outside",
        body: [
          para(`<p>Hi {first_name},</p><p>Welcome, we're genuinely glad you're here. Every trip we run is built around one idea: an hour outside beats a day of scrolling.</p>`),
          para(`<p>Here's what you can expect from us (and nothing else):</p>`),
          factList([
            "Insider tips on the best conditions, seasons and secret spots",
            "First access to new experiences before they're public",
            "Photos and stories from recent trips: the real thing, unfiltered",
          ]),
        ],
        ctaText: "Browse experiences",
      }),
  },
  {
    key: "welcome-series-2",
    name: "Welcome · Guest Favourites",
    category: "follow-up",
    description: "Second touch: social proof, the most-loved experiences with a real guest quote.",
    subject: "The experiences our guests can't stop talking about",
    blocks: () => [
      eyebrow("Guest favourites"),
      h1("Loved by people like you"),
      para(`<p>Hi {first_name},</p><p>Not sure where to start? These are the trips our guests rebook, gift, and tell their friends about.</p>`),
      { type: "quote", id: uid(), text: "I've lived here my whole life and never seen the coast like this. Booked again before we'd even dried off.", attribution: "Recent guest review", photoUrl: "" } as Block,
      para(`<p>Every experience is small-group, guided, and beginner-friendly. No experience needed, just a sense of adventure.</p>`),
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
    name: "Welcome · First-Booking Gift",
    category: "promotional",
    description: "Conversion touch: a personal discount voucher to turn a subscriber into a first booking.",
    subject: "{first_name}, here's a little push out the door",
    blocks: () =>
      shell({
        eyebrow: "A gift from us",
        title: "Your first adventure, on better terms",
        body: [
          para(`<p>Hi {first_name},</p><p>Talk is cheap, so here's something real. A personal voucher for your first booking with us:</p>`),
          voucherPanel("Apply it at checkout. It's yours alone, and it won't wait forever."),
        ],
        ctaText: "Use my voucher",
      }),
  },

  /* ═══ Post-Tour Review Request ═══ */
  {
    key: "post-tour-review-1",
    name: "Review · Thank You + Ask",
    category: "follow-up",
    description: "Sent hours after the trip: warm thank-you with direct review links.",
    subject: "How was it, {first_name}?",
    blocks: () =>
      shell({
        eyebrow: "Trip complete",
        title: "That was a good one",
        body: [
          para(`<p>Hi {first_name},</p><p>Thank you for coming out with us today. Trips like that are exactly why we do this.</p><p>If you have 30 seconds, a short review makes an outsized difference to a small team like ours. It's how the next adventurer finds us.</p>`),
        ],
        ctaText: "Leave a quick review",
      }),
  },
  {
    key: "post-tour-review-2",
    name: "Review · Gentle Nudge",
    category: "follow-up",
    description: "Follow-up for guests who opened but didn't review: different angle, zero pressure.",
    subject: "One small favour, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "While it's fresh",
        title: "Help the next person take the leap",
        body: [
          para(`<p>Hi {first_name},</p><p>Most people hesitate before booking something new. A review from someone who's actually done it is what tips them over.</p><p>Two sentences is plenty. What you saw, how it felt.</p>`),
        ],
        ctaText: "Write two sentences",
      }),
  },

  /* ═══ Win-Back ═══ */
  {
    key: "win-back-1",
    name: "Win-Back · We Miss You",
    category: "follow-up",
    description: "Nostalgia + what's new since their last visit. No discount yet.",
    subject: "It's been a while, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "Since you've been gone",
        title: "The water hasn't forgotten you",
        body: [
          para(`<p>Hi {first_name},</p><p>It's been a while since your last trip with us, and a lot has changed:</p>`),
          factList([
            "New routes and experiences added this season",
            "Upgraded gear across the fleet",
            "New photo packages so you take the day home with you",
          ]),
          para(`<p>Same ocean, better everything. Come see for yourself.</p>`),
        ],
        ctaText: "See what's new",
      }),
  },
  {
    key: "win-back-2",
    name: "Win-Back · Personal Offer",
    category: "promotional",
    description: "For engaged lapsed customers: a personal comeback voucher.",
    subject: "{first_name}, this one's just for you",
    blocks: () =>
      shell({
        eyebrow: "Welcome-back offer",
        title: "Let's make it easy to come back",
        body: [
          para(`<p>Hi {first_name},</p><p>No long story. We'd love to have you back, so here's a personal voucher to make the decision simple:</p>`),
          voucherPanel("Valid on any experience. Bring a friend; the ocean's big enough."),
        ],
        ctaText: "Book with my voucher",
      }),
  },
  {
    key: "win-back-3",
    name: "Win-Back · Last Chance",
    category: "promotional",
    description: "Final urgency email before the comeback voucher expires.",
    subject: "Your voucher is about to expire, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "Final call",
        title: "It expires. The memories don't.",
        body: [
          para(`<p>Hi {first_name},</p><p>Quick reminder. Your personal voucher is in its final days:</p>`),
          voucherPanel("After it expires, it's gone for good. One booking is all it takes."),
        ],
        ctaText: "Use it before it's gone",
      }),
  },

  /* ═══ Birthday Special ═══ */
  {
    key: "birthday-special-1",
    name: "Birthday · The Gift",
    category: "promotional",
    description: "Birthday greeting with an exclusive voucher: warm, personal, zero corporate.",
    subject: "Happy birthday, {first_name}: gift inside",
    blocks: () =>
      shell({
        eyebrow: "It's your day",
        title: "Happy birthday, {first_name}",
        body: [
          para(`<p>Another year older, another year braver. We think that calls for open water and a bit of salt in the air.</p><p>Our gift to you:</p>`),
          voucherPanel("Valid for 30 days. A birthday should last at least that long."),
        ],
        ctaText: "Claim my birthday trip",
      }),
  },
  {
    key: "birthday-special-2",
    name: "Birthday · Voucher Reminder",
    category: "promotional",
    description: "Two weeks later: the birthday voucher is expiring soon.",
    subject: "Your birthday gift is still waiting, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "Don't leave it unwrapped",
        title: "Your birthday gift expires soon",
        body: [
          para(`<p>Hi {first_name},</p><p>Just a friendly nudge. The birthday voucher we sent you is still unused, and it won't keep forever:</p>`),
          voucherPanel("Belated birthday adventures are still birthday adventures."),
        ],
        ctaText: "Book before it expires",
      }),
  },

  /* ═══ Referral ═══ */
  {
    key: "referral-program-1",
    name: "Referral · Share the Adventure",
    category: "promotional",
    description: "After a positive review: a shareable reward code. They win, their friend wins.",
    subject: "{first_name}, share the adventure: get rewarded",
    blocks: () =>
      shell({
        eyebrow: "For our favourite people",
        title: "Good stories are better shared",
        body: [
          para(`<p>Hi {first_name},</p><p>Thank you for that review. It made the team's week. Since you clearly get it, here's a reward for spreading the word:</p>`),
          voucherPanel("Use it yourself, or share the code with a friend. When they book, you both win."),
        ],
        ctaText: "Plan the next one",
      }),
  },

  /* ═══ Voucher Expiry ═══ */
  {
    key: "voucher-expiry-1",
    name: "Voucher Expiry · 30 Days",
    category: "follow-up",
    description: "First reminder: 30 days to use the voucher, with inspiration.",
    subject: "Your voucher expires in 30 days",
    blocks: () =>
      shell({
        eyebrow: "30 days remaining",
        title: "Don't let a good voucher go to waste",
        body: [
          para(`<p>Hi {first_name},</p><p>A heads-up from your calendar's best friend: your voucher has 30 days left on the clock.</p>`),
          voucherPanel("Fully redeemable against any experience. Weekends fill first, so book early."),
        ],
        ctaText: "Browse and book",
      }),
  },
  {
    key: "voucher-expiry-2",
    name: "Voucher Expiry · 7 Days",
    category: "promotional",
    description: "One week left: urgency rising, concrete suggestions.",
    subject: "7 days left on your voucher",
    blocks: () =>
      shell({
        eyebrow: "One week left",
        title: "Seven days. One decision.",
        body: [
          para(`<p>Hi {first_name},</p><p>Your voucher expires in 7 days. That's one weekend, enough time to do something worth telling people about.</p>`),
          voucherPanel("Any experience, any available date inside the week."),
        ],
        ctaText: "Pick my date",
      }),
  },
  {
    key: "voucher-expiry-3",
    name: "Voucher Expiry · Final Day",
    category: "promotional",
    description: "Expiry-day email: direct, short, one job.",
    subject: "Final day: your voucher expires tonight",
    blocks: () =>
      shell({
        eyebrow: "Expires today",
        title: "Last call",
        body: [
          para(`<p>Hi {first_name},</p><p>Short and honest: your voucher expires at midnight tonight. Book now and pick any future date. The value is locked in the moment you book.</p>`),
          voucherPanel("Book today, paddle whenever. After midnight it's gone."),
        ],
        ctaText: "Redeem it now",
      }),
  },

  /* ═══ VIP ═══ */
  {
    key: "vip-treatment-1",
    name: "VIP · Welcome to the Inner Circle",
    category: "announcement",
    description: "Tells your best customers they've been upgraded, and what VIP actually means.",
    subject: "{first_name}, you're one of ours now",
    blocks: () =>
      shell({
        eyebrow: "VIP status unlocked",
        title: "Welcome to the inner circle",
        body: [
          para(`<p>Hi {first_name},</p><p>Some guests come once. You keep coming back, and we notice. As of today you're a {business_name} VIP. Concretely, that means:</p>`),
          factList([
            "Priority booking on high-demand dates",
            "Early access to new experiences before public release",
            "Exclusive VIP-only offers through the year",
            "A direct line to our team for special requests",
          ]),
          para(`<p>No points, no apps, no fine print. Just first pick of the good stuff.</p>`),
        ],
        ctaText: "See what's coming up",
      }),
  },
  {
    key: "vip-treatment-2",
    name: "VIP · Exclusive Offer",
    category: "promotional",
    description: "The VIP-only voucher: generous, personal, time-boxed.",
    subject: "Your VIP offer is here, {first_name}",
    blocks: () =>
      shell({
        eyebrow: "VIP only",
        title: "This one isn't public",
        body: [
          para(`<p>Hi {first_name},</p><p>As promised, a VIP-only thank you. This code doesn't appear on the site, in ads, or anywhere else:</p>`),
          voucherPanel("VIP-exclusive. Use it on any experience, any group size."),
        ],
        ctaText: "Book as a VIP",
      }),
  },

  /* ═══ Seasonal Launch ═══ */
  {
    key: "seasonal-launch-1",
    name: "Season · Sneak Peek",
    category: "newsletter",
    description: "Season preview: new routes, gear, and dates before booking opens.",
    subject: "The new season is almost here",
    blocks: () =>
      shell({
        eyebrow: "Season preview",
        title: "We've been busy all winter",
        body: [
          para(`<p>Hi {first_name},</p><p>The new season is around the corner, and this is your early look at what's coming:</p>`),
          factList([
            "New routes we scouted in the off-season",
            "Upgraded gear across every experience",
            "Extended seasonal tours while conditions are at their best",
          ]),
          para(`<p>Early birds get first pick. An exclusive pre-season offer lands in your inbox soon.</p>`),
        ],
        ctaText: "Preview the season",
      }),
  },
  {
    key: "seasonal-launch-2",
    name: "Season · Early-Bird Offer",
    category: "promotional",
    description: "Early-bird voucher for engaged readers before public booking opens.",
    subject: "Early bird: book before everyone else",
    blocks: () =>
      shell({
        eyebrow: "Before the crowds",
        title: "First pick goes to the early birds",
        body: [
          para(`<p>Hi {first_name},</p><p>You opened the preview, so you get the head start. Book with this code before the season opens to everyone else:</p>`),
          voucherPanel("Valid on all pre-season bookings. Prime dates go first."),
        ],
        ctaText: "Claim my early-bird spot",
      }),
  },

  /* ═══ Anniversary ═══ */
  {
    key: "booking-anniversary-1",
    name: "Anniversary · One Year Ago",
    category: "follow-up",
    description: "\"This time last year\" nostalgia with a nudge to make it a tradition.",
    subject: "{first_name}, remember this time last year?",
    blocks: () =>
      shell({
        eyebrow: "One year ago today",
        title: "Some days deserve a sequel",
        body: [
          para(`<p>Hi {first_name},</p><p>Exactly a year ago, you were out there with us. We think that day deserves an anniversary, and traditions have to start somewhere.</p><p>Same trip, new season? Or something you haven't tried yet?</p>`),
        ],
        ctaText: "Book the sequel",
      }),
  },

  /* ═══ Photo Delivery ═══ */
  {
    key: "photo-share-1",
    name: "Photos · Your Trip Photos Are Ready",
    category: "follow-up",
    description: "Delivers the trip photo gallery link: the email guests actually want.",
    subject: "Your trip photos are ready, {first_name} 📸",
    blocks: () =>
      shell({
        eyebrow: "Fresh from the water",
        title: "You look good out there",
        body: [
          para(`<p>Hi {first_name},</p><p>Your photos from the trip are edited and ready. Download them, keep them, print the good ones. They're yours.</p>`),
        ],
        ctaText: "View my photos",
      }),
  },
  {
    key: "photo-share-2",
    name: "Photos · Share & Tag Us",
    category: "follow-up",
    description: "Follow-up: encourage social sharing and tagging for reach.",
    subject: "That photo deserves an audience",
    blocks: () =>
      shell({
        eyebrow: "Show it off",
        title: "Don't let them sit in your camera roll",
        body: [
          para(`<p>Hi {first_name},</p><p>The best trip photos are the ones that make someone else book their own. If you post yours, tag us. We share our favourites every week, and yours is a contender.</p>`),
        ],
        ctaText: "Book your next shot",
      }),
  },

  /* ═══ Generics (campaign starting points) ═══ */
  {
    name: "Blank Canvas",
    category: "general",
    description: "A clean, branded starting point: eyebrow, headline, body, button.",
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
    description: "Monthly update: a story, a list of what's new, one clear call to action.",
    subject: "What's new at {business_name}",
    blocks: () => [
      eyebrow("The monthly dispatch"),
      h1("News from out there"),
      para(`<p>Hi {first_name},</p><p>Here's what's been happening, the short version, no fluff.</p>`),
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
    description: "Short-window promotion with a promo code and hard deadline.",
    subject: "48 hours: {promo_discount} off everything",
    blocks: () =>
      shell({
        eyebrow: "Limited window",
        title: "Blink and it's gone",
        body: [
          para(`<p>Hi {first_name},</p><p>For the next 48 hours, every experience is {promo_discount} off with the code below. No fine print. Pick a date and go.</p>`),
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
