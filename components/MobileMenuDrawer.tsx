"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NotificationBadge from "./NotificationBadge";
import RefundBadge from "./RefundBadge";
import SignOutButton from "./SignOutButton";
import ThemeToggle from "./ThemeToggle";
import { useBusinessContext } from "./BusinessContext";
import { BrandMark } from "./BrandLogo";
import { isNavItemActive } from "./nav-active";
import {
  Circle, SquaresFour, Clipboard, PlusSquare, CalendarBlank, Bank,
  ChatText, Ticket, Receipt, Camera, Megaphone,
  CurrencyCircleDollar, ChartLine, Envelope, GearSix, ShieldCheck,
  UsersThree, GlobeSimple, WarningCircle, DotsThree, ListChecks,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

const iconMap: Record<string, PhosphorIcon> = {
  LayoutDashboard: SquaresFour, ClipboardList: Clipboard, PlusSquare, CalendarRange: CalendarBlank, Landmark: Bank,
  MessageSquareText: ChatText, Ticket, Receipt, Camera, Megaphone,
  BadgeDollarSign: CurrencyCircleDollar, LineChart: ChartLine, Mail: Envelope, Settings: GearSix, Shield: ShieldCheck, Circle,
  Users: UsersThree, Globe: GlobeSimple, Warning: WarningCircle, Check: Clipboard, ListChecks,
};

type NavItem = { href: string; label: string; icon: string; external?: boolean };

const GROUPS = [
  { label: "Operations", hrefs: ["/", "/simple", "/bookings", "/new-booking", "/slots", "/guide", "/photos"] },
  { label: "Customers", hrefs: ["/inbox", "/customers", "/refunds", "/vouchers", "/reviews", "/notifications"] },
  { label: "Revenue", hrefs: ["/invoices", "/pricing", "/reports", "/billing"] },
  { label: "Growth", hrefs: ["/marketing", "/broadcasts", "/partnerships", "/ai-usage"] },
  { label: "Admin", hrefs: ["/settings/chat-faq", "/settings", "/settings/ota", "/privacy/data-requests", "/super-admin"] },
];

function groupedNav(nav: NavItem[]) {
  const placed = new Set<string>();
  const groups = GROUPS.map((group) => ({
    label: group.label,
    items: nav.filter((item) => group.hrefs.includes(item.href) && placed.add(item.href)),
  })).filter((group) => group.items.length > 0);
  const remaining = nav.filter((item) => !placed.has(item.href));
  if (remaining.length) groups[0]?.items.push(...remaining);
  return groups;
}

/* Same deep-pine rail as the desktop sidebar */
const DRAWER_BG = [
  "radial-gradient(140% 50% at 50% -8%, rgba(0, 217, 139, 0.07), transparent 60%)",
  "radial-gradient(120% 45% at 50% 112%, rgba(217, 130, 47, 0.06), transparent 60%)",
  "linear-gradient(180deg, var(--ck-sidebar-grad-top) 0%, var(--ck-sidebar-grad-bottom) 100%)",
].join(", ");

export default function MobileMenuDrawer({ nav, active = false }: { nav: NavItem[]; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { businessName } = useBusinessContext();

  useEffect(() => setMounted(true), []);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("[data-mobile-menu-close]")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  const drawer = open ? (
    <>
      <div className="fixed inset-0 z-[9998] bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="More navigation"
        className="fixed inset-y-0 left-0 z-[9999] flex flex-col overflow-hidden"
        style={{
          background: DRAWER_BG,
          color: "var(--ck-sidebar-text)",
          width: "min(20rem, 86vw)",
          height: "100dvh",
          borderRight: "1px solid var(--ck-sidebar-border)",
          boxShadow: "var(--ck-shadow-lg)",
        }}
      >
        <div className="flex shrink-0 items-center justify-between border-b p-5" style={{ borderColor: "var(--ck-sidebar-border)" }}>
          <div className="flex items-center gap-2.5">
            <BrandMark size={24} variant="ivory" className="shrink-0" />
            <h1 className="text-[16px] font-semibold tracking-tight truncate" style={{ color: "var(--ck-sidebar-active-text)" }}>
              {businessName || "Menu"}
            </h1>
          </div>
          <button
            data-mobile-menu-close
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-[var(--ck-sidebar-hover)]"
            style={{ color: "var(--ck-sidebar-muted)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {groupedNav(nav).map((group) => (
            <section key={group.label} aria-labelledby={`mobile-menu-${group.label.toLowerCase()}`}>
              <h2 id={`mobile-menu-${group.label.toLowerCase()}`} className="ui-mono-label mb-1 mt-5 px-3 !text-[11px]" style={{ color: "var(--ck-sidebar-muted)" }}>
                {group.label}
              </h2>
              <nav className="space-y-1" aria-label={group.label}>
              {group.items.map((n) => {
                const Icon = iconMap[n.icon] || Circle;
                const itemActive = isNavItemActive(pathname || "", n.href, nav.map((x) => x.href));
                return (
              <Link
                key={n.href}
                href={n.href}
                target={n.external ? "_blank" : undefined}
                rel={n.external ? "noopener noreferrer" : undefined}
                className={`relative flex min-h-12 items-center gap-3 rounded-[10px] px-3 text-base ${
                  itemActive
                    ? "ui-nav-active font-semibold"
                    : "font-medium text-[var(--ck-sidebar-text)] hover:bg-[var(--ck-sidebar-hover)] hover:text-[var(--ck-sidebar-active-text)]"
                }`}
              >
                <span className="flex items-center justify-center" style={{ color: itemActive ? "var(--ck-sidebar-icon-active)" : "var(--ck-sidebar-icon)" }}>
                  <Icon size={20} weight={itemActive ? "fill" : "regular"} />
                </span>
                <span className="flex-1">{n.label}</span>
                {n.external && <span aria-hidden="true" className="text-xs">↗</span>}
                {n.href === "/inbox" && <NotificationBadge />}
                {n.href === "/refunds" && <RefundBadge />}
              </Link>
                );
              })}
              </nav>
            </section>
          ))}
        </div>

        <div className="shrink-0 border-t p-3" style={{ borderColor: "var(--ck-sidebar-border)" }}>
          <div
            className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
            style={{ borderColor: "var(--ck-sidebar-border)", background: "rgba(244, 241, 232, 0.06)" }}
          >
            <ThemeToggle size="sm" />
            <SignOutButton />
          </div>
        </div>
      </div>
    </>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-label="More navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium"
        style={{ color: active ? "var(--ck-accent)" : "var(--ck-text-muted)" }}
      >
        <DotsThree size={23} weight={active ? "bold" : "regular"} />
        <span>More</span>
        {active && <span className="absolute bottom-0 h-[3px] w-[3px] rounded-full" style={{ background: "var(--ck-amber-bright)" }} aria-hidden="true" />}
      </button>

      {mounted && createPortal(drawer, document.body)}
    </>
  );
}
