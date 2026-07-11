"use client";

// First-login welcome. Shows once per admin (admin_users.onboarding_completed_at,
// read/written via self-scoped RPCs from migration 20260711200000):
//  - MAIN_ADMIN/SUPER_ADMIN get a getting-started checklist with live progress
//    derived from real tenant data (tours/slots/bookings counts).
//  - Operations roles get a short "here's where everything lives" overview.
// "Set up later" closes for this session; "Don't show this again" persists.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle, Circle, MapTrifold, CalendarPlus, CreditCard, PaintBrush, Ticket, ChatCircleDots, Tray, CloudRain } from "@phosphor-icons/react";
import { supabase } from "../app/lib/supabase";
import { useBusinessContext } from "./BusinessContext";

type ChecklistItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  icon: React.ReactNode;
  done?: boolean;
};

const SESSION_SNOOZE_KEY = "ck_welcome_snoozed";

export default function WelcomeChecklist() {
  const { businessId, businessName, role } = useBusinessContext();
  const [show, setShow] = useState(false);
  const [items, setItems] = useState<ChecklistItem[]>([]);

  const isPrivileged = role === "MAIN_ADMIN" || role === "SUPER_ADMIN";

  const load = useCallback(async () => {
    if (typeof window !== "undefined" && sessionStorage.getItem(SESSION_SNOOZE_KEY)) return;
    const { data, error } = await supabase.rpc("get_my_admin_onboarding");
    // No row (not an admin) or RPC missing (migration not applied yet): stay hidden.
    if (error || !Array.isArray(data) || data.length === 0) return;
    if (data[0].onboarding_completed_at) return;

    if (isPrivileged) {
      // Live progress: count real tenant data so returning to the modal shows
      // ticks for what's already done. head:true = count only, no rows.
      const [tours, slots, bookings] = await Promise.all([
        supabase.from("tours").select("id", { count: "exact", head: true }).eq("business_id", businessId),
        supabase.from("slots").select("id", { count: "exact", head: true }).eq("business_id", businessId),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      ]);
      setItems([
        { key: "tours", title: "Create your tours", detail: "Names, descriptions, durations and prices — the products customers book.", href: "/settings", icon: <MapTrifold size={20} />, done: (tours.count || 0) > 0 },
        { key: "slots", title: "Open bookable slots", detail: "Departures with dates, times and capacity. No slots, no bookings.", href: "/slots", icon: <CalendarPlus size={20} />, done: (slots.count || 0) > 0 },
        { key: "payments", title: "Connect payments & WhatsApp", detail: "Add your Yoco and WhatsApp credentials under Integration Credentials.", href: "/settings", icon: <CreditCard size={20} /> },
        { key: "branding", title: "Brand your booking site", detail: "Logo, colours, policies and FAQ under Booking Site Configuration.", href: "/settings", icon: <PaintBrush size={20} /> },
        { key: "booking", title: "Take your first booking", detail: "Create one manually or share your booking site link.", href: "/new-booking", icon: <Ticket size={20} />, done: (bookings.count || 0) > 0 },
      ]);
    } else {
      setItems([
        { key: "bookings", title: "Bookings", detail: "Every booking, grouped by day — check in, rebook, refund, message.", href: "/bookings", icon: <Ticket size={20} /> },
        { key: "inbox", title: "Inbox", detail: "WhatsApp and web chat in one place. Chats needing you float to the top.", href: "/inbox", icon: <Tray size={20} /> },
        { key: "slots", title: "Slots", detail: "Your departures: create, close, or cancel days for weather.", href: "/slots", icon: <CloudRain size={20} /> },
        { key: "help", title: "Help assistant", detail: "The chat bubble in the corner answers questions about any feature.", href: "/", icon: <ChatCircleDots size={20} /> },
      ]);
    }
    setShow(true);
  }, [businessId, isPrivileged]);

  useEffect(() => {
    if (!businessId || !role) return;
    load();
  }, [businessId, role, load]);

  if (!show) return null;

  function snooze() {
    sessionStorage.setItem(SESSION_SNOOZE_KEY, "1");
    setShow(false);
  }

  async function complete() {
    setShow(false);
    await supabase.rpc("complete_my_admin_onboarding");
  }

  const doneCount = items.filter((i) => i.done).length;
  const hasProgress = isPrivileged;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="ui-card flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden" style={{ boxShadow: "var(--ck-shadow-lg)" }}>
        <div className="px-6 pb-4 pt-6">
          <div className="ui-mono-label" style={{ color: "var(--ck-accent)" }}>Welcome to BookingTours</div>
          <h2 className="mt-1 text-[20px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>
            {isPrivileged ? `Let's get ${businessName || "your business"} taking bookings` : `Welcome aboard${businessName ? " to " + businessName : ""}`}
          </h2>
          <p className="mt-1.5 text-sm" style={{ color: "var(--ck-text-muted)" }}>
            {isPrivileged
              ? "Five steps from empty dashboard to your first paid booking. Your progress is picked up automatically."
              : "Here's where the day-to-day work happens. Everything below is one click away."}
          </p>
          {hasProgress && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--ck-border-subtle)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${(doneCount / items.length) * 100}%`, background: "var(--ck-accent)" }} />
            </div>
          )}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-6 pb-2">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={snooze}
              className="flex items-start gap-3 rounded-xl border p-3 transition-colors hover:border-transparent"
              style={{ borderColor: "var(--ck-border-subtle)", background: item.done ? "var(--ck-success-soft, rgba(18,94,64,0.06))" : "var(--ck-surface-warm)" }}
            >
              <span className="mt-0.5 shrink-0" style={{ color: item.done ? "var(--ck-success, var(--ck-accent))" : "var(--ck-accent)" }}>
                {hasProgress ? (item.done ? <CheckCircle size={20} weight="fill" /> : <Circle size={20} />) : item.icon}
              </span>
              <span>
                <span className="block text-sm font-semibold" style={{ color: "var(--ck-text-strong)", textDecoration: item.done ? "line-through" : "none", opacity: item.done ? 0.7 : 1 }}>
                  {item.title}
                </span>
                <span className="block text-[13px] leading-snug" style={{ color: "var(--ck-text-muted)" }}>{item.detail}</span>
              </span>
            </Link>
          ))}
          <p className="px-1 pt-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
            Stuck at any point? The <ChatCircleDots size={13} className="inline" /> help assistant in the corner can explain every feature.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4">
          <button type="button" className="ui-btn ui-btn-ghost" onClick={snooze}>
            {isPrivileged ? "Set up later" : "Close"}
          </button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={complete}>
            Don&apos;t show this again
          </button>
        </div>
      </div>
    </div>
  );
}
