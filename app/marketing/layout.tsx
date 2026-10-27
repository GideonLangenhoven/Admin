"use client";
import SectionTabs from "../../components/SectionTabs";
import MarketingSetupNotice from "../../components/marketing/MarketingSetupNotice";
import { usePathname } from "next/navigation";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const contactsPage = usePathname() === "/marketing/contacts";
  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[24px] font-semibold leading-none md:text-[28px]" style={{ color: "var(--ck-text-strong)" }}>Marketing</h2>
        {!contactsPage && <SectionTabs section="marketing" display="mobile" />}
      </div>

      <SectionTabs section="marketing" display="desktop" />
      <MarketingSetupNotice />

      {children}
    </div>
  );
}
