"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarBlank, CheckCircle, House, Plus, SquaresFour } from "@phosphor-icons/react";
import { useBusinessContext } from "./BusinessContext";
import { BrandMark } from "./BrandLogo";
import ThemeToggle from "./ThemeToggle";

const destinations = [
  { href: "/simple", label: "Today", icon: House },
  { href: "/simple/calendar", label: "Calendar", icon: CalendarBlank },
  { href: "/simple/check-ins", label: "Check-ins", icon: CheckCircle },
];

function isActive(pathname: string, href: string) {
  return href === "/simple" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

export default function SimpleViewShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/simple";
  const { businessName, logoUrl, readOnly } = useBusinessContext();
  const [currentUrl, setCurrentUrl] = useState(pathname);

  useEffect(() => {
    setCurrentUrl(window.location.pathname + window.location.search);
  }, [pathname]);

  const walkInHref = useMemo(() => {
    const params = new URLSearchParams();
    const currentParams = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
    const date = currentParams.get("date");
    if (date) params.set("date", date);
    const safeReturn = pathname === "/simple/new-booking" ? "/simple" : currentUrl;
    params.set("returnTo", safeReturn);
    return "/simple/new-booking?" + params.toString();
  }, [currentUrl, pathname]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--ck-bg)]">
      <header className="ui-glass z-20 shrink-0 border-b" style={{ borderColor: "var(--ck-border-subtle)" }}>
        <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-3 px-4 py-2 md:px-6">
          <Link href="/simple" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ck-accent)]">
            {logoUrl ? (
              <Image src={logoUrl} alt="" width={34} height={34} className="h-9 w-9 shrink-0 rounded-lg object-contain" unoptimized />
            ) : (
              <BrandMark size={26} className="shrink-0" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight" style={{ color: "var(--ck-text-strong)" }}>{businessName || "BookingTours"}</span>
              <span className="ui-mono-label block !text-[9px] leading-tight">Simple view</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Simple view">
            {destinations.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${active ? "bg-[var(--ck-accent-soft)] text-[var(--ck-accent)]" : "text-[var(--ck-text-muted)] hover:bg-[var(--ck-surface-sunken)]"}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={18} weight={active ? "fill" : "regular"} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden lg:block"><ThemeToggle size="sm" /></div>
            {!readOnly && pathname !== "/simple/new-booking" && (
              <Link href={walkInHref} className="ui-btn ui-btn-primary !h-11 !rounded-xl !px-3 text-sm font-semibold">
                <Plus size={18} weight="bold" />
                <span className="hidden sm:inline">Add walk-in</span>
                <span className="sm:hidden">Walk-in</span>
              </Link>
            )}
            <Link
              href="/"
              className="flex h-11 w-11 items-center justify-center rounded-xl border transition-colors hover:bg-[var(--ck-surface-sunken)] sm:w-auto sm:gap-2 sm:px-3"
              style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text)" }}
              title="Full dashboard"
            >
              <SquaresFour size={19} />
              <span className="hidden text-sm font-semibold sm:inline">Full dashboard</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-24 md:px-6 md:py-7 md:pb-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>

      <nav className="ui-glass z-20 shrink-0 border-t px-2 pt-1 md:hidden" aria-label="Simple view" style={{ borderColor: "var(--ck-border-subtle)", paddingBottom: "max(0.3rem, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-md">
          {destinations.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="relative flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold"
                style={{ color: active ? "var(--ck-accent)" : "var(--ck-text-muted)" }}
              >
                <Icon size={22} weight={active ? "fill" : "regular"} />
                <span>{item.label}</span>
                {active && <span className="absolute bottom-0 h-1 w-1 rounded-full bg-[var(--ck-amber-bright)]" aria-hidden="true" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
