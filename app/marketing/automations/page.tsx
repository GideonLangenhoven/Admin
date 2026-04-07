"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { notify } from "../../lib/app-notify";
import { useBusinessContext } from "../../../components/BusinessContext";
import {
  Plus, Trash, Play, Pause, Lightning, Envelope, Clock, Gift, Star, UsersThree,
  ArrowsClockwise, Heart, CalendarDots, Tag, TrendUp, ShoppingCart,
  Camera, Medal, Sparkle, CaretRight, X, ArrowRight, Info,
} from "@phosphor-icons/react";

interface Automation {
  id: string;
  name: string;
  trigger_type: string;
  status: string;
  enrolled_count: number;
  completed_count: number;
  created_at: string;
  description: string | null;
}

var triggerBadge: Record<string, { bg: string; text: string; label: string }> = {
  contact_added: { bg: "bg-blue-100", text: "text-blue-700", label: "Contact Added" },
  tag_added: { bg: "bg-purple-100", text: "text-purple-700", label: "Tag Added" },
  post_booking: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Post Booking" },
  date_field: { bg: "bg-orange-100", text: "text-orange-700", label: "Date Field" },
  manual: { bg: "bg-gray-100", text: "text-gray-500", label: "Manual" },
};

var statusBadge: Record<string, { bg: string; text: string }> = {
  draft: { bg: "bg-gray-100", text: "text-gray-500" },
  active: { bg: "bg-emerald-100", text: "text-emerald-700" },
  paused: { bg: "bg-yellow-100", text: "text-yellow-700" },
  archived: { bg: "bg-red-100", text: "text-red-600" },
};

/* ─── AUTOMATION TEMPLATE CATALOG ─── */

interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  benefit: string;
  icon: any;
  iconColor: string;
  iconBg: string;
  tier: "must-have" | "high-value" | "growth";
  triggerType: string;
  triggerConfig: Record<string, any>;
  steps: { step_type: string; config: Record<string, any> }[];
  howItWorks: string[];
  exampleEmail: string;
}

