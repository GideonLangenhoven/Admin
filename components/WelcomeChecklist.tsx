"use client";

// First-login welcome tour. A paged, role-aware walkthrough of the dashboard:
// one step per nav section, ending (for MAIN_ADMIN/SUPER_ADMIN) in a live
// getting-started checklist driven by real tenant data.
//
// Dismissal semantics (admin_users.onboarding_completed_at via self-scoped RPCs
// from migration 20260711200000):
//  - "Finish" or "Don't show this again" persist — the tour never auto-opens again.
//  - X / Esc snoozes for this session only (accidental-close protection).
//  - It can always be replayed: window event "ck-welcome-tour-open"
//    (dispatched by the help assistant's "Show me around" chip).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  ChartLineUp,
  ChatsCircle,
  CheckCircle,
  Circle,
  Lifebuoy,
  Megaphone,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { supabase } from "../app/lib/supabase";
import { useBusinessContext } from "./BusinessContext";

type Feature = { title: string; detail: string; href: string };
type TourStep = {
  key: string;
  icon: React.ReactNode;
  kicker: string;
  title: string;
  blurb: string;
  features: Feature[];
};
type ChecklistItem = { key: string; title: string; detail: string; href: string; done?: boolean };

const SESSION_SNOOZE_KEY = "ck_welcome_snoozed";
export const WELCOME_TOUR_EVENT = "ck-welcome-tour-open";

function buildSteps(isPrivileged: boolean): TourStep[] {
  const steps: TourStep[] = [
    {
      key: "operations",
      icon: <CalendarCheck size={22} weight="duotone" />,
      kicker: "Operations",
      title: "Run every departure from one place",
      blurb: "Your day-to-day home: who's booked, who's paid, who's checked in.",
      features: [
        { title: "Bookings", detail: "Every booking grouped by day. Check in, reschedule, refund or message a guest.", href: "/bookings" },
        { title: "New booking", detail: "Take phone and walk-in bookings. Send a payment link or mark paid on the spot.", href: "/new-booking" },
        { title: "Slots", detail: "Open departures with dates, times and capacity. Close or weather-cancel a day in two clicks.", href: "/slots" },
      ],
    },
    {
      key: "customers",
      icon: <ChatsCircle size={22} weight="duotone" />,
      kicker: "Customers",
      title: "Every conversation, one inbox",
      blurb: "WhatsApp and website chat land in the same place. The bot answers routine questions and hands over to you when a guest asks for a human.",
      features: [
        { title: "Inbox", detail: "Live two-way chat. Conversations needing a human float to the top.", href: "/inbox" },
        // Operator roles can have these sections hidden per-user, so only
        // privileged roles get toured through them.
        ...(isPrivileged
          ? [
              { title: "Refunds", detail: "Requests arrive in a queue with the policy-correct amount already worked out.", href: "/refunds" },
              { title: "Vouchers", detail: "Sell gift vouchers and redeem them at checkout or in person.", href: "/vouchers" },
              { title: "Reviews", detail: "Google reviews in one feed, plus automatic post-trip review requests.", href: "/reviews" },
            ]
          : []),
      ],
    },
  ];

  if (isPrivileged) {
    steps.push(
      {
        key: "revenue",
        icon: <ChartLineUp size={22} weight="duotone" />,
        kicker: "Revenue",
        title: "Know exactly how the business is doing",
        blurb: "Money in, money owed, and how full your boats really are.",
        features: [
          { title: "Invoices", detail: "Issued automatically on payment; resend or download any time.", href: "/invoices" },
          { title: "Pricing", detail: "Seasonal and per-slot price overrides without touching your base rates.", href: "/pricing" },
          { title: "Reports", detail: "Revenue, capacity and channel performance at a glance.", href: "/reports" },
        ],
      },
      {
        key: "growth",
        icon: <Megaphone size={22} weight="duotone" />,
        kicker: "Growth",
        title: "Bring guests back without the busywork",
        blurb: "Campaigns and automations that run themselves once set up.",
        features: [
          { title: "Marketing", detail: "Email campaigns, designed templates and date-triggered automations with promo codes.", href: "/marketing" },
          { title: "Broadcasts", detail: "WhatsApp announcements to affected guests: weather, delays, gathering points.", href: "/broadcasts" },
        ],
      },
    );
  }

  steps.push({
    key: "help",
    icon: <Lifebuoy size={22} weight="duotone" />,
    kicker: "Always at hand",
    title: "Help is one click away, always",
    blurb: "Anything this tour didn't cover, the help assistant can explain in context.",
    features: [
      { title: "Help assistant", detail: "The chat bubble in the corner answers “how do I…” questions and links you straight to the right page.", href: "/" },
      ...(isPrivileged
        ? [{ title: "Settings", detail: "Tours, booking-site branding, payment and WhatsApp credentials, auto-messages and payment reminders all live here.", href: "/settings" }]
        : []),
    ],
  });

  return steps;
}

