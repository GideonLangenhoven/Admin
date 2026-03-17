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
import * as LucideIcons from "lucide-react";

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

export default function AppShell({ children, nav }: { children: React.ReactNode; nav: NavItem[] }) {
  const pathname = usePathname() || "";
  const { businessId, businessName, logoUrl, role } = useBusinessContext();
  const displayName = businessName || "Kayaks";
  const [collapsed, setCollapsed] = useState(false);

  // Strip privileged-only items for plain ADMIN users
  const visibleNav = nav.filter((n) => !n.privilegedOnly || isPrivilegedRole(role));

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
      <aside className={`hidden shrink-0 flex-col border-r bg-[var(--ck-sidebar)] transition-[width] duration-200 md:flex ${collapsed ? "w-20" : "w-64"}`} style={{ borderColor: "var(--ck-sidebar-border)" }}>
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

        <div className="flex-1 overflow-auto px-4 pb-4">
          {!collapsed && <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ck-sidebar-muted)" }}>General</div>}
          <nav className="space-y-1">
            {visibleNav.map((n) => {
              const Icon = (LucideIcons as any)[n.icon] || LucideIcons.Circle;
              const isActive = n.href === "/" ? pathname === "/" : pathname === n.href || pathname.startsWith(n.href + "/");
              return (
                <Link key={n.href} href={n.href}
                  className={`group flex items-center rounded-xl px-3 py-2 text-sm transition-colors ${collapsed ? "justify-center" : "gap-3"} ${isActive
                      ? "font-medium shadow-sm border"
                      : "font-medium"
                    }`}
                  style={isActive
                    ? { background: "var(--ck-sidebar-active-bg)", color: "var(--ck-sidebar-active-text)", borderColor: "var(--ck-sidebar-active-border)" }
                    : { color: "var(--ck-sidebar-text)" }
                  }
                  onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = "var(--ck-sidebar-hover)"; e.currentTarget.style.color = "var(--ck-sidebar-active-text)"; } }}
                  onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--ck-sidebar-text)"; } }}
                >
                  <span className="flex items-center justify-center" style={{ color: isActive ? "var(--ck-success)" : "var(--ck-sidebar-muted)" }}>
                    {isActive && n.href === "/" ? (
                      <div className="flex items-center justify-center h-[18px] w-[18px] rounded-full" style={{ background: "var(--ck-accent)" }}>
                        <LucideIcons.Check size={12} color="white" strokeWidth={4} />
                      </div>
                    ) : (
                      <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
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
        <main className="flex-1 overflow-auto px-4 py-6 pb-8 md:px-10 md:py-8">{children}</main>

        <nav className="md:hidden shrink-0 overflow-x-auto border-t py-2 backdrop-blur no-scrollbar" style={{ background: "color-mix(in srgb, var(--ck-surface) 90%, transparent)", borderColor: "var(--ck-border-strong)" }}>
          <div className="flex min-w-max px-2">
          {visibleNav.map((n) => {
            const Icon = (LucideIcons as any)[n.icon] || LucideIcons.Circle;
            const isActive = n.href === "/" ? pathname === "/" : pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link key={n.href} href={n.href} className="relative flex w-[74px] shrink-0 flex-col items-center rounded-lg px-1 py-1 text-[11px] font-medium" style={{ color: isActive ? "var(--ck-accent)" : "var(--ck-text-muted)" }}>
                <div className="relative mb-1">
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
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
