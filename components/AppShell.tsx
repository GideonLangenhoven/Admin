"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NotificationBadge from "./NotificationBadge";
import RefundBadge from "./RefundBadge";
import DataRequestBadge from "./DataRequestBadge";
import SignOutButton from "./SignOutButton";
import MobileMenuDrawer from "./MobileMenuDrawer";
import ThemeToggle from "./ThemeToggle";
import { useBusinessContext } from "./BusinessContext";
import { BrandMark, BrandWordmark } from "./BrandLogo";
import { isNavItemActive } from "./nav-active";
import WaFailureWatcher from "./WaFailureWatcher";
import HelpChat from "./HelpChat";
import WelcomeChecklist from "./WelcomeChecklist";
import DemoActionGuide from "./DemoActionGuide";
import SimpleViewShell from "./SimpleViewShell";
import dashboardStyles from "../app/dashboard.module.css";
import { isSectionHidden } from "@/app/lib/operator-sections";
import { DEMO_BOOKING_SITE_URL, isDemoPathVisible } from "@/app/lib/demo-guide";
import {
  ArrowsLeftRight, Check, Circle, Star, GlobeSimple, WarningCircle,
  SquaresFour, Clipboard, PlusSquare, CalendarBlank, Bank, ListChecks,
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
  Clock, ListChecks,
};

