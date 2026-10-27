"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CaretDown } from "@phosphor-icons/react";
import { isDemoPathVisible } from "@/app/lib/demo-guide";
import { useBusinessContext } from "./BusinessContext";

type Section = "broadcasts" | "marketing" | "ai";
type Tab = { href: string; label: string; privilegedOnly?: boolean };

const TABS: Record<Section, Tab[]> = {
  broadcasts: [{ href: "/broadcasts", label: "Broadcasts" }, { href: "/notifications", label: "Failed Notifications", privilegedOnly: true }],
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

export default function SectionTabs({ section, display = "responsive" }: { section: Section; display?: "responsive" | "mobile" | "desktop" }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { role, readOnly } = useBusinessContext();

  const tabs = TABS[section].filter((tab) =>
    (!tab.privilegedOnly || role === "MAIN_ADMIN" || role === "SUPER_ADMIN") &&
    (!readOnly || isDemoPathVisible(tab.href))
  );
  const activeTab = tabs.find(tab => pathname === tab.href || (tab.href !== "/marketing" && pathname.startsWith(tab.href + "/")));
  const mobileDropdown = section === "marketing" && display !== "desktop";

  return (
    <nav aria-label={`${section === "ai" ? "AI" : section[0].toUpperCase() + section.slice(1)} sections`} className={`${display === "mobile" ? "md:hidden" : display === "desktop" ? "hidden border-b md:block" : section === "marketing" ? "md:border-b" : "border-b"}`} style={{ borderColor: "var(--ck-border-subtle)" }}>
      {mobileDropdown && <div className="relative w-40 max-w-full md:hidden">
        <select aria-label="Marketing section" value={activeTab?.href || tabs[0]?.href || ""} onChange={event => router.push(event.target.value)} className="ui-control min-h-11 w-full appearance-none !pr-9">
          {tabs.map(tab => <option key={tab.href} value={tab.href}>{tab.label}</option>)}
        </select>
        <CaretDown size={14} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
      </div>}
      {display !== "mobile" && <div className={`${section === "marketing" ? "hidden md:flex" : "flex"} flex-wrap gap-1`}>
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
      </div>}
    </nav>
  );
}
