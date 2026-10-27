"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { marketingGoals } from "../../lib/marketing-journey";
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
  revision?: number;
  enrolled_count: number;
  completed_count: number;
  created_at: string;
  steps: AutomationStep[];
  sentLast7Days: number;
}

const triggerBadge: Record<string, { pill: string; label: string }> = {
  contact_added: { pill: "ui-pill-ocean", label: "Contact Added" },
  tag_added: { pill: "ui-pill-accent", label: "Tag Added" },
  post_booking: { pill: "ui-pill-success", label: "Post Booking" },
  booking_inactive: { pill: "ui-pill-ocean", label: "Welcome back" },
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
  tier: "must-have" | "high-value" | "growth";
  triggerType: string;
  triggerConfig: Record<string, any>;
  steps: { step_type: string; config: Record<string, any> }[];
  exampleEmail: string;
}

const TEMPLATES: AutomationTemplate[] = [
  {
    key: "welcome-series",
    name: "Welcome Series",
    tier: "must-have",
    triggerType: "contact_added",
    triggerConfig: {},
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "Welcome to {business_name}: Your Adventure Starts Here" } },
      { step_type: "delay", config: { duration: 3, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Our Most Popular Tours: See Why Guests Love Us" } },
      { step_type: "delay", config: { duration: 4, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, Ready to Plan Your First Visit?" } },
    ],
    exampleEmail: "Subject: Welcome to {business_name}\n\nHi {first_name},\n\nWelcome! We’ll send trip tips, exclusive offers, early tour access, and recent photos and stories.\n\n[Browse Tours]",
  },
  {
    key: "post-tour-review",
    name: "Post-Tour Review Request",
    tier: "must-have",
    triggerType: "tag_added",
    triggerConfig: { tag: "completed-tour" },
    steps: [
      { step_type: "delay", config: { duration: 3, unit: "hours" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "How Was Your Experience, {first_name}?" } },
      { step_type: "delay", config: { duration: 5, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Quick Favour: Your Review Helps Other Adventurers" } },
    ],
    exampleEmail: "Subject: How was your trip, Sarah?\n\nHi Sarah,\n\nThanks for joining us today. A short review helps other guests choose a trip.\n\n[Leave a Google Review] [Leave a TripAdvisor Review]",
  },
  {
    key: "win-back",
    name: "Welcome-back email sequence",
    tier: "must-have",
    triggerType: "booking_inactive",
    triggerConfig: { days_since_last_booking: 90 },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "We Miss You, {first_name}! See What's New" } },
      { step_type: "delay", config: { duration: 14, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, Plan Another Day With Us" } },
      { step_type: "delay", config: { duration: 21, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "One More Invitation From {business_name}" } },
    ],
    exampleEmail: "Subject: Join us again, James\n\nHi James,\n\nIt’s been a while. We’d love to see you on another trip.\n\n[Browse Tours]",
  },
  {
    key: "birthday-special",
    name: "Birthday Special",
    tier: "high-value",
    triggerType: "date_field",
    triggerConfig: { field: "date_of_birth", days_before: 0 },
    steps: [
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 15, code_prefix: "BDAY", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Happy Birthday, {first_name}! Here's a Gift From Us" } },
      { step_type: "delay", config: { duration: 14, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Birthday Voucher Expires Soon. Don't Miss Out!" } },
    ],
    exampleEmail: "Subject: Happy birthday, Emma!\n\nHi Emma,\n\nHere’s 15% off your next booking.\nCode: BDAY-EMMA-X7K2\nValid until: 25 April 2026\n\n[Use Birthday Discount]",
  },
  {
    key: "referral-program",
    name: "Referral Request",
    tier: "high-value",
    triggerType: "tag_added",
    triggerConfig: { tag: "left-review" },
    steps: [
      { step_type: "delay", config: { duration: 2, unit: "days" } },
      { step_type: "generate_voucher", config: { voucher_type: "fixed_amount", amount: 100, code_prefix: "REFER", valid_days: 90 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, Share the Adventure and Get R100 Off" } },
    ],
    exampleEmail: "Subject: Share a trip and get R100 off\n\nHi {first_name},\n\nThanks for your review. Share this code with friends; you both get a reward when they book.\n\nYour reward: R100 off your next trip\nCode: REFER-{first_name}-X9P3\n\n[Share via WhatsApp] [Copy Code]",
  },
  {
    key: "vip-treatment",
    name: "VIP Customer Treatment",
    tier: "high-value",
    triggerType: "tag_added",
    triggerConfig: { tag: "vip" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, You're Now a VIP. Here's What That Means" } },
      { step_type: "delay", config: { duration: 7, unit: "days" } },
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 20, code_prefix: "VIP", valid_days: 60 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Exclusive VIP Offer: 20% Off Any Tour" } },
    ],
    exampleEmail: "Subject: Your VIP benefits\n\nHi {first_name},\n\nThanks for coming back. Your VIP benefits include priority booking, early access to new trips, exclusive discounts and direct contact for special requests.\n\nWe’ll email your offer soon.",
  },
  {
    key: "seasonal-launch",
    name: "New Season Announcement",
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
    exampleEmail: "Subject: Next season\n\nHi {first_name},\n\nComing next season: new routes, upgraded gear, extended seasonal tours and upgraded photo packages. Bookings open on 1 October; VIPs and early birds get first pick.\n\nAn early-bird offer will follow by email.\n\n[View All Tours]",
  },
  {
    key: "booking-anniversary",
    name: "Booking Anniversary",
    tier: "growth",
    triggerType: "tag_added",
    triggerConfig: { tag: "anniversary-1yr" },
    steps: [
      { step_type: "generate_voucher", config: { voucher_type: "percentage", amount: 10, code_prefix: "ANNIV", valid_days: 30 } },
      { step_type: "send_email", config: { template_id: "", subject_override: "{first_name}, This Time Last Year You Were Out There With Us" } },
    ],
    exampleEmail: "Subject: A year since your trip\n\nHi {first_name},\n\nA year ago today you joined us. Come back for 10% off any tour.\nCode: ANNIV-{first_name}-K4M2\n\n[Book Again] [Try Another Tour]",
  },
  {
    key: "photo-share",
    name: "Post-Tour Photo Delivery",
    tier: "growth",
    triggerType: "tag_added",
    triggerConfig: { tag: "photos-ready" },
    steps: [
      { step_type: "send_email", config: { template_id: "", subject_override: "Your Trip Photos Are Ready, {first_name}!" } },
      { step_type: "delay", config: { duration: 3, unit: "days" } },
      { step_type: "send_email", config: { template_id: "", subject_override: "Share Your Adventure and Tag Us" } },
    ],
    exampleEmail: "Subject: Your trip photos\n\nHi {first_name},\n\nYour photos are ready to download and share. Tag us if you post them on Instagram or Facebook.\n\n[View Gallery]",
  },
];

const TIER_INFO: Record<string, { label: string; pill: string }> = {
  "must-have": { label: "Must-Have", pill: "ui-pill-danger" },
  "high-value": { label: "High-Value", pill: "ui-pill-amber" },
  "growth": { label: "Growth", pill: "ui-pill-ocean" },
};

export default function AutomationsPage() {
  const { businessId, timezone } = useBusinessContext();
  const router = useRouter();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [goalAudiences, setGoalAudiences] = useState<Record<string, { included: number | null }> | null>(null);
  const [loadError, setLoadError] = useState(false);
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

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("recipe");
    const recipe = TEMPLATES.find(template => template.key === key);
    if (recipe) { setSelectedTemplate(recipe); setShowGallery(true); }
  }, []);

  const visibleAutomations = showArchived ? automations : automations.filter((a) => a.status !== "archived");
  const archivedCount = automations.filter((a) => a.status === "archived").length;

  async function load() {
    setLoading(true);
    const [{ data, error }, goals] = await Promise.all([supabase
      .from("marketing_automations")
      .select("id, name, trigger_type, trigger_config, status, revision, enrolled_count, completed_count, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false }),
      supabase.rpc("marketing_goal_audiences", { p_business_id: businessId }),
    ]);
    setLoadError(Boolean(error));
    setGoalAudiences(goals.error ? null : goals.data);
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
    router.push("/marketing/automations/new");
  }

  async function createFromTemplate(template: AutomationTemplate) {
    setCreating(true);
    // Create automation
    const { data: autoData, error: autoErr } = await supabase
      .from("marketing_automations")
      .insert({
        business_id: businessId,
        name: template.name,
        description: null,
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
        ? `"${template.name}" created with ${linkedTemplates} designed email${linkedTemplates === 1 ? "" : "s"} already linked. Review your draft and confirm activation when ready.`
        : `"${template.name}" draft created. Review your emails and confirm activation when ready.`,
      tone: "success",
    });
    setCreating(false);
    setSelectedTemplate(null);
    setShowGallery(false);
    router.push("/marketing/automations/" + newAutoId);
  }

  async function toggleStatus(a: Automation) {
    if (a.status !== "active") { router.push("/marketing/automations/" + a.id); return; }
    const newStatus = "paused";
    const { error } = await supabase
      .from("marketing_automations")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", a.id);
    if (error) {
      notify({ message: error.message, tone: "error" });
      return;
    }
    setAutomations(automations.map((x) => (x.id === a.id ? { ...x, status: newStatus } : x)));
    notify({ message: "Automation paused.", tone: "success" });
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
    if (a.id === "5bb1d74b-8634-4fec-9c42-f6f13cc1c33f") {
      notify({ message: "This review draft is protected. Use Archive to preserve its history.", tone: "warning" }); return;
    }
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
          {showGallery ? "Back to templates" : "Back to automations"}
        </button>

        {/* Header */}
        <div className="ui-card p-6 anim-fade-up">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-display text-[22px] font-semibold leading-tight" style={{ color: "var(--ck-text-strong)" }}>{t.name}</h2>
                <span className={"ui-status " + tier.pill}>
                  {tier.label}
                </span>
              </div>
              <p className="text-sm mt-2" role="status">Creates a draft.</p>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button data-demo-action="automation.template"
              onClick={() => createFromTemplate(t)}
              disabled={creating}
              className="ui-btn ui-btn-primary disabled:opacity-50"
            >
              {creating ? "Creating..." : "Use This Template"}
            </button>
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
            Sample only; saved drafts may differ. Check claims, links, offers and dates. Audience and delivery are not estimated here.
          </p>
        </div>

        {/* Bottom CTA */}
        <div className="flex gap-3 pb-4">
          <button data-demo-action="automation.template"
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
            <h2 className="font-display text-[26px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Automation Templates</h2>
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
                            {!["welcome-series", "win-back"].includes(t.key) && <span className="ui-status ui-pill-neutral">Delivery unavailable</span>}
                          </div>
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
          <button data-demo-action="automation.create"
            onClick={createBlankAutomation}
            className="flex items-center gap-3 rounded-xl border border-dashed p-4 w-full text-left transition-all hover:border-[var(--ck-border-strong)] hover:bg-[var(--ck-surface-warm)]"
            style={{ borderColor: "var(--ck-border-strong)" }}
          >
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Start From Scratch</h3>
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
      <div className="flex flex-wrap items-center justify-between gap-3 anim-fade-up anim-d1">
        <div><h2 className="text-lg font-semibold">Automations</h2><p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
          {loadError ? "Saved automations unavailable" : <><span className="font-display text-base font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{automations.length}</span> saved automation{automations.length !== 1 ? "s" : ""}</>}
        </p></div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowGallery(true)}
            className="ui-btn ui-btn-ghost"
          >
            Browse Templates
          </button>
          <button data-demo-action="automation.create"
            onClick={createBlankAutomation}
            className="ui-btn ui-btn-primary"
          >
            New Automation
          </button>
        </div>
      </div>

      <section aria-label="Automation templates" className="space-y-3">
        <div className="ui-card divide-y" style={{ borderColor: "var(--ck-border-subtle)" }}>
          {marketingGoals.map(goal => <article key={goal.key} className="p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1 max-w-prose">
              <h3 className="font-semibold">{goal.title}</h3>
              <p className="text-sm ui-text-muted">{goal.key === "vouchers" ? "Automatic reminders are not available yet."
                : goalAudiences?.[goal.key]?.included != null
                  ? `${goalAudiences[goal.key].included} matching contacts${goal.key === "winback" ? " · Last booked 90+ days ago" : ""}`
                  : "Matching contacts could not be checked."}</p>
            </div>
            {goal.key === "vouchers"
              ? <Link className="ui-btn ui-btn-soft shrink-0 min-h-11" href="/vouchers">View vouchers</Link>
              : <button type="button" className="ui-btn ui-btn-soft shrink-0 min-h-11" aria-label={`Preview sequence: ${goal.title}`} onClick={() => setSelectedTemplate(TEMPLATES.find(template => template.key === goal.recipe) || null)}>Preview sequence</button>}
          </article>)}
        </div>
      </section>

      {loadError ? <p role="alert" className="ui-card p-5">Saved automations could not be loaded. Refresh to try again.</p> : automations.length > 0 ? (
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
        <div className="ui-table-container ui-card overflow-x-auto">
          <table role="table" className="ui-responsive-table w-full text-sm min-w-[1050px]">
            <thead>
              <tr style={{ background: "var(--ck-surface-sunken)" }}>
                <th scope="col" className="text-left px-4 py-3 ui-mono-label !text-[10px]">Name</th>
                <th scope="col" className="text-left px-4 py-3 ui-mono-label !text-[10px]">Trigger</th>
                <th scope="col" className="text-left px-4 py-3 ui-mono-label !text-[10px]">Flow</th>
                <th scope="col" className="text-center px-4 py-3 ui-mono-label !text-[10px]">Status</th>
                <th scope="col" className="text-center px-4 py-3 ui-mono-label !text-[10px]">Enrolled</th>
                <th scope="col" className="text-center px-4 py-3 ui-mono-label !text-[10px]">Completed</th>
                <th scope="col" className="text-center px-4 py-3 ui-mono-label !text-[10px]">Sent (7d)</th>
                <th scope="col" className="text-left px-4 py-3 ui-mono-label !text-[10px]">Created</th>
                <th scope="col" className="text-right px-4 py-3 ui-mono-label !text-[10px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleAutomations.map((a) => {
                const tb = triggerBadge[a.trigger_type] || triggerBadge.manual;
                const sb = statusBadge[a.status] || statusBadge.draft;
                return (
                  <tr key={a.id} className="border-t transition-colors hover:bg-[var(--ck-surface-sunken)]" style={{ borderColor: "var(--ck-border-subtle)" }}>
                    <td data-label="Name" className="px-4 py-3">
                      <button
                        onClick={() => router.push("/marketing/automations/" + a.id)}
                        className="font-medium text-left hover:underline"
                        style={{ color: "var(--ck-text-strong)" }}
                      >
                        {a.name}
                      </button>
                    </td>
                    <td data-label="Trigger" className="px-4 py-3">
                      <span className={"ui-status " + tb.pill}>
                        {tb.label}
                      </span>
                      <p className="text-xs mt-1 max-w-[200px]" style={{ color: "var(--ck-text-muted)" }}>
                        {triggerSentence({ trigger_type: a.trigger_type, trigger_config: a.trigger_config })}
                      </p>
                    </td>
                    <td data-label="Flow" className="px-4 py-3 text-xs max-w-[180px]" style={{ color: "var(--ck-text-muted)" }}>
                      {flowSummary(a.steps || [])}
                    </td>
                    <td data-label="Status" className="px-4 py-3 text-center">
                      <span className={"ui-status " + sb.pill}>
                        {a.status}
                      </span>
                    </td>
                    <td data-label="Enrolled" className="px-4 py-3 text-center font-display tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                      {a.enrolled_count}
                    </td>
                    <td data-label="Completed" className="px-4 py-3 text-center font-display tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                      {a.completed_count}
                    </td>
                    <td data-label="Sent (7d)" className="px-4 py-3 text-center font-display tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                      {a.sentLast7Days ?? 0}
                    </td>
                    <td data-label="Created" className="px-4 py-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      {new Date(a.created_at).toLocaleDateString("en-ZA", { timeZone: timezone })}
                    </td>
                    <td data-label="Actions" className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {a.status !== "archived" && (
                          <button data-demo-action={a.status === "active" ? "automation.pause" : "automation.activate"}
                            onClick={() => toggleStatus(a)}
                            disabled={a.status !== "active"}
                            className="inline-flex items-center justify-center rounded-lg border p-1.5 transition-colors hover:bg-[var(--ck-surface-sunken)]"
                            style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text)" }}
                            title={a.status === "active" ? "Pause" : "Ask BookingTours to enable email sending"}
                          >
                            {a.status === "active" ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                        )}
                        {a.status === "archived" ? (
                          <button data-demo-action="automation.restore"
                            onClick={() => unarchiveAutomation(a)}
                            className="ui-btn ui-btn-ghost !h-8 !px-2 !text-[11px]"
                            title="Restore to draft"
                          >
                            Unarchive
                          </button>
                        ) : (
                          <button data-demo-action="automation.archive"
                            onClick={() => archiveAutomation(a)}
                            className="ui-btn ui-btn-ghost !h-8 !px-2 !text-[11px]"
                            title="Hide from active list, preserve history"
                          >
                            Archive
                          </button>
                        )}
                        {(!a.revision && a.id !== "5bb1d74b-8634-4fec-9c42-f6f13cc1c33f") && <button data-demo-action="automation.delete"
                          onClick={() => deleteAutomation(a)}
                          className="inline-flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-[var(--ck-danger-soft)]"
                          style={{ color: "var(--ck-danger)" }}
                          title="Delete permanently"
                        >
                          <Trash size={13} />
                        </button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      ) : null}
    </div>
  );
}
