"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UsersThree, Layout, ChartBar, Lightning, Tag } from "@phosphor-icons/react";

var tabs = [
  { href: "/marketing", label: "Overview", icon: ChartBar, exact: true },
  { href: "/marketing/contacts", label: "Contacts", icon: UsersThree },
  { href: "/marketing/templates", label: "Templates", icon: Layout },
  { href: "/marketing/automations", label: "Automations", icon: Lightning },
  { href: "/marketing/promotions", label: "Promos", icon: Tag },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  var pathname = usePathname() || "";

  return (
    <div className="max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Marketing</h1>
        <p className="text-sm mt-1" style={{ color: "var(--ck-text-muted)" }}>Email campaigns, contacts, and templates</p>
      </div>

      <nav className="flex gap-1 border-b" style={{ borderColor: "var(--ck-border)" }}>
        {tabs.map((t) => {
          var isActive = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          var Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                isActive
                  ? "border-[var(--ck-accent)] text-[var(--ck-accent)]"
                  : "border-transparent hover:border-gray-300"
              }`}
              style={isActive ? {} : { color: "var(--ck-text-muted)" }}
            >
              <Icon size={16} />
              {t.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
