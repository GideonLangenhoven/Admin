"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NotificationBadge from "./NotificationBadge";
import RefundBadge from "./RefundBadge";
import SignOutButton from "./SignOutButton";
import MobileMenuDrawer from "./MobileMenuDrawer";
import ThemeToggle from "./ThemeToggle";
import { useBusinessContext } from "./BusinessContext";
import {
  ArrowsLeftRight, Check, Circle, Star, GlobeSimple, WarningCircle,
  SquaresFour, Clipboard, PlusSquare, CalendarBlank, Bank,
  ChatText, Ticket, Receipt, CloudSun, Camera, Megaphone,
  CurrencyCircleDollar, ChartLine, Envelope, GearSix, ShieldCheck,
  UsersThree,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

const iconMap: Record<string, PhosphorIcon> = {
  LayoutDashboard: SquaresFour, ClipboardList: Clipboard, PlusSquare, CalendarRange: CalendarBlank, Landmark: Bank,
  MessageSquareText: ChatText, Ticket, Receipt, CloudSun, Camera, Megaphone,
  BadgeDollarSign: CurrencyCircleDollar, LineChart: ChartLine, Mail: Envelope, Settings: GearSix, Shield: ShieldCheck,
  ArrowLeftRight: ArrowsLeftRight, Check, Circle, Users: UsersThree, Star, Globe: GlobeSimple, Warning: WarningCircle,
};

interface NavItem {
  href: string;
  label: string;
  icon: string;
  privilegedOnly?: boolean; // if true, hidden for plain ADMIN role
}

const MARKETING_PATHS = ["/operators", "/case-study/cape-kayak", "/compare/manual-vs-disconnected-tools"];

function isMarketingPath(pathname: string) {
  return MARKETING_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isPrivilegedRole(r: string) {
  return r === "MAIN_ADMIN" || r === "SUPER_ADMIN";
}

var SUSPENDED_ALLOWED = ["/reports", "/invoices", "/refunds", "/settings", "/super-admin"];

function isSuspendedAllowed(path: string) {
  return SUSPENDED_ALLOWED.some((p) => path === p || path.startsWith(p + "/"));
}

export default function AppShell({ children, nav }: { children: React.ReactNode; nav: NavItem[] }) {
  const pathname = usePathname() || "";
  const { businessId, businessName, logoUrl, role, subscriptionStatus, yocoTestMode, operators, switchOperator } = useBusinessContext();
  const displayName = businessName || "Admin";
  const [collapsed, setCollapsed] = useState(false);
  const isSuspended = subscriptionStatus === "SUSPENDED" && !/super/i.test(role);
  const routeBlocked = isSuspended && !isSuspendedAllowed(pathname);

  useEffect(() => {
    if (displayName && displayName !== "Admin") {
      document.title = displayName + " — BookingTours Admin";
    } else {
      document.title = "BookingTours Admin";
    }
  }, [displayName]);

  // Strip privileged-only items for plain ADMIN users, but show Settings if they have granted permissions
  const visibleNav = nav.filter((n) => {
    if (!n.privilegedOnly) return true;
    if (isPrivilegedRole(role)) return true;
    // Show Settings for admins who have been granted section permissions
    if (n.href === "/settings") {
      try {
        const perms = JSON.parse(localStorage.getItem("ck_admin_settings_perms") || "{}");
        return Object.values(perms).some(Boolean);
      } catch { return false; }
    }
    return false;
  });

  useEffect(() => {
    const saved = localStorage.getItem("ck_sidebar_collapsed");
    setCollapsed(saved === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("ck_sidebar_collapsed", String(next));
      return next;
    });
  }

  if (isMarketingPath(pathname) && !(pathname === "/operators" && businessId)) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={`hidden shrink-0 flex-col bg-white transition-[width] duration-200 md:flex ${collapsed ? "w-20" : "w-64"}`} style={{ boxShadow: "1px 0 20px rgba(0,0,0,0.02)" }}>
        <div className="p-6 pb-2">
          <div className={`mb-8 flex items-center ${collapsed ? "justify-center" : "justify-between gap-2"}`}>
            <Link href="/" className={`flex items-center hover:opacity-80 transition-opacity ${collapsed ? "justify-center" : "gap-2"}`}>
            {logoUrl ? (
              <Image src={logoUrl} alt={displayName} width={28} height={28} className="h-7 w-7 rounded object-contain" unoptimized />
            ) : (
              <div className="grid grid-cols-2 gap-[2px] h-6 w-6 shrink-0">
                <div className="bg-[var(--ck-accent)] rounded-tl-full"></div>
                <div className="bg-[var(--ck-accent)] rounded-tr-full"></div>
                <div className="bg-[var(--ck-accent)] rounded-bl-full"></div>
                <div className="bg-[var(--ck-accent)] rounded-br-full opacity-50"></div>
              </div>
            )}
            {!collapsed && <h1 className="text-xl font-bold tracking-tight truncate" style={{ color: "var(--ck-accent)" }}>{displayName}</h1>}
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="rounded-lg border px-2 py-1 text-xs font-semibold transition-colors hover:bg-white/10"
              style={{ borderColor: "var(--ck-sidebar-border)", color: "var(--ck-sidebar-muted)" }}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? "→" : "←"}
            </button>
          </div>
        </div>

        {/* Business switcher for SUPER_ADMIN with multiple operators */}
        {operators && operators.length > 1 && switchOperator && !collapsed && (
          <div className="px-6 pb-3">
            <select
              value={businessId}
              onChange={(e) => switchOperator(e.target.value)}
              className="w-full rounded-lg border px-2.5 py-2 text-xs font-medium truncate"
              style={{ borderColor: "var(--ck-sidebar-border)", background: "var(--ck-sidebar)", color: "var(--ck-sidebar-text)" }}
            >
              {operators.map((op) => (
                <option key={op.id} value={op.id}>{op.name}</option>
              ))}
            </select>
          </div>
        )}
        {operators && operators.length > 1 && switchOperator && collapsed && (
          <div className="px-2 pb-3 flex justify-center">
            <button
              onClick={() => {
                var idx = operators.findIndex((o) => o.id === businessId);
                var next = operators[(idx + 1) % operators.length];
                if (next) switchOperator(next.id);
              }}
              className="rounded-lg border p-2 text-xs"
              style={{ borderColor: "var(--ck-sidebar-border)", color: "var(--ck-sidebar-text)" }}
              title={"Switch to: " + (operators.find((o) => o.id !== businessId)?.name || "next")}
            >
              <ArrowsLeftRight size={16} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto px-4 pb-4">
          {!collapsed && <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ck-sidebar-muted)" }}>General</div>}
          <nav className="space-y-1">
            {visibleNav.map((n) => {
              const Icon = iconMap[n.icon] || Circle;
              const isActive = n.href === "/" ? pathname === "/" : pathname === n.href || pathname.startsWith(n.href + "/");
              const navBlocked = isSuspended && !isSuspendedAllowed(n.href);
              return (
                <Link key={n.href} href={navBlocked ? pathname : n.href}
                  className={`group flex items-center rounded-lg px-3 py-2 text-sm transition-colors ${collapsed ? "justify-center" : "gap-3"} ${isActive
                      ? "ui-nav-active font-semibold"
                      : "font-medium"
                    } ${navBlocked ? "opacity-40 pointer-events-none" : ""}`}
                  style={isActive
                    ? undefined
                    : { color: "var(--ck-sidebar-text)" }
                  }
                  aria-disabled={navBlocked}
                  tabIndex={navBlocked ? -1 : undefined}
                  onMouseEnter={(e) => { if (!isActive && !navBlocked) { e.currentTarget.style.background = "var(--ck-sidebar-hover)"; e.currentTarget.style.color = "var(--ck-sidebar-active-text)"; } }}
                  onMouseLeave={(e) => { if (!isActive && !navBlocked) { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--ck-sidebar-text)"; } }}
                >
                  <span className={`flex items-center justify-center${!(isActive && n.href === "/") ? " sidebar-icon" : ""}`} style={{ color: isActive ? "var(--ck-success)" : "var(--ck-sidebar-muted)" }}>
                    {isActive && n.href === "/" ? (
                      <Icon size={20} weight="fill" className="text-emerald-500" />
                    ) : (
                      <Icon size={20} weight={isActive ? "fill" : "regular"} className={isActive ? "text-emerald-500" : ""} />
                    )}
                  </span>
                  {!collapsed && <span className="flex-1 tracking-tight">{n.label}</span>}
                  {n.href === "/inbox" && <NotificationBadge />}
                  {n.href === "/refunds" && <RefundBadge />}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className={`mt-auto border-t p-4 flex ${collapsed ? "flex-col gap-3" : "items-center justify-between"}`} style={{ borderColor: "var(--ck-sidebar-border)" }}>
          <SignOutButton />
          <ThemeToggle />
        </div>
        {/* Platform provenance — subtle, stays in hairline footer */}
        <div
          className={`border-t px-4 py-2.5 flex items-center ${collapsed ? "justify-center" : "gap-2"}`}
          style={{ borderColor: "var(--ck-sidebar-border)", color: "var(--ck-sidebar-muted)" }}
          title="Powered by BookingTours"
        >
          <span className="grid grid-cols-2 gap-[2px] h-3 w-3 shrink-0" aria-hidden="true">
            <span className="rounded-tl-full" style={{ background: "var(--ck-accent)" }} />
            <span className="rounded-tr-full" style={{ background: "var(--ck-accent)" }} />
            <span className="rounded-bl-full" style={{ background: "var(--ck-accent)" }} />
            <span className="rounded-br-full opacity-50" style={{ background: "var(--ck-accent)" }} />
          </span>
          {!collapsed && (
            <span className="text-[10px] font-medium uppercase" style={{ letterSpacing: "0.08em" }}>
              Powered by BookingTours
            </span>
          )}
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--ck-bg)" }}>
        <header className="md:hidden flex items-center justify-between border-b px-4 py-3 backdrop-blur" style={{ background: "color-mix(in srgb, var(--ck-surface) 85%, transparent)", borderColor: "var(--ck-border-strong)" }}>
          <MobileMenuDrawer nav={visibleNav} />
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            {logoUrl && <Image src={logoUrl} alt={displayName} width={24} height={24} className="h-6 w-6 rounded object-contain" unoptimized />}
            <h1 className="text-lg font-bold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>{displayName}</h1>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle size="sm" />
            <SignOutButton variant="header" />
          </div>
        </header>
        {isSuspended && (
          <div className="shrink-0 border-b px-4 py-2.5 md:px-10 flex items-center gap-2" style={{ background: "#fef2f2", borderColor: "#fecaca" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-red-600"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>
            <p className="text-xs font-medium text-red-800">Subscription suspended — only Reports, Invoices, Refunds, and Settings are accessible. Contact support to reactivate.</p>
          </div>
        )}
        {yocoTestMode && (
          <div className="shrink-0 border-b px-4 py-2.5 md:px-10 flex items-center gap-2" style={{ background: "#fff7ed", borderColor: "#fed7aa" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-orange-600"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
            <p className="text-xs font-medium text-orange-800">TEST MODE — Yoco payments are using sandbox keys. No real charges will be processed.</p>
          </div>
        )}
        <main className="flex-1 overflow-auto px-4 py-6 pb-8 md:px-10 md:py-8">
          {routeBlocked ? (
            <div className="flex items-center justify-center min-h-[50vh]">
              <div className="text-center max-w-sm">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-red-600"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                </div>
                <h2 className="text-lg font-semibold text-[var(--ck-text-strong)] mb-1">Feature Unavailable</h2>
                <p className="text-sm text-[var(--ck-text-muted)]">This section is not accessible while your subscription is suspended. You can still access Reports, Invoices, Refunds, and Settings.</p>
              </div>
            </div>
          ) : children}
        </main>

        <nav className="md:hidden shrink-0 overflow-x-auto border-t py-2 backdrop-blur no-scrollbar" style={{ background: "color-mix(in srgb, var(--ck-surface) 90%, transparent)", borderColor: "var(--ck-border-strong)" }}>
          <div className="flex min-w-max px-2">
          {visibleNav.map((n) => {
            const Icon = iconMap[n.icon] || Circle;
            const isActive = n.href === "/" ? pathname === "/" : pathname === n.href || pathname.startsWith(n.href + "/");
            const mobileBlocked = isSuspended && !isSuspendedAllowed(n.href);
            return (
              <Link key={n.href} href={mobileBlocked ? pathname : n.href} className={"relative flex w-[74px] shrink-0 flex-col items-center rounded-lg px-1 py-1 text-[11px] font-medium" + (mobileBlocked ? " opacity-30 pointer-events-none" : "")} aria-disabled={mobileBlocked} tabIndex={mobileBlocked ? -1 : undefined} style={{ color: isActive ? "var(--ck-accent)" : "var(--ck-text-muted)" }}>
                <div className="relative mb-1">
                  <Icon size={20} />
                  {n.href === "/inbox" && <div className="absolute -top-1 -right-2 transform scale-75"><NotificationBadge /></div>}
                  {n.href === "/refunds" && <div className="absolute -top-1 -right-2 transform scale-75"><RefundBadge /></div>}
                </div>
                <span className="truncate">{n.label}</span>
              </Link>
            );
          })}
          </div>
        </nav>
      </div>
    </div>
  );
}
