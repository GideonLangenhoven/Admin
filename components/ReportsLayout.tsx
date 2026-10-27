"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { isDemoPathVisible } from "@/app/lib/demo-guide";
import { isSectionHidden } from "@/app/lib/operator-sections";
import { useBusinessContext } from "./BusinessContext";

export const REPORT_TABS = [
  { key: "bookings", label: "Bookings" },
  { key: "financials", label: "Financials" },
  { key: "marketing", label: "Marketing" },
  { key: "attendance", label: "Attendance" },
  { key: "waivers", label: "Waivers" },
] as const;

export default function ReportsLayout({ activeTab, description, actions, children }: {
  activeTab: typeof REPORT_TABS[number]["key"] | "reviews";
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { role, readOnly, subscriptionStatus } = useBusinessContext();
  const activeTabRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);
  const hideReviews = useSyncExternalStore((onChange) => {
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, () => {
    try {
      return isSectionHidden(JSON.parse(localStorage.getItem("ck_admin_settings_perms") || "{}"), "/reviews");
    } catch { return false; }
  }, () => false);
  const showReviews = (!readOnly || isDemoPathVisible("/reviews")) &&
    (subscriptionStatus !== "SUSPENDED" || role === "SUPER_ADMIN") &&
    (!hideReviews || role === "MAIN_ADMIN" || role === "SUPER_ADMIN");

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto pb-10">
      <div className="anim-fade-up flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Reports</h1>
          {description && <p className="mt-2 text-[13px]" style={{ color: "var(--ck-text-muted)" }}>{description}</p>}
        </div>
        {actions && <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">{actions}</div>}
      </div>

      <nav aria-label="Report types" className="anim-fade-up anim-d1">
        <div className="ui-seg">
          {REPORT_TABS.map(({ key, label }) => (
            <Link key={key} href={key === "bookings" ? "/reports" : `/reports?tab=${key}`} scroll={false} ref={activeTab === key ? activeTabRef : undefined}
              className="ui-seg-item" data-active={activeTab === key} aria-current={activeTab === key ? "page" : undefined}>
              {label}
            </Link>
          ))}
          {showReviews && (
            <Link href="/reviews" scroll={false} ref={activeTab === "reviews" ? activeTabRef : undefined} className="ui-seg-item" data-active={activeTab === "reviews"} aria-current={activeTab === "reviews" ? "page" : undefined}>
              Reviews
            </Link>
          )}
        </div>
      </nav>

      {children}
    </div>
  );
}