interface NavItem {
  href: string;
  label: string;
  icon: string;
  privilegedOnly?: boolean;
  superAdminOnly?: boolean;
  demoOnly?: boolean;
  external?: boolean;
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

/* Presentation-only grouping of the nav; empty groups don't render. */
const NAV_GROUPS: Array<{ label: string | null; hrefs: string[] }> = [
  { label: null, hrefs: ["/"] },
  { label: "Customer view", hrefs: [DEMO_BOOKING_SITE_URL] },
  { label: "Operations", hrefs: ["/simple", "/bookings", "/new-booking", "/slots"] },
  { label: "Guest care", hrefs: ["/inbox", "/refunds"] },
  { label: "Revenue", hrefs: ["/invoices", "/pricing", "/reports", "/billing"] },
  { label: "Growth", hrefs: ["/marketing", "/broadcasts", "/partnerships", "/ai-usage"] },
  { label: "Admin", hrefs: ["/settings", "/super-admin"] },
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
  const isSimplePath = pathname === "/simple" || pathname.startsWith("/simple/") || pathname === "/simpleguide" || pathname.startsWith("/simpleguide/");
  const { businessId, businessName, logoUrl, role, timezone, subscriptionStatus, yocoTestMode, readOnly, operators, switchOperator } = useBusinessContext();
  const displayName = businessName || "Admin";
  const [collapsed, setCollapsed] = useState(false);
  const [clock, setClock] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(NAV_GROUPS.flatMap(group => group.label && group.label !== "Operations" ? [group.label] : [])));
  const isSuspended = subscriptionStatus === "SUSPENDED" && !/super/i.test(role);
  const routeBlocked = isSuspended && !isSuspendedAllowed(pathname);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleString("en-ZA", {
          weekday: "short", day: "2-digit", month: "short",
          hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone, timeZoneName: "short",
        }).replace(",", " ·"),
      );
    tick();
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, [timezone]);

  useEffect(() => {
    if (displayName && displayName !== "Admin") {
      document.title = displayName + " | BookingTours Admin";
    } else {
      document.title = "BookingTours Admin";
    }
  }, [displayName]);

  // Per-operator section visibility set by the Main Admin (see operator-sections.ts).
  // Read directly from localStorage like the Settings gate below; guarded so SSR
  // (no localStorage) simply shows everything, then hydration applies the hides.
  let operatorPerms: Record<string, boolean> = {};
  try {
    operatorPerms = JSON.parse(localStorage.getItem("ck_admin_settings_perms") || "{}");
  } catch { /* SSR / malformed — treat as nothing hidden */ }

  const visibleNav = nav.filter((n) => {
    if (readOnly) return n.external === true || isDemoPathVisible(n.href);
    // The external Claire storefront link belongs only to the guided demo.
    // Internal destinations tagged in layout remain available to entitled
    // real operators; demo visibility is governed by isDemoPathVisible above.
    if (n.demoOnly && !readOnly && n.external) return false;
    if (n.superAdminOnly) return role === "SUPER_ADMIN";
    // Main-Admin-controlled hiding applies to operator-level admins only.
    if (!isPrivilegedRole(role) && isSectionHidden(operatorPerms, n.href)) return false;
    if (!n.privilegedOnly) return true;
    if (isPrivilegedRole(role)) return true;
    // Show Settings for admins who have been granted section permissions
    if (n.href === "/settings") {
      // Only the settings-section grants count — "hide:*" flags must not
      // accidentally unlock the Settings page.
      return Object.entries(operatorPerms).some(([k, v]) => v === true && !k.startsWith("hide:"));
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

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  if (pathname === "/guide-setup" || pathname === "/google-callback" || (isMarketingPath(pathname) && !(pathname === "/operators" && businessId))) {
    return <main className="min-h-screen">{children}</main>;
  }

  if (isSimplePath || (role === "GUIDE" && /^\/guide\/photos\//.test(pathname))) {
    return <SimpleViewShell>{readOnly ? <DemoActionGuide>{children}</DemoActionGuide> : children}</SimpleViewShell>;
  }

  // The Guide app renders standalone (its own full-screen PWA shell) — no admin
  // sidebar/topbar. It still sits inside AuthGate so it keeps auth + business
  // context, but the chrome is entirely its own.
  if (!readOnly && (pathname === "/guide" || pathname.startsWith("/guide/"))) {
    return (
      <main className="min-h-screen">
        {readOnly && <HelpChat />}
        {readOnly ? <DemoActionGuide>{children}</DemoActionGuide> : children}
      </main>
    );
  }

  // Longest-prefix match against the visible nav → topbar breadcrumb label
  const visibleHrefs = visibleNav.map((n) => n.href);
  const sectionLabel = visibleNav
    .find((n) => isNavItemActive(pathname, n.href, visibleHrefs))?.label
    || (pathname.split("/")[1] ? pathname.split("/")[1].replace(/-/g, " ") : "Dashboard");

  const menuNav = visibleNav.filter((item) => item.href !== "/simple");
  const mobilePrimaryHrefs = ["/", "/bookings", "/new-booking", "/inbox"];
  const mobilePrimaryNav = mobilePrimaryHrefs
    .map((href) => visibleNav.find((item) => item.href === href))
    .filter(Boolean) as NavItem[];
  const mobileMoreActive = !mobilePrimaryNav.some((item) => isNavItemActive(pathname, item.href, visibleHrefs));
  return (
    <div className="flex h-dvh min-h-0 min-w-0">
      {/* Surfaces failed WhatsApp sends as in-the-moment toasts. Renders nothing. */}
      <WaFailureWatcher />
      {/* Floating help assistant + one-time first-login welcome. */}
      {!readOnly && <WelcomeChecklist />}
      {/* Sidebar starts at lg, not md: at 768px it would eat 256px of an
          already-768px tablet, leaving 512px for the md: row/grid layouts that
          fire at the same breakpoint. Tablets use the drawer instead. */}
      <aside
        className={`hidden shrink-0 flex-col border-r transition-[width] duration-200 lg:flex ${collapsed ? "w-20" : "w-64"}`}
        style={{ background: SIDEBAR_BG, borderColor: "var(--ck-sidebar-border)" }}
      >
        <div className="p-6 pb-2">
          <div className={`mb-8 flex items-center ${collapsed ? "justify-center" : "justify-between gap-2"}`}>
            <Link href="/" className={`flex min-w-0 items-center hover:opacity-80 transition-opacity ${collapsed ? "justify-center" : "gap-2.5"}`}>
            {logoUrl ? (
              <Image src={logoUrl} alt={displayName} width={28} height={28} className="h-7 w-7 rounded-md object-contain p-[1px]" style={{ background: "rgba(244, 241, 232, 0.10)" }} unoptimized />
            ) : (
              <BrandMark size={26} variant="ivory" className="shrink-0" />
            )}
            {!collapsed && <div className="min-w-0" style={{ color: "var(--ck-sidebar-active-text)" }}>
              <BrandWordmark className="block text-[15px]" />
              <h1 className="mt-1 whitespace-normal break-words text-xs font-normal leading-relaxed [overflow-wrap:anywhere]">{displayName}</h1>
            </div>}
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
          {groupNav(menuNav).map((group, gi) => {
            const isCollapsedGroup = group.label ? collapsedGroups.has(group.label) : false;
            const showItems = collapsed || !isCollapsedGroup || !group.label;
            return (
            <div key={group.label ?? `g${gi}`}>
              {group.label && !collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label!)}
                  aria-expanded={showItems}
                  className="ui-mono-label mt-6 mb-1.5 flex w-full items-center justify-between px-2.5 transition-colors hover:!text-[var(--ck-sidebar-text)]"
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
              <nav className="space-y-0.5" aria-label={group.label || "Dashboard"}>
                {group.items.map((n) => {
                  const Icon = iconMap[n.icon] || Circle;
                  const isActive = isNavItemActive(pathname, n.href, visibleHrefs);
                  const navBlocked = isSuspended && !isSuspendedAllowed(n.href);
                  return (
                    <Link key={n.href} href={navBlocked ? pathname : n.href}
                      target={n.external ? "_blank" : undefined}
                      rel={n.external ? "noopener noreferrer" : undefined}
                      className={`group flex items-center rounded-[8px] px-2.5 py-[7px] text-[13.5px] transition-colors ${collapsed ? "justify-center" : "gap-2.5"} ${isActive
                          ? "ui-nav-active font-semibold"
                          : "font-medium text-[var(--ck-sidebar-text)] hover:bg-[var(--ck-sidebar-hover)] hover:text-[var(--ck-sidebar-active-text)]"
                        } ${navBlocked ? "opacity-40 pointer-events-none" : ""}`}
                      aria-disabled={navBlocked}
                      aria-current={isActive ? "page" : undefined}
                      aria-label={collapsed ? n.label : undefined}
                      tabIndex={navBlocked ? -1 : undefined}
                      title={collapsed ? `${n.label}${n.external ? " (opens in a new tab)" : ""}` : undefined}
                    >
                      <span className={`flex items-center justify-center${!(isActive && n.href === "/") ? " sidebar-icon" : ""}`} style={{ color: isActive ? "var(--ck-sidebar-icon-active)" : "var(--ck-sidebar-icon)" }}>
                        <Icon size={18} weight={isActive ? "fill" : "regular"} />
                      </span>
                      {!collapsed && <span className="flex-1 tracking-tight">{n.label}</span>}
                      {!collapsed && n.external && <span aria-hidden="true" className="text-[12px]">↗</span>}
                      {n.href === "/inbox" && <NotificationBadge />}
                      {n.href === "/refunds" && <RefundBadge />}
                      {n.href === "/settings" && !readOnly && <DataRequestBadge />}
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
        <a
          href="https://bookingtours.co.za"
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-auto border-t px-4 py-3 flex items-center ${collapsed ? "justify-center" : "gap-2"}`}
          style={{ borderColor: "var(--ck-sidebar-border)", color: "var(--ck-sidebar-muted)" }}
          title="Powered by BookingTours"
        >
          <BrandMark size={14} variant="ivory" className="shrink-0 opacity-70" />
          {!collapsed && (
            <span className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-medium">Powered by</span>
              <BrandWordmark className="text-[12px]" />
            </span>
          )}
        </a>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Desktop topbar — glass chrome: breadcrumb, live clock, session controls */}
        <header
          className="ui-glass flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2 lg:px-6"
          style={{ borderColor: "var(--ck-border-subtle)" }}
        >
          <div className="hidden min-w-0 items-baseline gap-2 lg:flex">
            <span className="ui-mono-label truncate max-w-[220px]">{displayName}</span>
            <span className="text-[11px]" style={{ color: "var(--ck-border-strong)" }}>/</span>
            <span className="ui-mono-label truncate" style={{ color: "var(--ck-text-strong)" }}>{sectionLabel}</span>
          </div>
          <Link href="/" className="flex min-w-0 items-center gap-2 transition-opacity hover:opacity-80 lg:hidden">
            {logoUrl ? (
              <Image src={logoUrl} alt={displayName} width={24} height={24} className="h-6 w-6 rounded object-contain" unoptimized />
            ) : (
              <BrandMark size={22} className="shrink-0" />
            )}
            <h1 className="max-w-[30vw] truncate text-base font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>{displayName}</h1>
          </Link>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2 lg:gap-4">
            {visibleNav.some((item) => item.href === "/simple") && !isSuspended && (
              <Link href="/simple" className="ui-btn ui-btn-soft min-h-11 !px-3 !text-[13px]">Simple View</Link>
            )}
            {clock && (
              <span className="ui-mono-label hidden lg:flex items-center gap-2">
                <span className="h-[5px] w-[5px] rounded-full motion-safe:animate-pulse" style={{ background: "var(--ck-accent)" }} aria-hidden="true" />
                {clock}
              </span>
            )}
            <div className="hidden items-center gap-4 lg:flex">
              <ThemeToggle size="sm" />
              <SignOutButton variant="header" />
            </div>
            <HelpChat inline />
          </div>
        </header>
        {isSuspended && (
          <div className="shrink-0 border-b px-4 py-2.5 md:px-10 flex items-center gap-2" style={{ background: "var(--ck-danger-soft)", borderColor: "color-mix(in srgb, var(--ck-danger) 25%, transparent)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "var(--ck-danger)" }}><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>
            <p className="text-xs font-medium" style={{ color: "var(--ck-danger)" }}>Subscription suspended. Only Reports, Invoices, Refunds, and Settings are accessible. Contact support to reactivate.</p>
          </div>
        )}
        {subscriptionStatus === "PAUSED" && !isSuspended && (
          <div className="shrink-0 border-b px-4 py-2.5 md:px-10 flex items-center gap-2" style={{ background: "var(--ck-warning-soft)", borderColor: "color-mix(in srgb, var(--ck-warning) 25%, transparent)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "var(--ck-warning)" }}><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>
            <p className="text-xs font-medium" style={{ color: "var(--ck-warning)" }}>Your subscription is paused for off-season. <a href="/billing" className="underline font-semibold">Resume</a> to take new bookings.</p>
          </div>
        )}
        {yocoTestMode && !readOnly && (
          <div className="shrink-0 border-b px-4 py-2.5 md:px-10 flex items-center gap-2" style={{ background: "var(--ck-amber-soft)", borderColor: "color-mix(in srgb, var(--ck-amber-bright) 30%, transparent)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" style={{ color: "var(--ck-amber)" }}><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
            <p className="text-xs font-medium" style={{ color: "var(--ck-amber)" }}>TEST MODE: Yoco payments are using sandbox keys. No real charges will be processed.</p>
          </div>
        )}
        {readOnly && (
          <div className="shrink-0 border-b px-4 py-2.5 md:px-10 flex flex-wrap items-center gap-x-3 gap-y-2" role="status" style={{ background: "var(--ck-accent-soft)", borderColor: "color-mix(in srgb, var(--ck-accent) 25%, transparent)" }}>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <ShieldCheck size={16} weight="fill" className="shrink-0" style={{ color: "var(--ck-accent)" }} aria-hidden="true" />
              <p className="text-xs font-medium" style={{ color: "var(--ck-accent)" }}>
                <span className="lg:hidden">Guided demo · No changes or messages are sent.</span>
                <span className="hidden lg:inline">Demo: try the forms. Buttons explain actions; nothing is saved or sent.</span>
              </p>
            </div>
            <a
              href={DEMO_BOOKING_SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--ck-surface)] lg:inline-flex"
              style={{ borderColor: "color-mix(in srgb, var(--ck-accent) 35%, transparent)", color: "var(--ck-accent)" }}
            >
              View Claire&apos;s booking site ↗
            </a>
          </div>
        )}
        <main className={`admin-main min-h-0 min-w-0 flex-1 ${pathname === "/inbox" ? "overflow-hidden p-0 lg:px-6 lg:py-6 xl:px-10 xl:py-8" : "overflow-auto px-4 py-6 pb-8 md:px-6 md:py-6 xl:px-10 xl:py-8"} ${pathname === "/" ? dashboardStyles.dashboardMain : ""}`}>
          {readOnly && !isDemoPathVisible(pathname) ? (
            <div className="ui-card mx-auto max-w-md p-8 text-center">
              <h2 className="text-lg font-semibold">This section is not part of the demo</h2>
              <Link href="/bookings" className="mt-4 inline-block underline underline-offset-4">Explore bookings</Link>
            </div>
          ) : routeBlocked ? (
            <div className="flex items-center justify-center min-h-[50vh]">
              <div className="ui-card px-10 py-9 text-center max-w-sm">
                <h2 className="text-lg font-semibold text-[var(--ck-text-strong)] mb-1">Feature Unavailable</h2>
                <p className="text-sm text-[var(--ck-text-muted)]">Subscription suspended. Reports, Invoices, Refunds and Settings remain available.</p>
              </div>
            </div>
          ) : readOnly ? <DemoActionGuide>{children}</DemoActionGuide> : children}
        </main>

        <nav className="ui-glass lg:hidden shrink-0 border-t px-1 pt-1" aria-label="Primary" style={{ borderColor: "var(--ck-border-subtle)", paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}>
          <div className="flex w-full">
          {mobilePrimaryNav.map((n) => {
            const Icon = iconMap[n.icon] || Circle;
            const isActive = isNavItemActive(pathname, n.href, visibleHrefs);
            const mobileBlocked = isSuspended && !isSuspendedAllowed(n.href);
            return (
              <Link key={n.href} href={mobileBlocked ? pathname : n.href} className={"relative flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-1 text-[11px] " + (isActive ? "font-semibold" : "font-medium") + (mobileBlocked ? " opacity-30 pointer-events-none" : "")} aria-current={isActive ? "page" : undefined} aria-disabled={mobileBlocked} tabIndex={mobileBlocked ? -1 : undefined} style={{ color: isActive ? "var(--ck-accent)" : "var(--ck-text-muted)" }}>
                <div className="relative mb-1">
                  <Icon size={20} weight={isActive ? "fill" : "regular"} />
                  {n.href === "/inbox" && <div className="absolute -top-1 -right-2 transform scale-75"><NotificationBadge /></div>}
                  {n.href === "/refunds" && <div className="absolute -top-1 -right-2 transform scale-75"><RefundBadge /></div>}
                </div>
                <span className="max-w-full whitespace-nowrap">{n.href === "/" ? "Today" : n.label}</span>
                {isActive && <span className="absolute -bottom-0.5 h-[3px] w-[3px] rounded-full" style={{ background: "var(--ck-amber-bright)" }} aria-hidden="true" />}
              </Link>
            );
          })}
          <MobileMenuDrawer nav={menuNav} active={mobileMoreActive} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup} />
          </div>
        </nav>
      </div>
    </div>
  );
}
