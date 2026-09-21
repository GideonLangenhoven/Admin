"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowUpRight, CalendarBlank, CheckCircle, House, MoonStars, Plus, Sun } from "@phosphor-icons/react";
import { useBusinessContext } from "./BusinessContext";
import { useTheme } from "./ThemeProvider";
import "./simple/simple-view.css";

const destinations = [
  { href: "/simple", label: "Today", icon: House },
  { href: "/simple/calendar", label: "Calendar", icon: CalendarBlank },
  { href: "/simple/check-ins", label: "Check-ins", icon: CheckCircle },
];

function isActive(pathname: string, href: string) {
  return href === "/simple" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

function WalkInAction({ href }: { href: string }) {
  return (
    <Link href={href} className="sv-walk-in" aria-label="Add walk-in">
      <Plus size={18} weight="bold" />
      <span className="hidden sm:inline">Add walk-in</span>
      <span className="sm:hidden">Walk-in</span>
    </Link>
  );
}

function ContextualWalkInAction({ pathname }: { pathname: string }) {
  const searchParams = useSearchParams();
  const params = new URLSearchParams();
  const date = searchParams.get("date");
  if (date) params.set("date", date);
  const query = searchParams.toString();
  params.set("returnTo", pathname + (query ? "?" + query : ""));
  return <WalkInAction href={"/simple/new-booking?" + params.toString()} />;
}

export default function SimpleViewShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/simple";
  const { businessName, logoUrl, readOnly } = useBusinessContext();
  const { theme, toggle } = useTheme();
  const fallbackParams = new URLSearchParams({ returnTo: pathname === "/simple/new-booking" ? "/simple" : pathname });
  const fallbackWalkInHref = "/simple/new-booking?" + fallbackParams.toString();

  return (
    <div className="simple-view">
      <header className="sv-header">
        <div className="sv-header-inner">
          <Link href="/simple" className="sv-brand" aria-label={`${businessName || "BookingTours"}, Simple view`}>
            {logoUrl ? (
              <Image src={logoUrl} alt="" width={36} height={36} className="sv-brand-image" unoptimized />
            ) : (
              <span className="sv-brand-monogram" aria-hidden="true">{(businessName || "BookingTours").trim().charAt(0)}</span>
            )}
            <span className="min-w-0">
              <span className="sv-brand-name">{businessName || "BookingTours"}</span>
              <span className="sv-brand-caption">Simple view</span>
            </span>
          </Link>

          <nav className="sv-desktop-nav" aria-label="Simple view">
            {destinations.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="sv-nav-link"
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={18} weight={active ? "fill" : "regular"} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="sv-header-actions">
            <button type="button" onClick={toggle} className="sv-theme sv-icon-button" aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              {theme === "dark" ? <Sun size={20} /> : <MoonStars size={20} />}
            </button>
            {!readOnly && pathname !== "/simple/new-booking" && (
              <Suspense fallback={<WalkInAction href={fallbackWalkInHref} />}>
                <ContextualWalkInAction pathname={pathname} />
              </Suspense>
            )}
            <Link
              href="/"
              className="sv-dashboard-link"
              title="Full dashboard"
              aria-label="Full dashboard"
            >
              <span>Full dashboard</span>
              <ArrowUpRight size={20} />
            </Link>
          </div>
        </div>
      </header>

      <main className="sv-main">
        <div className={`sv-content${pathname === "/simple/new-booking" ? " sv-booking-form" : ""}`}>{children}</div>
      </main>

      <nav className="sv-mobile-nav" aria-label="Simple view">
        <div className="sv-mobile-nav-inner">
          {destinations.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="sv-nav-link"
              >
                <Icon size={22} weight={active ? "fill" : "regular"} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
