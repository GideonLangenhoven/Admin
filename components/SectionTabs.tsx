"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { isDemoPathVisible } from "@/app/lib/demo-guide";
import { isSectionHidden } from "@/app/lib/operator-sections";
import { useBusinessContext } from "./BusinessContext";

type Section = "broadcasts" | "reports" | "marketing" | "ai";
type Tab = { href: string; label: string; privilegedOnly?: boolean };

const TABS: Record<Section, Tab[]> = {
  broadcasts: [{ href: "/broadcasts", label: "Broadcasts" }, { href: "/notifications", label: "Failed Notifications", privilegedOnly: true }],
  reports: [{ href: "/reports", label: "Reports" }, { href: "/reviews", label: "Reviews" }],
  marketing: [
    { href: "/marketing", label: "Overview" },
    { href: "/marketing/contacts", label: "Contacts" },
    { href: "/marketing/templates", label: "Templates" },
    { href: "/marketing/automations", label: "Automations" },
    { href: "/marketing/promotions", label: "Promos" },
    { href: "/vouchers", label: "Vouchers" },
  ],
  ai: [{ href: "/ai-usage", label: "AI Usage" }, { href: "/settings/chat-faq", label: "Chat FAQ" }],
};

export default function SectionTabs({ section }: { section: Section }) {
  const pathname = usePathname() || "";
  const { role, readOnly, subscriptionStatus } = useBusinessContext();
  const hideReviews = useSyncExternalStore((onChange) => {
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, () => {
    try {
      return isSectionHidden(JSON.parse(localStorage.getItem("ck_admin_settings_perms") || "{}"), "/reviews");
    } catch { return false; }
  }, () => false);

  const tabs = TABS[section].filter((tab) =>
    (!tab.privilegedOnly || role === "MAIN_ADMIN" || role === "SUPER_ADMIN") &&
    (!readOnly || isDemoPathVisible(tab.href)) &&
    (tab.href !== "/reviews" || subscriptionStatus !== "SUSPENDED" || role === "SUPER_ADMIN") &&
    (tab.href !== "/reviews" || !hideReviews || role === "MAIN_ADMIN" || role === "SUPER_ADMIN")
  );

  return (
    <nav aria-label={`${section === "ai" ? "AI" : section[0].toUpperCase() + section.slice(1)} sections`} className="-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0" style={{ borderColor: "var(--ck-border-subtle)" }}>
      <div className="flex w-max gap-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || (tab.href !== "/marketing" && pathname.startsWith(tab.href + "/"));
          return (
            <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined}
              className={`-mb-px flex items-center border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${active
                ? "border-[var(--ck-accent)] text-[var(--ck-accent)]"
                : "border-transparent text-[var(--ck-text-muted)] hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text-strong)]"}`}>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
