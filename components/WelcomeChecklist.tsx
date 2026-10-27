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
import { useCallback, useEffect, useRef, useState } from "react";
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
      blurb: "Today's bookings, payments and check-ins.",
      features: [
        { title: "Bookings", detail: "Bookings by day. Check in, reschedule, refund or message guests.", href: "/bookings" },
        { title: "New booking", detail: "Add phone or walk-in bookings. Send a payment link or record payment.", href: "/new-booking" },
        { title: "Slots", detail: "Set departures and capacity. Close or cancel days for weather.", href: "/slots" },
      ],
    },
    {
      key: "customers",
      icon: <ChatsCircle size={22} weight="duotone" />,
      kicker: "Customers",
      title: "Every conversation, one inbox",
      blurb: "WhatsApp and website chat in one inbox. The bot handles FAQs; guests can ask for staff.",
      features: [
        { title: "Inbox", detail: "Live two-way chat. Conversations needing a human float to the top.", href: "/inbox" },
        // Operator roles can have these sections hidden per-user, so only
        // privileged roles get toured through them.
        ...(isPrivileged
          ? [
              { title: "Refunds", detail: "Refund requests with amounts calculated from your policy.", href: "/refunds" },
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
        blurb: "Revenue, balances due and capacity used.",
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
        blurb: "Set up email campaigns and automations.",
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
    blurb: "Ask the help assistant about other tasks.",
    features: [
      { title: "Help assistant", detail: "Use the help chat for answers and page links.", href: "/" },
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  const isPrivileged = role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
  const tourSteps = buildSteps(isPrivileged);
  // Pages: 0 = welcome, 1..n = tour sections, last (privileged only) = checklist.
  const totalPages = 1 + tourSteps.length + (isPrivileged ? 1 : 0);
  const lastPage = totalPages - 1;

  const loadChecklist = useCallback(async () => {
    if (!isPrivileged || !businessId) return;
    const session = (await supabase.auth.getSession()).data.session;
    const [tours, slots, bookings, branding, credentials] = await Promise.all([
      supabase.from("tours").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("active", true),
      supabase.from("slots").select("capacity_total,booked,held").eq("business_id", businessId).eq("status", "OPEN").gt("start_time", new Date(Date.now() + 60 * 60 * 1000).toISOString()).limit(100),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("business_id", businessId).in("status", ["PAID", "COMPLETED"]).eq("payment_status", "CAPTURED"),
      supabase.from("businesses").select("logo_url,booking_site_url").eq("id", businessId).maybeSingle(),
      session ? fetch("/api/credentials?business_id=" + encodeURIComponent(businessId), { headers: { Authorization: "Bearer " + session.access_token } }).then(async response => response.ok ? response.json() : null).catch(() => null) : Promise.resolve(null),
    ]);
    const bookable = slots.data?.some(slot => slot.capacity_total - slot.booked - (slot.held || 0) > 0);

    setItems([
      { key: "tours", title: "Create your tours", detail: "Names, descriptions, durations and prices: the products customers book.", href: "/settings#tours", done: (tours.count || 0) > 0 },
      { key: "slots", title: "Open bookable slots", detail: "Departures with dates, times and capacity. No slots, no bookings.", href: "/slots", done: !!bookable },
      { key: "payments", title: "Connect payments & WhatsApp", detail: "Add your Yoco and WhatsApp credentials under Integration Credentials.", href: "/settings#credentials", done: !!credentials?.yoco && !credentials?.yoco_test_mode && !!credentials?.wa },
      { key: "branding", title: "Brand your booking site", detail: "Logo, colours, policies and FAQ under Booking Site Configuration.", href: "/settings#site", done: !!branding.data?.logo_url && !!branding.data?.booking_site_url },
      { key: "booking", title: "Take your first booking", detail: "Complete a payment and check the customer confirmation before opening bookings.", href: "/new-booking", done: (bookings.count || 0) > 0 },
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

  // Native modal semantics keep focus inside and restore it when the tour closes.
  useEffect(() => {
    if (!show) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, lastPage));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
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
    <dialog ref={dialogRef} onCancel={snooze} aria-label="Welcome tour" className="m-auto max-h-[92dvh] w-[calc(100%-2rem)] max-w-xl overflow-visible border-0 bg-transparent p-0 backdrop:bg-black/40">
      <div className="ui-card flex max-h-[88dvh] w-full flex-col overflow-hidden" style={{ boxShadow: "var(--ck-shadow-lg)" }}>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4 sm:px-6">
          <div className="ui-mono-label" style={{ color: "var(--ck-accent)" }}>
            {isWelcome ? "Welcome to BookingTours" : isChecklist ? "Getting set up" : `Tour · ${section!.kicker}`}
          </div>
          <button type="button" onClick={snooze} aria-label="Close for now" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--ck-surface-sunken)]" style={{ color: "var(--ck-text-muted)" }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div key={step} className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 sm:px-6" aria-live="polite">
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
                  ? "Take a tour of bookings, chat, payments and marketing. Then follow the setup checklist."
                  : "Take a tour of bookings, guest chat and departures."}
              </p>
              <p className="mt-3 text-[13px]" style={{ color: "var(--ck-text-muted)" }}>
                Replay the tour from the help chat.
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
                Progress updates automatically.
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
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3 sm:px-6" style={{ borderTop: "1px solid var(--ck-border-subtle)" }}>
          <div className="flex flex-wrap items-center" aria-label={`Step ${step + 1} of ${totalPages}`}>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                aria-current={i === step ? "step" : undefined}
                onClick={() => setStep(i)}
                className="flex h-11 w-8 items-center justify-center rounded-lg"
              >
                <span className="h-1.5 rounded-full" style={{ width: i === step ? 18 : 6, background: i === step ? "var(--ck-accent)" : "var(--ck-border-strong)" }} />
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
    </dialog>
  );
}