var TEMPLATES: AutomationTemplate[] = [
  {
    key: "welcome-series",
    name: "Welcome Series",
    description: "Greet new subscribers with your brand story, showcase your best tours, and convert them into first-time bookers with a special discount.",
    benefit: "Welcome flows generate R21+ revenue per recipient. Sets the tone for your entire customer relationship.",
    icon: Sparkle,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-50",
    tier: "must-have",
    triggerType: "contact_added",
    triggerConfig: {},
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "Welcome to {business_name} — Your Adventure Starts Here" } },
      { step_type: "delay", config: { duration: 3, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Our Most Popular Tours — See Why Guests Love Us" } },
      { step_type: "delay", config: { duration: 4, unit: "days" } },
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 10, code_prefix: "WELCOME", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, Here's 10% Off Your First Booking" } },
    ],
    howItWorks: [
      "New contact is added to your list (manual, import, or booking sync)",
      "Immediately sends a welcome email with your brand story and what makes you unique",
      "After 3 days, sends a showcase of your most popular tours with guest reviews",
      "After 4 more days, generates a unique 10% discount voucher and sends a conversion email",
      "Contacts who book within 30 days use their voucher — those who don't, you can re-engage later",
    ],
    exampleEmail: "Subject: Welcome to Cape Kayak — Your Adventure Starts Here\n\nHi {first_name},\n\nWelcome! We're so glad you're here.\n\nAt Cape Kayak, we believe everyone deserves to experience the ocean from a different perspective. Whether it's paddling alongside dolphins at sunrise or exploring hidden sea caves, every trip is a story waiting to happen.\n\nHere's what to expect from us:\n- Insider tips on the best times to paddle\n- Exclusive offers and early access to new tours\n- Stories and photos from the water\n\nReady to start? Browse our tours and find your next adventure.\n\n[Browse Tours]",
  },
  {
    key: "post-tour-review",
    name: "Post-Tour Review Request",
    description: "Automatically ask for Google/TripAdvisor reviews while the experience is still fresh. Includes a follow-up nudge for those who didn't respond.",
    benefit: "Guests asked for reviews are 3x more likely to leave one. Reviews are your #1 marketing asset — they directly drive new bookings.",
    icon: Star,
    iconColor: "text-yellow-600",
    iconBg: "bg-yellow-50",
    tier: "must-have",
    triggerType: "tag_added",
    triggerConfig: { tag: "completed-tour" },
    steps: [
      { step_type: "delay", config: { duration: 3, unit: "hours" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "How Was Your Experience, {first_name}?" } },
      { step_type: "delay", config: { duration: 5, unit: "days" } },
      { step_type: "condition", config: { condition_type: "opened_email", value: "" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Quick Favour — Your Review Helps Other Adventurers" } },
    ],
    howItWorks: [
      "When a booking is completed, the contact gets tagged 'completed-tour' (via auto-messages or manual)",
      "Waits 3 hours so the guest is home but the experience is still vivid",
      "Sends a thank-you email with direct links to leave a Google or TripAdvisor review",
      "After 5 days, checks if the first email was opened",
      "If opened but no review yet, sends a gentle reminder with a different angle",
    ],
    exampleEmail: "Subject: How Was Your Experience, Sarah?\n\nHi Sarah,\n\nThank you for joining us today! We hope you had an amazing time on the water.\n\nWe'd love to hear what you thought. A quick review helps other adventurers discover us and means the world to our small team.\n\nIt only takes 30 seconds:\n\n[Leave a Google Review] [Leave a TripAdvisor Review]\n\nThank you for being part of our story!",
  },
  {
    key: "win-back",
    name: "Win-Back Campaign",
    description: "Re-engage customers who haven't booked in 90+ days with a 3-step escalating sequence: nostalgia, then incentive, then final offer.",
    benefit: "It costs 5x more to acquire a new customer than re-engage an existing one. Win-back emails recover 10-15% of lapsed customers.",
    icon: ArrowsClockwise,
    iconColor: "text-indigo-600",
    iconBg: "bg-indigo-50",
    tier: "must-have",
    triggerType: "tag_added",
    triggerConfig: { tag: "lapsed-90-days" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "We Miss You, {first_name} — See What's New" } },
      { step_type: "delay", config: { duration: 14, unit: "days" } },
      { step_type: "condition", config: { condition_type: "opened_email", value: "" } },
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 15, code_prefix: "COMEBACK", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, Here's 15% Off — Just for You" } },
      { step_type: "delay", config: { duration: 21, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Last Chance — Your Exclusive Discount Expires Soon" } },
    ],
    howItWorks: [
      "Contacts tagged 'lapsed-90-days' enter the flow (tag via re-engagement cron or manual)",
      "Email 1: 'We miss you' with highlights of new tours, recent photos, what's changed",
      "After 14 days, checks if they opened email 1",
      "If they opened it, generates a 15% off voucher and sends a personalized offer",
      "After 21 more days, sends a final 'last chance' email with urgency on the expiring voucher",
    ],
    exampleEmail: "Subject: We Miss You, James — See What's New\n\nHi James,\n\nIt's been a while since your last adventure with us, and we've been busy!\n\nHere's what's new:\n- Sunrise Paddle — our most popular new tour\n- Upgraded gear for maximum comfort\n- New routes along the coastline\n\nWe'd love to see you back on the water. Ready for your next trip?\n\n[Browse Tours]",
  },
  {
    key: "birthday-special",
    name: "Birthday Special",
    description: "Delight customers on their birthday with a personalised greeting and exclusive discount voucher. Runs automatically every year.",
    benefit: "Birthday emails generate 342% higher revenue per email than standard promotions, with 45%+ open rates.",
    icon: Heart,
    iconColor: "text-pink-600",
    iconBg: "bg-pink-50",
    tier: "high-value",
    triggerType: "date_field",
    triggerConfig: { field: "date_of_birth", days_before: 0 },
    steps: [
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 15, code_prefix: "BDAY", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Happy Birthday, {first_name}! Here's a Gift From Us" } },
      { step_type: "delay", config: { duration: 14, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Birthday Voucher Expires Soon — Don't Miss Out" } },
    ],
    howItWorks: [
      "On each contact's birthday (requires date_of_birth field), the automation triggers",
      "Generates a unique 15% off voucher code with 'BDAY' prefix, valid for 30 days",
      "Immediately sends a birthday greeting email with the voucher details",
      "After 14 days, sends a reminder that the birthday voucher is expiring soon",
      "Runs every year automatically — no manual effort needed",
    ],
    exampleEmail: "Subject: Happy Birthday, Emma! Here's a Gift From Us\n\nHi Emma,\n\nHappy Birthday! We hope your day is as amazing as a sunrise on the water.\n\nTo celebrate, here's an exclusive gift from our team:\n\n15% OFF your next booking\nCode: BDAY-EMMA-X7K2\nValid until: 25 April 2026\n\nWhether it's a solo paddle, a trip with friends, or a gift for someone special — this one's on us.\n\n[Book Now With Your Discount]",
  },
  {
    key: "referral-program",
    name: "Referral Request",
    description: "After a guest leaves a positive review, invite them to refer friends with a dual incentive — they get a voucher, their friend gets a discount.",
    benefit: "Referred customers convert 25-30% better and have 16% higher lifetime value. Delivers new customers at 1/5th the cost of ads.",
    icon: UsersThree,
    iconColor: "text-green-600",
    iconBg: "bg-green-50",
    tier: "high-value",
    triggerType: "tag_added",
    triggerConfig: { tag: "left-review" },
    steps: [
      { step_type: "delay", config: { duration: 2, unit: "days" } },
      { step_type: "generate_voucher", config: { voucher_type: "fixed_amount", amount: 100, code_prefix: "REFER", valid_days: 90 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, Share the Adventure — Get R100 Off" } },
    ],
    howItWorks: [
      "When a contact is tagged 'left-review' (after leaving a Google/TripAdvisor review), they enter the flow",
      "Waits 2 days so it doesn't feel immediately transactional",
      "Generates a R100 off referral voucher for the customer",
      "Sends a 'share the adventure' email with their unique voucher code to share with friends",
      "Tip: Mention that their friend also gets 10% off to boost sharing motivation",
    ],
    exampleEmail: "Subject: Share the Adventure — Get R100 Off\n\nHi {first_name},\n\nThank you for the amazing review — it truly means the world to our team!\n\nWe'd love to help you share the experience with friends and family. Here's your personal referral code:\n\nYour reward: R100 off your next trip\nCode: REFER-{first_name}-X9P3\n\nShare it with anyone who'd love a day on the water. When they book using your code, you both win!\n\n[Share via WhatsApp] [Copy Code]",
  },
  {
    key: "voucher-expiry",
    name: "Voucher Expiry Reminder",
    description: "Remind voucher holders before their voucher expires with a 3-stage countdown: 30 days, 7 days, and last day. Recovers forgotten revenue.",
    benefit: "Recovers 20-35% of unredeemed vouchers. Each redeemed gift voucher also brings a new customer to your business.",
    icon: Gift,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-50",
    tier: "high-value",
    triggerType: "tag_added",
    triggerConfig: { tag: "voucher-expiring-30d" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Voucher Expires in 30 Days — Don't Let It Go to Waste" } },
      { step_type: "delay", config: { duration: 23, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Only 7 Days Left to Use Your Voucher" } },
      { step_type: "delay", config: { duration: 6, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Final Day — Your Voucher Expires Today!" } },
    ],
    howItWorks: [
      "Contacts are tagged 'voucher-expiring-30d' when their voucher hits 30 days before expiry",
      "Immediately sends the first reminder with voucher code, balance, and booking link",
      "After 23 days, sends a more urgent '7 days left' email with tour suggestions",
      "After 6 more days, sends a final-day urgency email",
      "Tip: Set up a cron job to auto-tag contacts whose vouchers are 30 days from expiry",
    ],
    exampleEmail: "Subject: Your Voucher Expires in 30 Days — Don't Let It Go to Waste\n\nHi {first_name},\n\nJust a heads up — your Cape Kayak voucher expires on 25 April 2026.\n\nVoucher Code: {voucher_code}\nBalance: {voucher_amount}\n\nHere are some popular experiences to choose from:\n- Sunrise Dolphin Paddle (2hrs)\n- Coastal Explorer Tour (3hrs)\n- Sunset Sea Cave Adventure (2.5hrs)\n\nDon't let this go to waste — book your adventure today!\n\n[Book Now]",
  },
  {
    key: "vip-treatment",
    name: "VIP Customer Treatment",
    description: "Give your best customers the VIP treatment with exclusive benefits, early access to new tours, and a generous loyalty discount.",
    benefit: "Top 20% of customers typically generate 80% of revenue. VIP recognition increases rebooking rates by 40-60%.",
    icon: Medal,
    iconColor: "text-violet-600",
    iconBg: "bg-violet-50",
    tier: "high-value",
    triggerType: "tag_added",
    triggerConfig: { tag: "vip" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, You're Now a VIP — Here's What That Means" } },
      { step_type: "delay", config: { duration: 7, unit: "days" } },
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 20, code_prefix: "VIP", valid_days: 60 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Exclusive VIP Offer — 20% Off Any Tour" } },
    ],
    howItWorks: [
      "When a contact is tagged 'vip' (e.g., 3+ bookings, high spend, or manual selection), they enter the flow",
      "Immediately sends a VIP welcome email explaining exclusive benefits (priority booking, early access)",
      "After 7 days, generates a 20% off voucher and sends the exclusive offer email",
      "The generous discount encourages another booking and reinforces loyalty",
      "Tip: Tag customers as 'vip' after their 3rd booking or when total spend exceeds a threshold",
    ],
    exampleEmail: "Subject: You're Now a VIP — Here's What That Means\n\nHi {first_name},\n\nWe wanted to say something important: THANK YOU.\n\nYou're one of our most valued guests, and we're upgrading you to VIP status. Here's what that means:\n\n- Priority booking on popular tours\n- Early access to new experiences\n- Exclusive discounts just for VIPs\n- Direct line to our team for special requests\n\nAn exclusive offer is heading your way soon. Keep an eye on your inbox!\n\nThank you for being part of our story.",
  },
  {
    key: "seasonal-launch",
    name: "New Season Announcement",
    description: "Build excitement for the new season with a 2-part campaign: preview what's coming, then offer early-bird pricing to drive pre-season bookings.",
    benefit: "Pre-season campaigns can generate 20-30% of total season bookings before the season even starts.",
    icon: CalendarDots,
    iconColor: "text-teal-600",
    iconBg: "bg-teal-50",
    tier: "growth",
    triggerType: "manual",
    triggerConfig: {},
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "The New Season is Almost Here — Sneak Peek Inside" } },
      { step_type: "delay", config: { duration: 7, unit: "days" } },
      { step_type: "condition", config: { condition_type: "opened_email", value: "" } },
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 10, code_prefix: "EARLYBIRD", valid_days: 45 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Early Bird Special — 10% Off Before Anyone Else" } },
    ],
    howItWorks: [
      "You manually enrol your contact list when you're ready to announce the new season",
      "Email 1 sends a season preview: new tours, route changes, gear upgrades, exciting dates",
      "After 7 days, checks who opened the preview email (those are your warmest leads)",
      "For openers, generates a 10% early-bird discount voucher",
      "Sends the early-bird offer — creating urgency with a 45-day expiry window",
    ],
    exampleEmail: "Subject: The New Season is Almost Here — Sneak Peek Inside\n\nHi {first_name},\n\nThe new season is just around the corner, and we've been busy preparing something special.\n\nWhat's new this season:\n- New Sunset Paddle route along the cliffs\n- Extended whale-season tours (June-November)\n- Brand new double kayaks for couples\n- Upgraded photo packages with drone footage\n\nBookings open on 1 October, but VIPs and early birds get first pick.\n\nStay tuned — an exclusive early-bird offer is coming your way soon.\n\n[View All Tours]",
  },
  {
    key: "booking-anniversary",
    name: "Booking Anniversary",
    description: "Reach out on the 1-year anniversary of a customer's tour with a 'this time last year' nostalgia email and incentive to rebook.",
    benefit: "High emotional resonance drives 35-45% open rates. Targets a natural decision-making moment at very low cost.",
    icon: CalendarDots,
    iconColor: "text-rose-600",
    iconBg: "bg-rose-50",
    tier: "growth",
    triggerType: "tag_added",
    triggerConfig: { tag: "anniversary-1yr" },
    steps: [
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 10, code_prefix: "ANNIV", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, This Time Last Year You Were on the Water..." } },
    ],
    howItWorks: [
      "Contacts are tagged 'anniversary-1yr' when their booking anniversary approaches (via cron)",
      "Generates a 10% off anniversary voucher",
      "Sends a nostalgic email: 'this time last year you were paddling with us'",
      "Includes a 'Try something new this year' CTA with different tour suggestions",
      "Tip: Include photos from their tour type to trigger positive memories",
    ],
    exampleEmail: "Subject: This Time Last Year You Were on the Water...\n\nHi {first_name},\n\nOne year ago today, you joined us for an unforgettable adventure on the water.\n\nWe'd love to create another great memory with you. This time, why not try something new?\n\nHere's a special anniversary gift:\n10% OFF any tour\nCode: ANNIV-{first_name}-K4M2\n\n[Rebook Your Favourite] [Try Something New]",
  },
  {
    key: "photo-share",
    name: "Post-Tour Photo Delivery",
    description: "Automatically send trip photos when they're uploaded, with social sharing CTAs to drive organic word-of-mouth marketing.",
    benefit: "Each shared photo album reaches 50-200 people. Free organic marketing that builds social proof and attracts new customers.",
    icon: Camera,
    iconColor: "text-cyan-600",
    iconBg: "bg-cyan-50",
    tier: "growth",
    triggerType: "tag_added",
    triggerConfig: { tag: "photos-ready" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Trip Photos Are Ready, {first_name}!" } },
      { step_type: "delay", config: { duration: 3, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Share Your Adventure — Tag Us @capekayak" } },
    ],
    howItWorks: [
      "When trip photos are uploaded and the contact is tagged 'photos-ready', they enter the flow",
      "Immediately sends an email with photo gallery link and best thumbnail previews",
      "After 3 days, sends a follow-up encouraging social sharing with your hashtag",
      "Social shares create free organic marketing that reaches the customer's entire network",
      "Tip: Include direct WhatsApp share and Instagram story share links",
    ],
    exampleEmail: "Subject: Your Trip Photos Are Ready!\n\nHi {first_name},\n\nGreat news — your trip photos are ready to download!\n\n[View Your Photo Gallery]\n\nYou can download, share, and relive your adventure anytime.\n\nLoved your experience? Share a photo on Instagram or Facebook and tag @capekayak — we'd love to see it!\n\n#CapeKayak #PaddleLife",
  },
];

var TIER_INFO: Record<string, { label: string; bg: string; text: string; description: string }> = {
  "must-have": { label: "Must-Have", bg: "bg-red-50", text: "text-red-700", description: "Highest ROI — implement these first" },
  "high-value": { label: "High-Value", bg: "bg-amber-50", text: "text-amber-700", description: "Strong returns — implement after core" },
  "growth": { label: "Growth", bg: "bg-blue-50", text: "text-blue-700", description: "Long-term engagement and scale" },
};

export default function AutomationsPage() {
  var { businessId } = useBusinessContext();
  var router = useRouter();
  var [automations, setAutomations] = useState<Automation[]>([]);
  var [loading, setLoading] = useState(true);
  var [showGallery, setShowGallery] = useState(false);
  var [selectedTemplate, setSelectedTemplate] = useState<AutomationTemplate | null>(null);
  var [creating, setCreating] = useState(false);

  useEffect(() => {
    if (businessId) load();
  }, [businessId]);

  async function load() {
    setLoading(true);
    var { data } = await supabase
      .from("marketing_automations")
      .select("id, name, trigger_type, status, enrolled_count, completed_count, created_at, description")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    setAutomations((data as Automation[]) || []);
    setLoading(false);
  }

  async function createBlankAutomation() {
    var { data, error } = await supabase
      .from("marketing_automations")
      .insert({
        business_id: businessId,
        name: "Untitled Automation",
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
    var { data: autoData, error: autoErr } = await supabase
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

    var newAutoId = autoData.id;

    // Create steps
    if (template.steps.length > 0) {
      var stepRows = template.steps.map((s, i) => ({
        automation_id: newAutoId,
        position: i,
        step_type: s.step_type,
        config: s.config,
      }));
      var { error: stepErr } = await supabase.from("marketing_automation_steps").insert(stepRows);
      if (stepErr) {
        notify({ message: stepErr.message, tone: "error" });
        setCreating(false);
        return;
      }
    }

    notify({ message: `"${template.name}" automation created! Customize your email templates and activate.`, tone: "success" });
    setCreating(false);
    setSelectedTemplate(null);
    setShowGallery(false);
    router.push("/marketing/automations/" + newAutoId);
  }

  async function toggleStatus(a: Automation) {
    var newStatus = a.status === "active" ? "paused" : "active";
    var { error } = await supabase
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

  async function deleteAutomation(id: string) {
    if (!confirm("Delete this automation? This cannot be undone.")) return;
    var { error } = await supabase.from("marketing_automations").delete().eq("id", id);
    if (error) {
      notify({ message: error.message, tone: "error" });
      return;
    }
    setAutomations(automations.filter((a) => a.id !== id));
    notify({ message: "Automation deleted.", tone: "success" });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  /* ─── TEMPLATE DETAIL MODAL ─── */
  if (selectedTemplate) {
    var t = selectedTemplate;
    var Icon = t.icon;
    var tier = TIER_INFO[t.tier];
    var stepIcons: Record<string, { icon: any; label: string; color: string }> = {
      send_email: { icon: Envelope, label: "Send Email", color: "text-blue-600" },
      delay: { icon: Clock, label: "Wait", color: "text-orange-600" },
      condition: { icon: TrendUp, label: "Check", color: "text-purple-600" },
      generate_voucher: { icon: Gift, label: "Create Voucher", color: "text-emerald-600" },
    };
    return (
      <div className="space-y-6">
        <button
          onClick={() => setSelectedTemplate(null)}
          className="flex items-center gap-1.5 text-sm font-medium"
          style={{ color: "var(--ck-text-muted)" }}
        >
          <X size={14} /> Back to templates
        </button>

        {/* Header */}
        <div
          className="rounded-xl border p-6"
          style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
        >
          <div className="flex items-start gap-4">
            <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${t.iconBg}`}>
              <Icon size={24} className={t.iconColor} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-lg font-bold" style={{ color: "var(--ck-text-strong)" }}>{t.name}</h1>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tier.bg} ${tier.text}`}>
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
              className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--ck-accent)" }}
            >
              {creating ? "Creating..." : "Use This Template"}
              {!creating && <ArrowRight size={14} />}
            </button>
          </div>
        </div>

        {/* Why this works */}
        <div
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <TrendUp size={16} className="text-emerald-600" />
            <h2 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Why This Works</h2>
          </div>
          <p className="text-sm" style={{ color: "var(--ck-text)" }}>{t.benefit}</p>
        </div>

        {/* How it works — step by step */}
        <div
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
        >
          <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--ck-text-strong)" }}>How It Works</h2>
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
        <div
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
        >
          <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--ck-text-strong)" }}>Workflow Preview</h2>

          {/* Trigger */}
          <div className="flex items-center gap-2 mb-2">
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium"
              style={{ borderColor: "var(--ck-accent)", color: "var(--ck-accent)" }}
            >
              <Lightning size={14} />
              Trigger: {t.triggerType.replace(/_/g, " ")}
              {t.triggerConfig.tag && <span className="opacity-70">({t.triggerConfig.tag})</span>}
              {t.triggerConfig.field && <span className="opacity-70">({t.triggerConfig.field})</span>}
            </div>
          </div>

          {/* Steps */}
          <div className="ml-4 border-l-2 pl-4 space-y-2" style={{ borderColor: "var(--ck-border)" }}>
            {t.steps.map((step, i) => {
              var si = stepIcons[step.step_type] || stepIcons.send_email;
              var SIcon = si.icon;
              var label = si.label;
              if (step.step_type === "delay") {
                label = `Wait ${step.config.duration} ${step.config.unit}`;
              } else if (step.step_type === "send_email") {
                label = step.config.subject_override || "Send Email";
              } else if (step.step_type === "condition") {
                label = `Check: ${step.config.condition_type?.replace(/_/g, " ")}`;
              } else if (step.step_type === "generate_voucher") {
                label = `Create ${step.config.amount}% off voucher (${step.config.code_prefix})`;
                if (step.config.voucher_type === "fixed_amount") {
                  label = `Create R${step.config.amount} voucher (${step.config.code_prefix})`;
                }
              }
              return (
                <div key={i} className="flex items-center gap-2 py-1.5">
                  <span
                    className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white"
                    style={{ background: "var(--ck-accent)" }}
                  >
                    {i + 1}
                  </span>
                  <SIcon size={14} className={si.color} />
                  <span className="text-xs" style={{ color: "var(--ck-text)" }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Example email */}
        <div
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
        >
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--ck-text-strong)" }}>Example Email Content</h2>
          <div
            className="rounded-lg border p-4 text-xs whitespace-pre-wrap font-mono leading-relaxed"
            style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
          >
            {t.exampleEmail}
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--ck-text-muted)" }}>
            This is a sample — you'll customise the actual email in your template editor after creating the automation.
          </p>
        </div>

        {/* Bottom CTA */}
        <div className="flex gap-3 pb-4">
          <button
            onClick={() => createFromTemplate(t)}
            disabled={creating}
            className="flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--ck-accent)" }}
          >
            {creating ? "Creating..." : "Use This Template"}
            {!creating && <ArrowRight size={14} />}
          </button>
          <button
            onClick={() => setSelectedTemplate(null)}
            className="rounded-lg border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  /* ─── TEMPLATE GALLERY ─── */
  if (showGallery) {
    var tiers: ("must-have" | "high-value" | "growth")[] = ["must-have", "high-value", "growth"];
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold" style={{ color: "var(--ck-text-strong)" }}>Automation Templates</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--ck-text-muted)" }}>
              Industry-proven workflows designed for tour &amp; activity businesses. Choose a template to get started in seconds.
            </p>
          </div>
          <button
            onClick={() => setShowGallery(false)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
          >
            <X size={14} /> Close
          </button>
        </div>

        {tiers.map((tier) => {
          var info = TIER_INFO[tier];
          var tierTemplates = TEMPLATES.filter((t) => t.tier === tier);
          return (
            <div key={tier}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${info.bg} ${info.text}`}>
                  {info.label}
                </span>
                <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{info.description}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {tierTemplates.map((t) => {
                  var TIcon = t.icon;
                  var tb = triggerBadge[t.triggerType] || triggerBadge.manual;
                  var emailSteps = t.steps.filter((s) => s.step_type === "send_email").length;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setSelectedTemplate(t)}
                      className="rounded-xl border p-4 text-left transition-all hover:shadow-md"
                      style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg ${t.iconBg}`}>
                          <TIcon size={20} className={t.iconColor} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-semibold truncate" style={{ color: "var(--ck-text-strong)" }}>
                              {t.name}
                            </h3>
                            <CaretRight size={14} style={{ color: "var(--ck-text-muted)" }} />
                          </div>
                          <p className="text-xs line-clamp-2 mb-2" style={{ color: "var(--ck-text-muted)" }}>
                            {t.description}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tb.bg} ${tb.text}`}>
                              {tb.label}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                              {t.steps.length} steps
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
                              {emailSteps} email{emailSteps !== 1 ? "s" : ""}
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
        <div className="pt-2 border-t" style={{ borderColor: "var(--ck-border)" }}>
          <button
            onClick={createBlankAutomation}
            className="flex items-center gap-2 rounded-xl border border-dashed p-4 w-full text-left transition-all hover:shadow-sm"
            style={{ borderColor: "var(--ck-border)" }}
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-50">
              <Plus size={20} className="text-gray-400" />
            </div>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
          {automations.length} automation{automations.length !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setShowGallery(true)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
          >
            <Sparkle size={14} /> Browse Templates
          </button>
          <button
            onClick={createBlankAutomation}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--ck-accent)" }}
          >
            <Plus size={14} /> New Automation
          </button>
        </div>
      </div>

      {/* Empty state with template suggestions */}
      {automations.length === 0 ? (
        <div className="space-y-6">
          <div
            className="rounded-xl border p-8 text-center"
            style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
          >
            <Lightning size={32} className="mx-auto mb-3 opacity-30" />
            <h2 className="text-base font-semibold mb-1" style={{ color: "var(--ck-text-strong)" }}>
              No automations yet
            </h2>
            <p className="text-sm mb-4" style={{ color: "var(--ck-text-muted)" }}>
              Automations send emails automatically based on triggers — saving you time and growing your business on autopilot.
            </p>
            <button
              onClick={() => setShowGallery(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
              style={{ background: "var(--ck-accent)" }}
            >
              <Sparkle size={14} /> Browse Templates to Get Started
            </button>
          </div>

          {/* Quick-start suggestions */}
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--ck-text-strong)" }}>
              Recommended for You
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {TEMPLATES.filter((t) => t.tier === "must-have").map((t) => {
                var TIcon = t.icon;
                return (
                  <button
                    key={t.key}
                    onClick={() => { setShowGallery(true); setSelectedTemplate(t); }}
                    className="rounded-xl border p-4 text-left transition-all hover:shadow-md"
                    style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
                  >
                    <div className={`flex items-center justify-center w-9 h-9 rounded-lg mb-3 ${t.iconBg}`}>
                      <TIcon size={18} className={t.iconColor} />
                    </div>
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
          <div
            className="rounded-xl border p-5"
            style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Info size={16} style={{ color: "var(--ck-text-muted)" }} />
              <h3 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>
                How Automations Work
              </h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white" style={{ background: "var(--ck-accent)" }}>1</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--ck-text-strong)" }}>Trigger Fires</span>
                </div>
                <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                  Something happens — a new contact signs up, a booking completes, a tag is added, or a date arrives (like a birthday).
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white" style={{ background: "var(--ck-accent)" }}>2</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--ck-text-strong)" }}>Steps Execute</span>
                </div>
                <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                  The workflow runs: send emails, wait for a period, check conditions, or generate discount vouchers — all automatically.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white" style={{ background: "var(--ck-accent)" }}>3</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--ck-text-strong)" }}>Results Grow</span>
                </div>
                <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                  More reviews, more rebookings, more referrals, recovered revenue — all while you focus on running great tours.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ─── AUTOMATIONS TABLE ─── */
        <div
          className="rounded-xl border overflow-x-auto"
          style={{ borderColor: "var(--ck-border)" }}
        >
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr style={{ background: "var(--ck-surface)" }}>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Name</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Trigger</th>
                <th className="text-center px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Status</th>
                <th className="text-center px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Enrolled</th>
                <th className="text-center px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Completed</th>
                <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Created</th>
                <th className="text-right px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {automations.map((a) => {
                var tb = triggerBadge[a.trigger_type] || triggerBadge.manual;
                var sb = statusBadge[a.status] || statusBadge.draft;
                return (
                  <tr key={a.id} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
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
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tb.bg} ${tb.text}`}>
                        {tb.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${sb.bg} ${sb.text}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center" style={{ color: "var(--ck-text)" }}>
                      {a.enrolled_count}
                    </td>
                    <td className="px-4 py-3 text-center" style={{ color: "var(--ck-text)" }}>
                      {a.completed_count}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      {new Date(a.created_at).toLocaleDateString("en-ZA")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {a.status !== "archived" && (
                          <button
                            onClick={() => toggleStatus(a)}
                            className="rounded-lg border p-1.5"
                            style={{ borderColor: "var(--ck-border)" }}
                            title={a.status === "active" ? "Pause" : "Activate"}
                          >
                            {a.status === "active" ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                        )}
                        <button
                          onClick={() => deleteAutomation(a.id)}
                          className="p-1.5 text-red-500 hover:text-red-700"
                          title="Delete"
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
      )}
    </div>
  );
}
