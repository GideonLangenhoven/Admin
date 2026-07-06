"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NotificationBadge from "./NotificationBadge";
import RefundBadge from "./RefundBadge";
import SignOutButton from "./SignOutButton";
import ThemeToggle from "./ThemeToggle";
import { useBusinessContext } from "./BusinessContext";
import { BrandMark } from "./BrandLogo";
import {
  Circle, SquaresFour, Clipboard, PlusSquare, CalendarBlank, Bank,
  ChatText, Ticket, Receipt, CloudSun, Camera, Megaphone,
  CurrencyCircleDollar, ChartLine, Envelope, GearSix, ShieldCheck,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

const iconMap: Record<string, PhosphorIcon> = {
  LayoutDashboard: SquaresFour, ClipboardList: Clipboard, PlusSquare, CalendarRange: CalendarBlank, Landmark: Bank,
  MessageSquareText: ChatText, Ticket, Receipt, CloudSun, Camera, Megaphone,
  BadgeDollarSign: CurrencyCircleDollar, LineChart: ChartLine, Mail: Envelope, Settings: GearSix, Shield: ShieldCheck, Circle,
};

type NavItem = { href: string; label: string; icon: string };

/* Same deep-pine rail as the desktop sidebar */
const DRAWER_BG = [
  "radial-gradient(140% 50% at 50% -8%, rgba(0, 217, 139, 0.07), transparent 60%)",
  "radial-gradient(120% 45% at 50% 112%, rgba(217, 130, 47, 0.06), transparent 60%)",
  "linear-gradient(180deg, var(--ck-sidebar-grad-top) 0%, var(--ck-sidebar-grad-bottom) 100%)",
].join(", ");

export default function MobileMenuDrawer({ nav }: { nav: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const { businessName } = useBusinessContext();

  useEffect(() => setMounted(true), []);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const drawer = (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer — the pine rail, handheld */}
      <div
        className={`fixed top-0 left-0 z-[9999] flex flex-col overflow-hidden transition-transform duration-200 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
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
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-[var(--ck-sidebar-hover)]"
            style={{ color: "var(--ck-sidebar-muted)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((n) => {
            const Icon = iconMap[n.icon] || Circle;
            const active = n.href === "/" ? pathname === "/" : pathname === n.href || pathname?.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`relative flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-sm ${
                  active
                    ? "ui-nav-active font-semibold"
                    : "font-medium text-[var(--ck-sidebar-text)] hover:bg-[var(--ck-sidebar-hover)] hover:text-[var(--ck-sidebar-active-text)]"
                }`}
              >
                <span className="flex items-center justify-center" style={{ color: active ? "var(--ck-sidebar-icon-active)" : "var(--ck-sidebar-icon)" }}>
                  <Icon size={18} weight={active ? "fill" : "regular"} />
                </span>
                <span className="flex-1">{n.label}</span>
                {n.href === "/inbox" && <NotificationBadge />}
                {n.href === "/refunds" && <RefundBadge />}
              </Link>
            );
          })}
        </nav>

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
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--ck-text-muted)] hover:bg-[var(--ck-surface-sunken)] hover:text-[var(--ck-text-strong)]"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {mounted && createPortal(drawer, document.body)}
    </>
  );
}
