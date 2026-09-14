"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { confirmAction, notify } from "../../lib/app-notify";
import { useBusinessContext } from "../../../components/BusinessContext";
import { getStarterTemplateByKey, materializeStarterTemplate } from "../../../components/marketing/starter-templates";
import { blocksToHtml } from "../../../components/marketing/blocks/blocks-to-html";
import { stepSentence, triggerSentence, flowSummary, type AutomationStep } from "../../lib/automation-copy";
import {
  Trash, Play, Pause,
} from "@phosphor-icons/react";

interface Automation {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config: any;
  status: string;
  enrolled_count: number;
  completed_count: number;
  created_at: string;
  description: string | null;
  steps: AutomationStep[];
  sentLast7Days: number;
}

const triggerBadge: Record<string, { pill: string; label: string }> = {
  contact_added: { pill: "ui-pill-ocean", label: "Contact Added" },
  tag_added: { pill: "ui-pill-accent", label: "Tag Added" },
  post_booking: { pill: "ui-pill-success", label: "Post Booking" },
  date_field: { pill: "ui-pill-amber", label: "Date Field" },
  manual: { pill: "ui-pill-neutral", label: "Manual" },
};

const statusBadge: Record<string, { pill: string }> = {
  draft: { pill: "ui-pill-neutral" },
  active: { pill: "ui-pill-success" },
  paused: { pill: "ui-pill-warning" },
  archived: { pill: "ui-pill-danger" },
};

/* ─── AUTOMATION TEMPLATE CATALOG ─── */

interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  benefit: string;
  tier: "must-have" | "high-value" | "growth";
  triggerType: string;
  triggerConfig: Record<string, any>;
  steps: { step_type: string; config: Record<string, any> }[];
  howItWorks: string[];
  exampleEmail: string;
}

