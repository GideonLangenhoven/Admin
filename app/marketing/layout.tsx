"use client";
import SectionTabs from "../../components/SectionTabs";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-7xl space-y-6">
      <div className="anim-fade-up">
        <p className="ui-mono-label mb-2">Growth</p>
        <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Marketing</h1>
        <p className="text-sm mt-2" style={{ color: "var(--ck-text-muted)" }}>Email campaigns, contacts, and templates</p>
      </div>

      <SectionTabs section="marketing" />

      {children}
    </div>
  );
}