export default function WelcomeChecklist() {
  const { businessId, businessName, role } = useBusinessContext();
  const [show, setShow] = useState(false);
  const [replay, setReplay] = useState(false);
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<ChecklistItem[]>([]);

  const isPrivileged = role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
  const tourSteps = buildSteps(isPrivileged);
  // Pages: 0 = welcome, 1..n = tour sections, last (privileged only) = checklist.
  const totalPages = 1 + tourSteps.length + (isPrivileged ? 1 : 0);
  const lastPage = totalPages - 1;

  const loadChecklist = useCallback(async () => {
    if (!isPrivileged || !businessId) return;
    const [tours, slots, bookings] = await Promise.all([
      supabase.from("tours").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("slots").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    ]);
    setItems([
      { key: "tours", title: "Create your tours", detail: "Names, descriptions, durations and prices: the products customers book.", href: "/settings", done: (tours.count || 0) > 0 },
      { key: "slots", title: "Open bookable slots", detail: "Departures with dates, times and capacity. No slots, no bookings.", href: "/slots", done: (slots.count || 0) > 0 },
      { key: "payments", title: "Connect payments & WhatsApp", detail: "Add your Yoco and WhatsApp credentials under Integration Credentials.", href: "/settings" },
      { key: "branding", title: "Brand your booking site", detail: "Logo, colours, policies and FAQ under Booking Site Configuration.", href: "/settings" },
      { key: "booking", title: "Take your first booking", detail: "Create one manually or share your booking site link.", href: "/new-booking", done: (bookings.count || 0) > 0 },
    ]);
  }, [businessId, isPrivileged]);

  const load = useCallback(async () => {
    if (typeof window !== "undefined" && (sessionStorage.getItem(SESSION_SNOOZE_KEY) || localStorage.getItem("ck_welcome_done"))) return;
    const { data, error } = await supabase.rpc("get_my_admin_onboarding");
    // No row (not an admin) or RPC missing (migration not applied yet): stay hidden.
    if (error || !Array.isArray(data) || data.length === 0) return;
    if (data[0].onboarding_completed_at) return;
    await loadChecklist();
    setStep(0);
    setShow(true);
  }, [loadChecklist]);

  useEffect(() => {
    if (!businessId || !role) return;
    load();
  }, [businessId, role, load]);

  // Replay entry point (help assistant, or anywhere else): always opens,
  // even after the tour was completed.
  useEffect(() => {
    async function onOpen() {
      await loadChecklist();
      setReplay(true);
      setStep(0);
      setShow(true);
    }
    window.addEventListener(WELCOME_TOUR_EVENT, onOpen);
    return () => window.removeEventListener(WELCOME_TOUR_EVENT, onOpen);
  }, [loadChecklist]);

  // Keyboard: arrows page, Escape snoozes.
  useEffect(() => {
    if (!show) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        sessionStorage.setItem(SESSION_SNOOZE_KEY, "1");
        setShow(false);
      }
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, lastPage));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, lastPage]);

  if (!show) return null;

  function snooze() {
    sessionStorage.setItem(SESSION_SNOOZE_KEY, "1");
    setShow(false);
  }

  async function complete() {
    setShow(false);
    if (replay) return; // already persisted the first time round
    const { error } = await supabase.rpc("complete_my_admin_onboarding");
    // If persistence fails (e.g. transient network), don't nag again on this
    // device — the tour stays reachable from the help assistant.
    if (error) localStorage.setItem("ck_welcome_done", "1");
  }

  const doneCount = items.filter((i) => i.done).length;
  const isWelcome = step === 0;
  const isChecklist = isPrivileged && step === lastPage;
  const section = !isWelcome && !isChecklist ? tourSteps[step - 1] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="ui-card flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden" style={{ boxShadow: "var(--ck-shadow-lg)" }}>
        <style>{`@keyframes ck-tour-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}`}</style>

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5">
          <div className="ui-mono-label" style={{ color: "var(--ck-accent)" }}>
            {isWelcome ? "Welcome to BookingTours" : isChecklist ? "Getting set up" : `Tour · ${section!.kicker}`}
          </div>
          <button type="button" onClick={snooze} aria-label="Close for now" className="-mr-2 -mt-1 rounded p-1.5 transition-colors hover:bg-black/5" style={{ color: "var(--ck-text-muted)" }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div key={step} className="flex-1 overflow-y-auto px-6 pb-2" style={{ animation: "ck-tour-in .22s ease-out" }}>
          {isWelcome && (
            <div className="pb-4 pt-2">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "var(--ck-success-soft, rgba(18,94,64,0.08))", color: "var(--ck-accent)" }}>
                <Sparkle size={26} weight="duotone" />
              </div>
              <h2 className="text-[22px] font-semibold leading-snug" style={{ color: "var(--ck-text-strong)" }}>
                {isPrivileged ? `Let's get ${businessName || "your business"} taking bookings` : `Welcome aboard${businessName ? " to " + businessName : ""}`}
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ck-text-muted)" }}>
                {isPrivileged
                  ? "This dashboard runs your whole operation: bookings, guest chat, payments and marketing. The two-minute tour shows you where everything lives, then a short checklist gets you to your first paid booking."
                  : "This dashboard is where the day-to-day work happens: bookings, guest chat and departures. The one-minute tour shows you where everything lives."}
              </p>
              <p className="mt-3 text-[13px]" style={{ color: "var(--ck-text-muted)" }}>
                You can replay this any time from the help assistant in the corner.
              </p>
            </div>
          )}

          {section && (
            <div className="pb-4 pt-2">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "var(--ck-success-soft, rgba(18,94,64,0.08))", color: "var(--ck-accent)" }}>
                {section.icon}
              </div>
              <h2 className="text-[20px] font-semibold leading-snug" style={{ color: "var(--ck-text-strong)" }}>{section.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--ck-text-muted)" }}>{section.blurb}</p>
              <div className="mt-4 space-y-2">
                {section.features.map((f) => (
                  <Link
                    key={f.title}
                    href={f.href}
                    onClick={snooze}
                    className="block rounded-xl border p-3 transition-colors hover:border-transparent"
                    style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-warm)" }}
                  >
                    <span className="block text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{f.title}</span>
                    <span className="block text-[13px] leading-snug" style={{ color: "var(--ck-text-muted)" }}>{f.detail}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {isChecklist && (
            <div className="pb-4 pt-2">
              <h2 className="text-[20px] font-semibold leading-snug" style={{ color: "var(--ck-text-strong)" }}>
                Five steps to your first paid booking
              </h2>
              <p className="mt-1.5 text-sm" style={{ color: "var(--ck-text-muted)" }}>
                Your progress is picked up automatically as you go.
              </p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--ck-border-subtle)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${(doneCount / Math.max(items.length, 1)) * 100}%`, background: "var(--ck-accent)" }} />
              </div>
              <div className="mt-3 space-y-2">
                {items.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={snooze}
                    className="flex items-start gap-3 rounded-xl border p-3 transition-colors hover:border-transparent"
                    style={{ borderColor: "var(--ck-border-subtle)", background: item.done ? "var(--ck-success-soft, rgba(18,94,64,0.06))" : "var(--ck-surface-warm)" }}
                  >
                    <span className="mt-0.5 shrink-0" style={{ color: item.done ? "var(--ck-success, var(--ck-accent))" : "var(--ck-accent)" }}>
                      {item.done ? <CheckCircle size={20} weight="fill" /> : <Circle size={20} />}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold" style={{ color: "var(--ck-text-strong)", textDecoration: item.done ? "line-through" : "none", opacity: item.done ? 0.7 : 1 }}>
                        {item.title}
                      </span>
                      <span className="block text-[13px] leading-snug" style={{ color: "var(--ck-text-muted)" }}>{item.detail}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer: progress dots + actions */}
        <div className="flex items-center justify-between gap-3 px-6 py-4" style={{ borderTop: "1px solid var(--ck-border-subtle)" }}>
          <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${totalPages}`}>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => setStep(i)}
                className="h-1.5 rounded-full transition-all"
                style={{ width: i === step ? 18 : 6, background: i === step ? "var(--ck-accent)" : "var(--ck-border-strong)" }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!replay && (
              <button type="button" className="ui-btn ui-btn-ghost" onClick={complete}>
                Don&apos;t show this again
              </button>
            )}
            {step > 0 && (
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setStep((s) => Math.max(s - 1, 0))}>
                Back
              </button>
            )}
            {step < lastPage ? (
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => setStep((s) => Math.min(s + 1, lastPage))}>
                {isWelcome ? "Start the tour" : "Next"}
              </button>
            ) : (
              <button type="button" className="ui-btn ui-btn-primary" onClick={complete}>
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
