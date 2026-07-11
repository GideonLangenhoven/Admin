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
import { BrandMark, BrandWordmark } from "./BrandLogo";
import { isNavItemActive } from "./nav-active";
import WaFailureWatcher from "./WaFailureWatcher";
import {
  ArrowsLeftRight, Check, Circle, Star, GlobeSimple, WarningCircle,
  SquaresFour, Clipboard, PlusSquare, CalendarBlank, Bank,
  ChatText, Ticket, Receipt, Camera, Megaphone,
  CurrencyCircleDollar, ChartLine, Envelope, GearSix, ShieldCheck,
  UsersThree, Clock, CaretDoubleLeft, CaretDoubleRight, CaretDown,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

const iconMap: Record<string, PhosphorIcon> = {
  LayoutDashboard: SquaresFour, ClipboardList: Clipboard, PlusSquare, CalendarRange: CalendarBlank, Landmark: Bank,
  MessageSquareText: ChatText, Ticket, Receipt, Camera, Megaphone,
  BadgeDollarSign: CurrencyCircleDollar, LineChart: ChartLine, Mail: Envelope, Settings: GearSix, Shield: ShieldCheck,
  ArrowLeftRight: ArrowsLeftRight, Check, Circle, Users: UsersThree, Star, Globe: GlobeSimple, Warning: WarningCircle,
  Clock,
};

interface NavItem {
  href: string;
  label: string;
  icon: string;
  privilegedOnly?: boolean;
  superAdminOnly?: boolean;
}

const MARKETING_PATHS = ["/operators", "/case-study/cape-kayak", "/compare/manual-vs-disconnected-tools"];

function isMarketingPath(pathname: string) {
  return MARKETING_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isPrivilegedRole(r: string) {
  return r === "MAIN_ADMIN" || r === "SUPER_ADMIN";
}

const SUSPENDED_ALLOWED = ["/reports", "/invoices", "/refunds", "/settings", "/super-admin"];

function isSuspendedAllowed(path: string) {
  return SUSPENDED_ALLOWED.some((p) => path === p || path.startsWith(p + "/"));
}

/* Presentation-only grouping of the nav — the items, order and visibility
   rules are unchanged; groups whose items are all hidden don't render. */
const NAV_GROUPS: Array<{ label: string | null; hrefs: string[] }> = [
  { label: null, hrefs: ["/"] },
  { label: "Operations", hrefs: ["/bookings", "/new-booking", "/payment-reminders", "/slots"] },
  { label: "Customers", hrefs: ["/inbox", "/refunds", "/vouchers", "/reviews"] },
  { label: "Revenue", hrefs: ["/invoices", "/pricing", "/reports", "/billing"] },
  { label: "Growth", hrefs: ["/marketing", "/broadcasts"] },
  { label: "Admin", hrefs: ["/settings/chat-faq", "/settings", "/privacy/data-requests", "/super-admin"] },
];

function groupNav(items: NavItem[]) {
  const byHref = new Map(items.map((n) => [n.href, n]));
  const placed = new Set<string>();
  const groups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.hrefs.map((h) => { placed.add(h); return byHref.get(h); }).filter(Boolean) as NavItem[],
  })).filter((g) => g.items.length > 0);
  const leftovers = items.filter((n) => !placed.has(n.href));
  if (leftovers.length > 0) groups.push({ label: null, items: leftovers });
  return groups;
}

/* The deep-pine rail: vertical pine gradient with a breath of mint at the
   crown and amber ember at the base — the signature depth move of v3. */
const SIDEBAR_BG = [
  "radial-gradient(140% 50% at 50% -8%, rgba(0, 217, 139, 0.07), transparent 60%)",
  "radial-gradient(120% 45% at 50% 112%, rgba(217, 130, 47, 0.06), transparent 60%)",
  "linear-gradient(180deg, var(--ck-sidebar-grad-top) 0%, var(--ck-sidebar-grad-bottom) 100%)",
].join(", ");

