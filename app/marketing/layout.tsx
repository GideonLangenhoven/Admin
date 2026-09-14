"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/marketing", label: "Overview", exact: true },
  { href: "/marketing/contacts", label: "Contacts" },
  { href: "/marketing/templates", label: "Templates" },
  { href: "/marketing/automations", label: "Automations" },
  { href: "/marketing/promotions", label: "Promos" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";

  return (
    <div className="max-w-7xl space-y-6">
      <div className="anim-fade-up">
        <p className="ui-mono-label mb-2">Growth</p>
        <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Marketing</h1>
        <p className="text-sm mt-2" style={{ color: "var(--ck-text-muted)" }}>Email campaigns, contacts, and templates</p>
      </div>

      <nav className="flex gap-1 border-b" style={{ borderColor: "var(--ck-border-subtle)" }}>
        {tabs.map((t) => {
          const isActive = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                isActive
                  ? "border-[var(--ck-accent)] text-[var(--ck-accent)]"
                  : "border-transparent hover:border-[var(--ck-border-strong)]"
              }`}
              style={isActive ? {} : { color: "var(--ck-text-muted)" }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