const TEMPLATES: AutomationTemplate[] = [
  {
    key: "welcome-series",
    name: "Welcome Series",
    description: "Greet new subscribers with your brand story, showcase your best tours, and convert them into first-time bookers with a special discount.",
    benefit: "Welcome flows generate R21+ revenue per recipient. Sets the tone for your entire customer relationship.",

    tier: "must-have",
    triggerType: "contact_added",
    triggerConfig: {},
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "Welcome to {business_name}: Your Adventure Starts Here" } },
      { step_type: "delay", config: { duration: 3, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Our Most Popular Tours: See Why Guests Love Us" } },
      { step_type: "delay", config: { duration: 4, unit: "days" } },
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 10, code_prefix: "WELCOME", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, Here's 10% Off Your First Booking" } },
    ],
    howItWorks: [
      "New contact is added to your list (manual, import, or booking sync)",
      "Immediately sends a welcome email with your brand story and what makes you unique",
      "After 3 days, sends a showcase of your most popular tours with guest reviews",
      "After 4 more days, generates a unique 10% discount voucher and sends a conversion email",
      "Contacts who book within 30 days use their voucher; those who don't, you can re-engage later",
    ],
    exampleEmail: "Subject: Welcome to {business_name}: Your Adventure Starts Here\n\nHi {first_name},\n\nWelcome! We're so glad you're here.\n\nAt {business_name}, we believe everyone deserves a real experience, not another day of scrolling. Every trip we run is a story waiting to happen.\n\nHere's what to expect from us:\n- Insider tips on the best times to go\n- Exclusive offers and early access to new tours\n- Stories and photos from recent trips\n\nReady to start? Browse our tours and find your next adventure.\n\n[Browse Tours]",
  },
  {
    key: "post-tour-review",
    name: "Post-Tour Review Request",
    description: "Automatically ask for Google/TripAdvisor reviews while the experience is still fresh. Includes a follow-up nudge for those who didn't respond.",
    benefit: "Guests asked for reviews are 3x more likely to leave one. Reviews are your #1 marketing asset. They directly drive new bookings.",

    tier: "must-have",
    triggerType: "tag_added",
    triggerConfig: { tag: "completed-tour" },
    steps: [
      { step_type: "delay", config: { duration: 3, unit: "hours" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "How Was Your Experience, {first_name}?" } },
      { step_type: "delay", config: { duration: 5, unit: "days" } },
      { step_type: "condition", config: { condition_type: "opened_email", value: "" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Quick Favour: Your Review Helps Other Adventurers" } },
    ],
    howItWorks: [
      "When a booking is completed, the contact gets tagged 'completed-tour' (via auto-messages or manual)",
      "Waits 3 hours so the guest is home but the experience is still vivid",
      "Sends a thank-you email with direct links to leave a Google or TripAdvisor review",
      "After 5 days, checks if the first email was opened",
      "If opened but no review yet, sends a gentle reminder with a different angle",
    ],
    exampleEmail: "Subject: How Was Your Experience, Sarah?\n\nHi Sarah,\n\nThank you for joining us today! We hope you had an amazing time.\n\nWe'd love to hear what you thought. A quick review helps other adventurers discover us and means the world to our small team.\n\nIt only takes 30 seconds:\n\n[Leave a Google Review] [Leave a TripAdvisor Review]\n\nThank you for being part of our story!",
  },
  {
    key: "win-back",
    name: "Win-Back Campaign",
    description: "Re-engage customers who haven't booked in 90+ days with a 3-step escalating sequence: nostalgia, then incentive, then final offer.",
    benefit: "It costs 5x more to acquire a new customer than re-engage an existing one. Win-back emails recover 10-15% of lapsed customers.",

    tier: "must-have",
    triggerType: "tag_added",
    triggerConfig: { tag: "lapsed-90-days" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "We Miss You, {first_name}! See What's New" } },
      { step_type: "delay", config: { duration: 14, unit: "days" } },
      { step_type: "condition", config: { condition_type: "opened_email", value: "" } },
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 15, code_prefix: "COMEBACK", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, Here's 15% Off Just for You" } },
      { step_type: "delay", config: { duration: 21, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Last Chance: Your Exclusive Discount Expires Soon" } },
    ],
    howItWorks: [
      "Contacts tagged 'lapsed-90-days' enter the flow (tag via re-engagement cron or manual)",
      "Email 1: 'We miss you' with highlights of new tours, recent photos, what's changed",
      "After 14 days, checks if they opened email 1",
      "If they opened it, generates a 15% off voucher and sends a personalized offer",
      "After 21 more days, sends a final 'last chance' email with urgency on the expiring voucher",
    ],
    exampleEmail: "Subject: We Miss You, James! See What's New\n\nHi James,\n\nIt's been a while since your last adventure with us, and we've been busy!\n\nHere's what's new:\n- A new tour that's already our most popular\n- Upgraded gear for maximum comfort\n- New routes and experiences added this season\n\nWe'd love to see you back. Ready for your next trip?\n\n[Browse Tours]",
  },
  {
    key: "birthday-special",
    name: "Birthday Special",
    description: "Delight customers on their birthday with a personalised greeting and exclusive discount voucher. Runs automatically every year.",
    benefit: "Birthday emails generate 342% higher revenue per email than standard promotions, with 45%+ open rates.",

    tier: "high-value",
    triggerType: "date_field",
    triggerConfig: { field: "date_of_birth", days_before: 0 },
    steps: [
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 15, code_prefix: "BDAY", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Happy Birthday, {first_name}! Here's a Gift From Us" } },
      { step_type: "delay", config: { duration: 14, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Birthday Voucher Expires Soon. Don't Miss Out!" } },
    ],
    howItWorks: [
      "On each contact's birthday (requires date_of_birth field), the automation triggers",
      "Generates a unique 15% off voucher code with 'BDAY' prefix, valid for 30 days",
      "Immediately sends a birthday greeting email with the voucher details",
      "After 14 days, sends a reminder that the birthday voucher is expiring soon",
      "Runs every year automatically, with no manual effort needed",
    ],
    exampleEmail: "Subject: Happy Birthday, Emma! Here's a Gift From Us\n\nHi Emma,\n\nHappy Birthday! We hope your day is as good as your best trip with us.\n\nTo celebrate, here's an exclusive gift from our team:\n\n15% OFF your next booking\nCode: BDAY-EMMA-X7K2\nValid until: 25 April 2026\n\nWhether it's a solo trip, an outing with friends, or a gift for someone special, this one's on us.\n\n[Book Now With Your Discount]",
  },
  {
    key: "referral-program",
    name: "Referral Request",
    description: "After a guest leaves a positive review, invite them to refer friends with a dual incentive: they get a voucher, their friend gets a discount.",
    benefit: "Referred customers convert 25-30% better and have 16% higher lifetime value. Delivers new customers at 1/5th the cost of ads.",

    tier: "high-value",
    triggerType: "tag_added",
    triggerConfig: { tag: "left-review" },
    steps: [
      { step_type: "delay", config: { duration: 2, unit: "days" } },
      { step_type: "generate_voucher", config: { voucher_type: "fixed_amount", amount: 100, code_prefix: "REFER", valid_days: 90 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, Share the Adventure and Get R100 Off" } },
    ],
    howItWorks: [
      "When a contact is tagged 'left-review' (after leaving a Google/TripAdvisor review), they enter the flow",
      "Waits 2 days so it doesn't feel immediately transactional",
      "Generates a R100 off referral voucher for the customer",
      "Sends a 'share the adventure' email with their unique voucher code to share with friends",
      "Tip: Mention that their friend also gets 10% off to boost sharing motivation",
    ],
    exampleEmail: "Subject: Share the Adventure and Get R100 Off\n\nHi {first_name},\n\nThank you for the amazing review. It truly means the world to our team!\n\nWe'd love to help you share the experience with friends and family. Here's your personal referral code:\n\nYour reward: R100 off your next trip\nCode: REFER-{first_name}-X9P3\n\nShare it with anyone who'd love a trip like yours. When they book using your code, you both win!\n\n[Share via WhatsApp] [Copy Code]",
  },
  {
    key: "voucher-expiry",
    name: "Voucher Expiry Reminder",
    description: "Remind voucher holders before their voucher expires with a 3-stage countdown: 30 days, 7 days, and last day. Recovers forgotten revenue.",
    benefit: "Recovers 20-35% of unredeemed vouchers. Each redeemed gift voucher also brings a new customer to your business.",

    tier: "high-value",
    triggerType: "tag_added",
    triggerConfig: { tag: "voucher-expiring-30d" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Voucher Expires in 30 Days. Don't Let It Go to Waste" } },
      { step_type: "delay", config: { duration: 23, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Only 7 Days Left to Use Your Voucher" } },
      { step_type: "delay", config: { duration: 6, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Final Day: Your Voucher Expires Today!" } },
    ],
    howItWorks: [
      "Contacts are tagged 'voucher-expiring-30d' when their voucher hits 30 days before expiry",
      "Immediately sends the first reminder with voucher code, balance, and booking link",
      "After 23 days, sends a more urgent '7 days left' email with tour suggestions",
      "After 6 more days, sends a final-day urgency email",
      "Tip: Set up a cron job to auto-tag contacts whose vouchers are 30 days from expiry",
    ],
    exampleEmail: "Subject: Your Voucher Expires in 30 Days. Don't Let It Go to Waste\n\nHi {first_name},\n\nJust a heads up: your {business_name} voucher expires on 25 April 2026.\n\nVoucher Code: {voucher_code}\nBalance: {voucher_amount}\n\nBrowse our most popular experiences and pick a date.\n\nDon't let this go to waste. Book your adventure today!\n\n[Book Now]",
  },
  {
    key: "vip-treatment",
    name: "VIP Customer Treatment",
    description: "Give your best customers the VIP treatment with exclusive benefits, early access to new tours, and a generous loyalty discount.",
    benefit: "Top 20% of customers typically generate 80% of revenue. VIP recognition increases rebooking rates by 40-60%.",

    tier: "high-value",
    triggerType: "tag_added",
    triggerConfig: { tag: "vip" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, You're Now a VIP. Here's What That Means" } },
      { step_type: "delay", config: { duration: 7, unit: "days" } },
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 20, code_prefix: "VIP", valid_days: 60 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Exclusive VIP Offer: 20% Off Any Tour" } },
    ],
    howItWorks: [
      "When a contact is tagged 'vip' (e.g., 3+ bookings, high spend, or manual selection), they enter the flow",
      "Immediately sends a VIP welcome email explaining exclusive benefits (priority booking, early access)",
      "After 7 days, generates a 20% off voucher and sends the exclusive offer email",
      "The generous discount encourages another booking and reinforces loyalty",
      "Tip: Tag customers as 'vip' after their 3rd booking or when total spend exceeds a threshold",
    ],
    exampleEmail: "Subject: You're Now a VIP. Here's What That Means\n\nHi {first_name},\n\nWe wanted to say something important: THANK YOU.\n\nYou're one of our most valued guests, and we're upgrading you to VIP status. Here's what that means:\n\n- Priority booking on popular tours\n- Early access to new experiences\n- Exclusive discounts just for VIPs\n- Direct line to our team for special requests\n\nAn exclusive offer is heading your way soon. Keep an eye on your inbox!\n\nThank you for being part of our story.",
  },
  {
    key: "seasonal-launch",
    name: "New Season Announcement",
    description: "Build excitement for the new season with a 2-part campaign: preview what's coming, then offer early-bird pricing to drive pre-season bookings.",
    benefit: "Pre-season campaigns can generate 20-30% of total season bookings before the season even starts.",

    tier: "growth",
    triggerType: "manual",
    triggerConfig: {},
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "The New Season is Almost Here: Sneak Peek Inside" } },
      { step_type: "delay", config: { duration: 7, unit: "days" } },
      { step_type: "condition", config: { condition_type: "opened_email", value: "" } },
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 10, code_prefix: "EARLYBIRD", valid_days: 45 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Early Bird Special: 10% Off Before Anyone Else" } },
    ],
    howItWorks: [
      "You manually enrol your contact list when you're ready to announce the new season",
      "Email 1 sends a season preview: new tours, route changes, gear upgrades, exciting dates",
      "After 7 days, checks who opened the preview email (those are your warmest leads)",
      "For openers, generates a 10% early-bird discount voucher",
      "Sends the early-bird offer, creating urgency with a 45-day expiry window",
    ],
    exampleEmail: "Subject: The New Season is Almost Here: Sneak Peek Inside\n\nHi {first_name},\n\nThe new season is just around the corner, and we've been busy preparing something special.\n\nWhat's new this season:\n- New routes and experiences we scouted in the off-season\n- Upgraded gear across the fleet\n- Extended seasonal tours while conditions are at their best\n- Upgraded photo packages\n\nBookings open on 1 October, but VIPs and early birds get first pick.\n\nStay tuned: an exclusive early-bird offer is coming your way soon.\n\n[View All Tours]",
  },
  {
    key: "booking-anniversary",
    name: "Booking Anniversary",
    description: "Reach out on the 1-year anniversary of a customer's tour with a 'this time last year' nostalgia email and incentive to rebook.",
    benefit: "High emotional resonance drives 35-45% open rates. Targets a natural decision-making moment at very low cost.",

    tier: "growth",
    triggerType: "tag_added",
    triggerConfig: { tag: "anniversary-1yr" },
    steps: [
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 10, code_prefix: "ANNIV", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, This Time Last Year You Were Out There With Us" } },
    ],
    howItWorks: [
      "Contacts are tagged 'anniversary-1yr' when their booking anniversary approaches (via cron)",
      "Generates a 10% off anniversary voucher",
      "Sends a nostalgic email: 'this time last year you were out there with us'",
      "Includes a 'Try something new this year' CTA with different tour suggestions",
      "Tip: Include photos from their tour type to trigger positive memories",
    ],
    exampleEmail: "Subject: This Time Last Year, You Were Out There With Us\n\nHi {first_name},\n\nOne year ago today, you joined us for an unforgettable adventure.\n\nWe'd love to create another great memory with you. This time, why not try something new?\n\nHere's a special anniversary gift:\n10% OFF any tour\nCode: ANNIV-{first_name}-K4M2\n\n[Rebook Your Favourite] [Try Something New]",
  },
  {
    key: "photo-share",
    name: "Post-Tour Photo Delivery",
    description: "Automatically send trip photos when they're uploaded, with social sharing CTAs to drive organic word-of-mouth marketing.",
    benefit: "Each shared photo album reaches 50-200 people. Free organic marketing that builds social proof and attracts new customers.",

    tier: "growth",
    triggerType: "tag_added",
    triggerConfig: { tag: "photos-ready" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Trip Photos Are Ready, {first_name}!" } },
      { step_type: "delay", config: { duration: 3, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Share Your Adventure and Tag Us" } },
    ],
    howItWorks: [
      "When trip photos are uploaded and the contact is tagged 'photos-ready', they enter the flow",
      "Immediately sends an email with photo gallery link and best thumbnail previews",
      "After 3 days, sends a follow-up encouraging social sharing with your hashtag",
      "Social shares create free organic marketing that reaches the customer's entire network",
      "Tip: Include direct WhatsApp share and Instagram story share links",
    ],
    exampleEmail: "Subject: Your Trip Photos Are Ready!\n\nHi {first_name},\n\nGreat news: your trip photos are ready to download!\n\n[View Your Photo Gallery]\n\nYou can download, share, and relive your adventure anytime.\n\nLoved your experience? Share a photo on Instagram or Facebook and tag us. We'd love to see it!",
  },
];

const TIER_INFO: Record<string, { label: string; pill: string; description: string }> = {
  "must-have": { label: "Must-Have", pill: "ui-pill-danger", description: "Highest ROI: implement these first" },
  "high-value": { label: "High-Value", pill: "ui-pill-amber", description: "Strong returns: implement after core" },
  "growth": { label: "Growth", pill: "ui-pill-ocean", description: "Long-term engagement and scale" },
};

export default function AutomationsPage() {
  const { businessId } = useBusinessContext();
  const router = useRouter();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGallery, setShowGallery] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AutomationTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  // V-4: archived automations hide from the default list to stop cluttering
  // the active view, while preserving their enrollment history.
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (businessId) load();
  }, [businessId]);

  const visibleAutomations = showArchived ? automations : automations.filter((a) => a.status !== "archived");
  const archivedCount = automations.filter((a) => a.status === "archived").length;

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("marketing_automations")
      .select("id, name, trigger_type, trigger_config, status, enrolled_count, completed_count, created_at, description")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    const base = (data as any[]) || [];
    const ids = base.map((a) => a.id);
    if (ids.length === 0) {
      setAutomations([]);
      setLoading(false);
      return;
    }

    // One query for every automation's steps (flow summary + step sentences
    // on the list) and one for the last 7 days of successful sends, instead
    // of N+1 per-row round trips.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [stepsRes, logsRes] = await Promise.all([
      supabase.from("marketing_automation_steps").select("automation_id, position, step_type, config").in("automation_id", ids).order("position", { ascending: true }),
      supabase.from("marketing_automation_logs").select("automation_id").eq("action", "email_sent").gte("created_at", since).in("automation_id", ids),
    ]);
    const stepsByAutomation: Record<string, AutomationStep[]> = {};
    for (const s of (stepsRes.data as any[]) || []) {
      (stepsByAutomation[s.automation_id] ||= []).push({ step_type: s.step_type, config: s.config });
    }
    const sentByAutomation: Record<string, number> = {};
    for (const l of (logsRes.data as any[]) || []) {
      sentByAutomation[l.automation_id] = (sentByAutomation[l.automation_id] || 0) + 1;
    }

    setAutomations(base.map((a) => ({
      ...a,
      steps: stepsByAutomation[a.id] || [],
      sentLast7Days: sentByAutomation[a.id] || 0,
    })));
    setLoading(false);
  }

  async function createBlankAutomation() {
    // V-8: stop persisting "Untitled Automation" — operators end up with five
    // copies of the same name and no way to tell them apart. Auto-name with a
    // creation timestamp; the operator can rename in the builder.
    const stamp = new Date().toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    const { data, error } = await supabase
      .from("marketing_automations")
      .insert({
        business_id: businessId,
        name: "New automation · " + stamp,
        trigger_type: "manual",
        status: "draft",
      })
      .select("id")
      .single();
    if (error) {
      notify({ message: error.message, tone: "error" });
      return;
    }
    router.push("/marketing/automations/" + data!.id);
  }

  async function createFromTemplate(template: AutomationTemplate) {
    setCreating(true);
    // Create automation
    const { data: autoData, error: autoErr } = await supabase
      .from("marketing_automations")
      .insert({
        business_id: businessId,
        name: template.name,
        description: template.description,
        trigger_type: template.triggerType,
        trigger_config: template.triggerConfig,
        status: "draft",
      })
      .select("id")
      .single();

    if (autoErr || !autoData) {
      notify({ message: autoErr?.message || "Failed to create automation.", tone: "error" });
      setCreating(false);
      return;
    }

    const newAutoId = autoData.id;

    // Create steps. Every send_email step has a matching designed template in
    // the starter library (key = `${automation key}-${email ordinal}`) —
    // find-or-create it for this business and link it, so the automation is
    // ready to activate without hunting for the right template.
    let linkedTemplates = 0;
    if (template.steps.length > 0) {
      // Fetched once per automation (not per step) since every email in it
      // materializes against the same operator branding and tour list.
      const [{ data: bizRow }, { data: topTours }] = await Promise.all([
        supabase.from("businesses").select(
          "email_color, logo_url, business_address, public_phone, social_facebook, social_instagram, social_tiktok, social_youtube, social_twitter, social_linkedin, social_tripadvisor, social_google_reviews"
        ).eq("id", businessId).maybeSingle(),
        supabase.from("tours").select("id, name, image_url, duration_minutes")
          .eq("business_id", businessId).eq("active", true).order("sort_order", { ascending: true }).limit(3),
      ]);
      const biz = bizRow || {};
      const tours = topTours || [];

      const stepRows: { automation_id: string; position: number; step_type: string; config: Record<string, any> }[] = [];
      let emailOrdinal = 0;
      for (let i = 0; i < template.steps.length; i++) {
        const s = template.steps[i];
        const config: Record<string, any> = { ...s.config };
        if (s.step_type === "send_email") {
          emailOrdinal++;
          const starter = getStarterTemplateByKey(`${template.key}-${emailOrdinal}`);
          if (starter && !config.template_id) {
            const existing = await supabase.from("marketing_templates").select("id")
              .eq("business_id", businessId).eq("name", starter.name).limit(1).maybeSingle();
            let tplId: string | undefined = existing.data?.id;
            if (!tplId) {
              const blocks = materializeStarterTemplate(starter, biz, tours);
              const ins = await supabase.from("marketing_templates").insert({
                business_id: businessId,
                name: starter.name,
                subject_line: starter.subject,
                category: starter.category,
                editor_json: blocks,
                html_content: blocksToHtml(blocks),
              }).select("id").single();
              tplId = ins.data?.id;
            }
            if (tplId) {
              config.template_id = tplId;
              linkedTemplates++;
            }
          }
        }
        stepRows.push({ automation_id: newAutoId, position: i, step_type: s.step_type, config });
      }
      const { error: stepErr } = await supabase.from("marketing_automation_steps").insert(stepRows);
      if (stepErr) {
        notify({ message: stepErr.message, tone: "error" });
        setCreating(false);
        return;
      }
    }

    notify({
      message: linkedTemplates > 0
        ? `"${template.name}" created with ${linkedTemplates} designed email${linkedTemplates === 1 ? "" : "s"} already linked. Review and activate.`
        : `"${template.name}" automation created! Customize your email templates and activate.`,
      tone: "success",
    });
    setCreating(false);
    setSelectedTemplate(null);
    setShowGallery(false);
    router.push("/marketing/automations/" + newAutoId);
  }

  async function toggleStatus(a: Automation) {
    const newStatus = a.status === "active" ? "paused" : "active";
    const { error } = await supabase
      .from("marketing_automations")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", a.id);
    if (error) {
      notify({ message: error.message, tone: "error" });
      return;
    }
    setAutomations(automations.map((x) => (x.id === a.id ? { ...x, status: newStatus } : x)));
    notify({ message: newStatus === "active" ? "Automation activated." : "Automation paused.", tone: "success" });
  }

  async function archiveAutomation(a: Automation) {
    if (!await confirmAction({
      title: "Archive automation",
      message: "Archive \"" + (a.name || "this automation") + "\"? It will stop firing for new triggers and be hidden from the active list. Enrollment history is preserved and you can unarchive later.",
      tone: "warning",
      confirmLabel: "Archive",
    })) return;
    const { error } = await supabase
      .from("marketing_automations")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", a.id);
    if (error) { notify({ message: error.message, tone: "error" }); return; }
    setAutomations(automations.map((x) => (x.id === a.id ? { ...x, status: "archived" } : x)));
    notify({ message: "Automation archived.", tone: "success" });
  }

  async function unarchiveAutomation(a: Automation) {
    const { error } = await supabase
      .from("marketing_automations")
      .update({ status: "draft", updated_at: new Date().toISOString() })
      .eq("id", a.id);
    if (error) { notify({ message: error.message, tone: "error" }); return; }
    setAutomations(automations.map((x) => (x.id === a.id ? { ...x, status: "draft" } : x)));
    notify({ message: "Automation unarchived (set to draft).", tone: "success" });
  }

  async function deleteAutomation(a: Automation) {
    if (!await confirmAction({
      title: "Delete automation",
      message: "Delete \"" + (a.name || "this automation") + "\" permanently? Enrollment history and analytics will be destroyed. If you might want this back later, Archive instead.",
      tone: "warning",
      confirmLabel: "Delete permanently",
    })) return;
    const { error } = await supabase.from("marketing_automations").delete().eq("id", a.id);
    if (error) {
      notify({ message: error.message, tone: "error" });
      return;
    }
    setAutomations(automations.filter((x) => x.id !== a.id));
    notify({ message: "Automation deleted.", tone: "success" });
  }

  if (loading) {
    return (
      <div className="space-y-4 py-2">
        <div className="ui-skeleton h-8 w-48" />
        <div className="ui-skeleton h-[140px] !rounded-2xl" />
        <div className="ui-skeleton h-[320px] !rounded-2xl" />
      </div>
    );
  }

  /* ─── TEMPLATE DETAIL MODAL ─── */
  if (selectedTemplate) {
    const t = selectedTemplate;
    const tier = TIER_INFO[t.tier];
    return (
      <div className="space-y-6">
        <button
          onClick={() => setSelectedTemplate(null)}
          className="flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80"
          style={{ color: "var(--ck-text-muted)" }}
        >
          Back to templates
        </button>

        {/* Header */}
        <div className="ui-card p-6 anim-fade-up">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="font-display text-[22px] font-semibold leading-tight" style={{ color: "var(--ck-text-strong)" }}>{t.name}</h1>
                <span className={"ui-status " + tier.pill}>
                  {tier.label}
                </span>
              </div>
              <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{t.description}</p>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => createFromTemplate(t)}
              disabled={creating}
              className="ui-btn ui-btn-primary disabled:opacity-50"
            >
              {creating ? "Creating..." : "Use This Template"}
            </button>
          </div>
        </div>

        {/* Why this works */}
        <div className="ui-card p-5 anim-fade-up anim-d1">
          <p className="ui-mono-label mb-2">Why This Works</p>
          <p className="text-sm" style={{ color: "var(--ck-text)" }}>{t.benefit}</p>
        </div>

        {/* How it works — step by step */}
        <div className="ui-card p-5 anim-fade-up anim-d2">
          <p className="ui-mono-label mb-4">How It Works</p>
          <div className="space-y-3">
            {t.howItWorks.map((step, i) => (
              <div key={i} className="flex gap-3">
                <div
                  className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white"
                  style={{ background: "var(--ck-accent)" }}
                >
                  {i + 1}
                </div>
                <p className="text-sm pt-0.5" style={{ color: "var(--ck-text)" }}>{step}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Workflow preview */}
        <div className="ui-card p-5 anim-fade-up anim-d3">
          <p className="ui-mono-label mb-4">Workflow Preview</p>

          {/* Trigger */}
          <div className="flex items-center gap-2 mb-2">
            <div
              className="ui-status ui-pill-accent !px-3 !py-1.5"
              style={{ borderColor: "var(--ck-accent)" }}
            >
              Trigger: {t.triggerType.replace(/_/g, " ")}
              {t.triggerConfig.tag && <span className="opacity-70">({t.triggerConfig.tag})</span>}
              {t.triggerConfig.field && <span className="opacity-70">({t.triggerConfig.field})</span>}
            </div>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--ck-text-muted)" }}>
            {triggerSentence({ trigger_type: t.triggerType, trigger_config: t.triggerConfig })}
          </p>

          {/* Steps */}
          <div className="ml-4 border-l-2 pl-4 space-y-2" style={{ borderColor: "var(--ck-border-strong)" }}>
            {t.steps.map((step, i) => {
              const label = stepSentence(step, i, t.steps);
              return (
                <div key={i} className="flex items-center gap-2 py-1.5">
                  <span
                    className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white"
                    style={{ background: "var(--ck-accent)" }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-xs" style={{ color: "var(--ck-text)" }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Example email */}
        <div className="ui-card p-5">
          <p className="ui-mono-label mb-3">Example Email Content</p>
          <div
            className="rounded-lg border p-4 text-xs whitespace-pre-wrap font-mono leading-relaxed"
            style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-sunken)", color: "var(--ck-text)" }}
          >
            {t.exampleEmail}
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--ck-text-muted)" }}>
            This is a sample. You'll customise the actual email in your template editor after creating the automation.
          </p>
        </div>

        {/* Bottom CTA */}
        <div className="flex gap-3 pb-4">
          <button
            onClick={() => createFromTemplate(t)}
            disabled={creating}
            className="ui-btn ui-btn-primary !px-5 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Use This Template"}
          </button>
          <button
            onClick={() => setSelectedTemplate(null)}
            className="ui-btn ui-btn-ghost"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  /* ─── TEMPLATE GALLERY ─── */
  if (showGallery) {
    const tiers: ("must-have" | "high-value" | "growth")[] = ["must-have", "high-value", "growth"];
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between anim-fade-up">
          <div>
            <p className="ui-mono-label mb-2">Growth · Templates</p>
            <h1 className="font-display text-[26px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Automation Templates</h1>
            <p className="text-sm mt-1.5" style={{ color: "var(--ck-text-muted)" }}>
              Industry-proven workflows designed for tour &amp; activity businesses. Choose a template to get started in seconds.
            </p>
          </div>
          <button
            onClick={() => setShowGallery(false)}
            className="ui-btn ui-btn-ghost"
          >
            Close
          </button>
        </div>

        {tiers.map((tier, tierIdx) => {
          const info = TIER_INFO[tier];
          const tierTemplates = TEMPLATES.filter((t) => t.tier === tier);
          return (
            <div key={tier} className={"anim-fade-up anim-d" + (tierIdx + 1)}>
              <div className="flex items-center gap-2 mb-3">
                <span className={"ui-status " + info.pill}>
                  {info.label}
                </span>
                <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{info.description}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {tierTemplates.map((t) => {
                  const tb = triggerBadge[t.triggerType] || triggerBadge.manual;
                  const emailSteps = t.steps.filter((s) => s.step_type === "send_email").length;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setSelectedTemplate(t)}
                      className="ui-card ui-card-hover p-4 text-left"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-semibold truncate" style={{ color: "var(--ck-text-strong)" }}>
                              {t.name}
                            </h3>
                          </div>
                          <p className="text-xs line-clamp-2 mb-2" style={{ color: "var(--ck-text-muted)" }}>
                            {t.description}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={"ui-status " + tb.pill}>
                              {tb.label}
                            </span>
                            <span className="ui-status ui-pill-neutral">
                              {t.steps.length} steps
                            </span>
                            <span className="ui-status ui-pill-ocean">
                              {emailSteps} designed email{emailSteps !== 1 ? "s" : ""} included
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Blank automation option */}
        <div className="pt-2 border-t" style={{ borderColor: "var(--ck-border-subtle)" }}>
          <button
            onClick={createBlankAutomation}
            className="flex items-center gap-3 rounded-xl border border-dashed p-4 w-full text-left transition-all hover:border-[var(--ck-border-strong)] hover:bg-[var(--ck-surface-warm)]"
            style={{ borderColor: "var(--ck-border-strong)" }}
          >
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Start From Scratch</h3>
              <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                Build a custom automation with your own trigger and steps
              </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  /* ─── MAIN AUTOMATIONS LIST ─── */
  return (
    <div className="space-y-4">
      {/* Intro banner — shown when there are few automations */}
      {automations.length > 0 && automations.length <= 5 && (
        <div className="ui-card p-5 anim-fade-up">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--ck-text-strong)" }}>
                Your automations run 24/7 in the background
              </h3>
              <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--ck-text-muted)" }}>
                Tags are automatically applied to your contacts based on their booking behaviour, like <strong>completed-tour</strong>, <strong>lapsed-90-days</strong>, or <strong>vip</strong>. When a tag is added, any matching automation triggers instantly. No manual work needed.
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {["completed-tour", "lapsed-90-days", "vip", "new-booker", "voucher-expiring"].map(tag => (
                  <span key={tag} className="ui-status ui-pill-accent">
                    {tag}
                  </span>
                ))}
                <span className="text-[10px] py-0.5 px-1" style={{ color: "var(--ck-text-muted)" }}>auto-assigned daily</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between anim-fade-up anim-d1">
        <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
          <span className="font-display text-base font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{automations.length}</span> automation{automations.length !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setShowGallery(true)}
            className="ui-btn ui-btn-ghost"
          >
            Browse Templates
          </button>
          <button
            onClick={createBlankAutomation}
            className="ui-btn ui-btn-primary"
          >
            New Automation
          </button>
        </div>
      </div>

      {/* Empty state with template suggestions */}
      {automations.length === 0 ? (
        <div className="space-y-6 anim-fade-up">
          <div className="ui-card ui-empty">
            <h2 className="text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>
              No automations yet
            </h2>
            <p className="text-sm mb-4 max-w-lg" style={{ color: "var(--ck-text-muted)" }}>
              Automations send emails automatically when things happen: a new booking, a completed tour, a birthday, or a customer going quiet. Tags are auto-assigned to your contacts based on their behaviour, and automations fire when those tags appear.
            </p>
            <button
              onClick={() => setShowGallery(true)}
              className="ui-btn ui-btn-primary"
            >
              Browse Templates to Get Started
            </button>
          </div>

          {/* Quick-start suggestions */}
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--ck-text-strong)" }}>
              Recommended for You
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {TEMPLATES.filter((t) => t.tier === "must-have").map((t) => {
                return (
                  <button
                    key={t.key}
                    onClick={() => { setShowGallery(true); setSelectedTemplate(t); }}
                    className="ui-card ui-card-hover p-4 text-left"
                  >
                    <h4 className="text-sm font-semibold mb-1" style={{ color: "var(--ck-text-strong)" }}>
                      {t.name}
                    </h4>
                    <p className="text-xs line-clamp-2" style={{ color: "var(--ck-text-muted)" }}>
                      {t.benefit.split(".")[0]}.
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* How automations work */}
          <div className="ui-card p-5">
            <p className="ui-mono-label mb-3">How Automations Work</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white" style={{ background: "var(--ck-accent)" }}>1</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--ck-text-strong)" }}>Trigger Fires</span>
                </div>
                <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                  Something happens: a new contact signs up, a booking completes, a tag is added, or a date arrives (like a birthday).
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white" style={{ background: "var(--ck-accent)" }}>2</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--ck-text-strong)" }}>Steps Execute</span>
                </div>
                <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                  The workflow runs: send emails, wait for a period, check conditions, or generate discount vouchers, all automatically.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white" style={{ background: "var(--ck-accent)" }}>3</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--ck-text-strong)" }}>Results Grow</span>
                </div>
                <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                  More reviews, more rebookings, more referrals, and recovered revenue, all while you focus on running great tours.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ─── AUTOMATIONS TABLE ─── */
        <div className="space-y-3 anim-fade-up anim-d2">
          {archivedCount > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: "var(--ck-text-muted)" }}>
                {archivedCount} archived automation{archivedCount === 1 ? "" : "s"}{showArchived ? " visible below" : " hidden"}
              </span>
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="ui-btn ui-btn-ghost !h-8 !px-2.5 !text-xs"
              >
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
            </div>
          )}
        <div className="ui-card overflow-x-auto">
          <table className="w-full text-sm min-w-[1050px]">
            <thead>
              <tr style={{ background: "var(--ck-surface-sunken)" }}>
                <th className="text-left px-4 py-3 ui-mono-label !text-[10px]">Name</th>
                <th className="text-left px-4 py-3 ui-mono-label !text-[10px]">Trigger</th>
                <th className="text-left px-4 py-3 ui-mono-label !text-[10px]">Flow</th>
                <th className="text-center px-4 py-3 ui-mono-label !text-[10px]">Status</th>
                <th className="text-center px-4 py-3 ui-mono-label !text-[10px]">Enrolled</th>
                <th className="text-center px-4 py-3 ui-mono-label !text-[10px]">Completed</th>
                <th className="text-center px-4 py-3 ui-mono-label !text-[10px]">Sent (7d)</th>
                <th className="text-left px-4 py-3 ui-mono-label !text-[10px]">Created</th>
                <th className="text-right px-4 py-3 ui-mono-label !text-[10px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleAutomations.map((a) => {
                const tb = triggerBadge[a.trigger_type] || triggerBadge.manual;
                const sb = statusBadge[a.status] || statusBadge.draft;
                return (
                  <tr key={a.id} className="border-t transition-colors hover:bg-[var(--ck-surface-sunken)]" style={{ borderColor: "var(--ck-border-subtle)" }}>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => router.push("/marketing/automations/" + a.id)}
                        className="font-medium text-left hover:underline"
                        style={{ color: "var(--ck-text-strong)" }}
                      >
                        {a.name}
                      </button>
                      {a.description && (
                        <p className="text-xs truncate max-w-[250px]" style={{ color: "var(--ck-text-muted)" }}>
                          {a.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={"ui-status " + tb.pill}>
                        {tb.label}
                      </span>
                      <p className="text-xs mt-1 max-w-[200px]" style={{ color: "var(--ck-text-muted)" }}>
                        {triggerSentence({ trigger_type: a.trigger_type, trigger_config: a.trigger_config })}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[180px]" style={{ color: "var(--ck-text-muted)" }}>
                      {flowSummary(a.steps || [])}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={"ui-status " + sb.pill}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-display tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                      {a.enrolled_count}
                    </td>
                    <td className="px-4 py-3 text-center font-display tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                      {a.completed_count}
                    </td>
                    <td className="px-4 py-3 text-center font-display tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                      {a.sentLast7Days ?? 0}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      {new Date(a.created_at).toLocaleDateString("en-ZA")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {a.status !== "archived" && (
                          <button
                            onClick={() => toggleStatus(a)}
                            className="inline-flex items-center justify-center rounded-lg border p-1.5 transition-colors hover:bg-[var(--ck-surface-sunken)]"
                            style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text)" }}
                            title={a.status === "active" ? "Pause" : "Activate"}
                          >
                            {a.status === "active" ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                        )}
                        {a.status === "archived" ? (
                          <button
                            onClick={() => unarchiveAutomation(a)}
                            className="ui-btn ui-btn-ghost !h-8 !px-2 !text-[11px]"
                            title="Restore to draft"
                          >
                            Unarchive
                          </button>
                        ) : (
                          <button
                            onClick={() => archiveAutomation(a)}
                            className="ui-btn ui-btn-ghost !h-8 !px-2 !text-[11px]"
                            title="Hide from active list, preserve history"
                          >
                            Archive
                          </button>
                        )}
                        <button
                          onClick={() => deleteAutomation(a)}
                          className="inline-flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-[var(--ck-danger-soft)]"
                          style={{ color: "var(--ck-danger)" }}
                          title="Delete permanently"
                        >
                          <Trash size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );
}