export default function AppShell({ children, nav }: { children: React.ReactNode; nav: NavItem[] }) {
  const pathname = usePathname() || "";
  const { businessId, businessName, logoUrl, role, subscriptionStatus, yocoTestMode, operators, switchOperator } = useBusinessContext();
  const displayName = businessName || "Admin";
  const [collapsed, setCollapsed] = useState(false);
  const [clock, setClock] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const isSuspended = subscriptionStatus === "SUSPENDED" && !/super/i.test(role);
  const routeBlocked = isSuspended && !isSuspendedAllowed(pathname);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleString("en-ZA", {
          weekday: "short", day: "2-digit", month: "short",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).replace(",", " ·"),
      );
    tick();
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (displayName && displayName !== "Admin") {
      document.title = displayName + " — BookingTours Admin";
    } else {
      document.title = "BookingTours Admin";
    }
  }, [displayName]);

  const visibleNav = nav.filter((n) => {
    if (n.superAdminOnly) return role === "SUPER_ADMIN";
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

  // Nav-group accordion state — remembered per admin account (namespaced by
  // ck_admin_email) so different admins sharing a browser keep separate prefs.
  useEffect(() => {
    const email = localStorage.getItem("ck_admin_email") || "shared";
    try {
      const saved = JSON.parse(localStorage.getItem(`ck_nav_groups_collapsed_${email}`) || "[]");
      if (Array.isArray(saved)) setCollapsedGroups(new Set(saved));
    } catch { /* ignore malformed local state */ }
  }, []);

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      const email = localStorage.getItem("ck_admin_email") || "shared";
      localStorage.setItem(`ck_nav_groups_collapsed_${email}`, JSON.stringify(Array.from(next)));
      return next;
    });
  }

  if (isMarketingPath(pathname) && !(pathname === "/operators" && businessId)) {
    return <main className="min-h-screen">{children}</main>;
  }

  // The Guide app renders standalone (its own full-screen PWA shell) — no admin
  // sidebar/topbar. It still sits inside AuthGate so it keeps auth + business
  // context, but the chrome is entirely its own.
  if (pathname === "/guide" || pathname.startsWith("/guide/")) {
    return <main className="min-h-screen">{children}</main>;
  }

  // Longest-prefix match against the visible nav → topbar breadcrumb label
  const sectionLabel = visibleNav
    .filter((n) => (n.href === "/" ? pathname === "/" : pathname === n.href || pathname.startsWith(n.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label
    || (pathname.split("/")[1] ? pathname.split("/")[1].replace(/-/g, " ") : "Dashboard");

  const visibleHrefs = visibleNav.map((n) => n.href);
  function isNavActive(href: string) {
    return isNavItemActive(pathname, href, visibleHrefs);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Surfaces failed WhatsApp sends as in-the-moment toasts (replaces the
          removed Notifications tab). Renders nothing. */}
      <WaFailureWatcher />
      <aside
        className={`hidden shrink-0 flex-col border-r transition-[width] duration-200 md:flex ${collapsed ? "w-20" : "w-64"}`}
        style={{ background: SIDEBAR_BG, borderColor: "var(--ck-sidebar-border)" }}
      >
        <div className="p-6 pb-2">
          <div className={`mb-8 flex items-center ${collapsed ? "justify-center" : "justify-between gap-2"}`}>
            <Link href="/" className={`flex items-center hover:opacity-80 transition-opacity ${collapsed ? "justify-center" : "gap-2.5"}`}>
            {logoUrl ? (
              <Image src={logoUrl} alt={displayName} width={28} height={28} className="h-7 w-7 rounded-md object-contain p-[1px]" style={{ background: "rgba(244, 241, 232, 0.10)" }} unoptimized />
            ) : (
              <BrandMark size={26} variant="ivory" className="shrink-0" />
            )}
            {!collapsed && <h1 className="text-[16px] font-semibold tracking-tight truncate" style={{ color: "var(--ck-sidebar-active-text)" }}>{displayName}</h1>}
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="rounded-lg border p-1.5 transition-colors hover:bg-[var(--ck-sidebar-hover)]"
              style={{ borderColor: "var(--ck-sidebar-border)", color: "var(--ck-sidebar-muted)" }}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <CaretDoubleRight size={13} /> : <CaretDoubleLeft size={13} />}
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
              style={{ borderColor: "var(--ck-sidebar-border)", background: "rgba(244, 241, 232, 0.06)", color: "var(--ck-sidebar-text)" }}
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
                const idx = operators.findIndex((o) => o.id === businessId);
                const next = operators[(idx + 1) % operators.length];
                if (next) switchOperator(next.id);
              }}
              className="rounded-lg border p-2 text-xs transition-colors hover:bg-[var(--ck-sidebar-hover)]"
              style={{ borderColor: "var(--ck-sidebar-border)", color: "var(--ck-sidebar-text)" }}
              title={"Switch to: " + (operators.find((o) => o.id !== businessId)?.name || "next")}
            >
              <ArrowsLeftRight size={16} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto px-3.5 pb-4">
          {groupNav(visibleNav).map((group, gi) => {
            const isCollapsedGroup = group.label ? collapsedGroups.has(group.label) : false;
            const hasActiveItem = group.items.some((n) => isNavActive(n.href));
            const showItems = collapsed || !isCollapsedGroup || hasActiveItem || !group.label;
            return (
            <div key={group.label ?? `g${gi}`}>
              {group.label && !collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label!)}
                  aria-expanded={showItems}
                  className="ui-mono-label mt-6 mb-1.5 flex w-full items-center justify-between px-2.5 !text-[10px] transition-colors hover:!text-[var(--ck-sidebar-text)]"
                  style={{ color: "var(--ck-sidebar-muted)" }}
                >
                  <span>{group.label}</span>
                  <CaretDown size={10} weight="bold" className="transition-transform duration-200" style={{ transform: showItems ? "rotate(0deg)" : "rotate(-90deg)" }} />
                </button>
              )}
              {group.label && collapsed && (
                <div className="mx-auto my-3 w-5 border-t" style={{ borderColor: "var(--ck-sidebar-border)" }} aria-hidden="true" />
              )}
              {showItems && (
              <nav className="space-y-0.5">
                {group.items.map((n) => {
                  const Icon = iconMap[n.icon] || Circle;
                  const isActive = isNavItemActive(pathname, n.href, visibleHrefs);
                  const navBlocked = isSuspended && !isSuspendedAllowed(n.href);
                  return (
                    <Link key={n.href} href={navBlocked ? pathname : n.href}
                      className={`group flex items-center rounded-[8px] px-2.5 py-[7px] text-[13.5px] transition-colors ${collapsed ? "justify-center" : "gap-2.5"} ${isActive
                          ? "ui-nav-active font-semibold"
                          : "font-medium text-[var(--ck-sidebar-text)] hover:bg-[var(--ck-sidebar-hover)] hover:text-[var(--ck-sidebar-active-text)]"
                        } ${navBlocked ? "opacity-40 pointer-events-none" : ""}`}
                      aria-disabled={navBlocked}
                      tabIndex={navBlocked ? -1 : undefined}
                      title={collapsed ? n.label : undefined}
                    >
                      <span className={`flex items-center justify-center${!(isActive && n.href === "/") ? " sidebar-icon" : ""}`} style={{ color: isActive ? "var(--ck-sidebar-icon-active)" : "var(--ck-sidebar-icon)" }}>
                        <Icon size={18} weight={isActive ? "fill" : "regular"} />
                      </span>
                      {!collapsed && <span className="flex-1 tracking-tight">{n.label}</span>}
                      {n.href === "/inbox" && <NotificationBadge />}
                      {n.href === "/refunds" && <RefundBadge />}
                    </Link>
                  );
                })}
              </nav>
              )}
            </div>
            );
          })}
        </div>
        {/* Platform provenance — subtle, stays in hairline footer */}
        <div
          className={`mt-auto border-t px-4 py-3 flex items-center ${collapsed ? "justify-center" : "gap-2"}`}
          style={{ borderColor: "var(--ck-sidebar-border)", color: "var(--ck-sidebar-muted)" }}
          title="Powered by BookingTours"
        >
          <BrandMark size={14} variant="ivory" className="shrink-0 opacity-70" />
          {!collapsed && (
            <span className="flex items-baseline gap-1.5">
              <span className="text-[9px] font-medium uppercase" style={{ letterSpacing: "0.1em" }}>Powered by</span>
              <BrandWordmark className="text-[12px]" />
            </span>
          )}
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Desktop topbar — glass chrome: breadcrumb, live clock, session controls */}
        <header
          className="ui-glass hidden md:flex h-14 shrink-0 items-center justify-between border-b px-6"
          style={{ borderColor: "var(--ck-border-subtle)" }}
        >
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="ui-mono-label truncate max-w-[220px]">{displayName}</span>
            <span className="text-[11px]" style={{ color: "var(--ck-border-strong)" }}>/</span>
            <span className="ui-mono-label truncate" style={{ color: "var(--ck-text-strong)" }}>{sectionLabel}</span>
          </div>
          <div className="flex items-center gap-4">
            {clock && (
              <span className="ui-mono-label hidden lg:flex items-center gap-2 !normal-case !tracking-[0.04em]">
                <span className="h-[5px] w-[5px] rounded-full motion-safe:animate-pulse" style={{ background: "var(--ck-accent)" }} aria-hidden="true" />
                {clock}
              </span>
            )}
            <ThemeToggle size="sm" />
            <SignOutButton variant="header" />
          </div>
        </header>
        <header className="ui-glass md:hidden flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--ck-border-subtle)" }}>
          <MobileMenuDrawer nav={visibleNav} />
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            {logoUrl ? (
              <Image src={logoUrl} alt={displayName} width={24} height={24} className="h-6 w-6 rounded object-contain" unoptimized />
            ) : (
              <BrandMark size={22} className="shrink-0" />
            )}
            <h1 className="text-lg font-bold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>{displayName}</h1>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle size="sm" />
            <SignOutButton variant="header" />
          </div>
        </header>
        {isSuspended && (
          <div className="shrink-0 border-b px-4 py-2.5 md:px-10 flex items-center gap-2" style={{ background: "var(--ck-danger-soft)", borderColor: "color-mix(in srgb, var(--ck-danger) 25%, transparent)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "var(--ck-danger)" }}><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>
            <p className="text-xs font-medium" style={{ color: "var(--ck-danger)" }}>Subscription suspended — only Reports, Invoices, Refunds, and Settings are accessible. Contact support to reactivate.</p>
          </div>
        )}
        {subscriptionStatus === "PAUSED" && !isSuspended && (
          <div className="shrink-0 border-b px-4 py-2.5 md:px-10 flex items-center gap-2" style={{ background: "var(--ck-warning-soft)", borderColor: "color-mix(in srgb, var(--ck-warning) 25%, transparent)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "var(--ck-warning)" }}><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>
            <p className="text-xs font-medium" style={{ color: "var(--ck-warning)" }}>Your subscription is paused for off-season. <a href="/billing" className="underline font-semibold">Resume</a> to take new bookings.</p>
          </div>
        )}
        {yocoTestMode && (
          <div className="shrink-0 border-b px-4 py-2.5 md:px-10 flex items-center gap-2" style={{ background: "var(--ck-amber-soft)", borderColor: "color-mix(in srgb, var(--ck-amber-bright) 30%, transparent)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "var(--ck-amber)" }}><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
            <p className="text-xs font-medium" style={{ color: "var(--ck-amber)" }}>TEST MODE — Yoco payments are using sandbox keys. No real charges will be processed.</p>
          </div>
        )}
        <main className="flex-1 overflow-auto px-4 py-6 pb-8 md:px-10 md:py-8">
          {routeBlocked ? (
            <div className="flex items-center justify-center min-h-[50vh]">
              <div className="ui-card px-10 py-9 text-center max-w-sm">
                <div className="ui-icon-chip mx-auto mb-4" style={{ background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                </div>
                <h2 className="text-lg font-semibold text-[var(--ck-text-strong)] mb-1">Feature Unavailable</h2>
                <p className="text-sm text-[var(--ck-text-muted)]">This section is not accessible while your subscription is suspended. You can still access Reports, Invoices, Refunds, and Settings.</p>
              </div>
            </div>
          ) : children}
        </main>

        <nav className="ui-glass md:hidden shrink-0 overflow-x-auto border-t py-2 no-scrollbar" style={{ borderColor: "var(--ck-border-subtle)" }}>
          <div className="flex min-w-max px-2">
          {visibleNav.map((n) => {
            const Icon = iconMap[n.icon] || Circle;
            const isActive = isNavItemActive(pathname, n.href, visibleHrefs);
            const mobileBlocked = isSuspended && !isSuspendedAllowed(n.href);
            return (
              <Link key={n.href} href={mobileBlocked ? pathname : n.href} className={"relative flex w-[74px] shrink-0 flex-col items-center rounded-lg px-1 py-1 text-[11px] " + (isActive ? "font-semibold" : "font-medium") + (mobileBlocked ? " opacity-30 pointer-events-none" : "")} aria-disabled={mobileBlocked} tabIndex={mobileBlocked ? -1 : undefined} style={{ color: isActive ? "var(--ck-accent)" : "var(--ck-text-muted)" }}>
                <div className="relative mb-1">
                  <Icon size={20} weight={isActive ? "fill" : "regular"} />
                  {n.href === "/inbox" && <div className="absolute -top-1 -right-2 transform scale-75"><NotificationBadge /></div>}
                  {n.href === "/refunds" && <div className="absolute -top-1 -right-2 transform scale-75"><RefundBadge /></div>}
                </div>
                <span className="truncate">{n.label}</span>
                {isActive && <span className="absolute -bottom-0.5 h-[3px] w-[3px] rounded-full" style={{ background: "var(--ck-amber-bright)" }} aria-hidden="true" />}
              </Link>
            );
          })}
          </div>
        </nav>
      </div>
    </div>
  );
}
