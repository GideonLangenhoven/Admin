"use client";

import { useRouter, usePathname } from "next/navigation";
import { useBusinessContext } from "@/components/BusinessContext";
import { CaretLeft, Waves } from "@phosphor-icons/react";

/**
 * Standalone app chrome for the Guide PWA. Deliberately NOT the admin AppShell —
 * this is the guide's own full-screen mobile experience. Provides the header
 * (brand identity + contextual back button) and the page background; individual
 * screens render their content inside <main>. Speaks the same Field Console
 * design language as the admin app: deep-pine chrome, amber trail marker,
 * paper canvas.
 */
export default function GuideShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { businessName } = useBusinessContext();
  const isHome = pathname === "/guide";

  return (
    <div className="min-h-[100dvh]" style={{ background: "var(--ck-bg)", color: "var(--ck-text)" }}>
      {/* Header — the same night surface as the admin hero cards */}
      <header className="relative overflow-hidden bg-bt-dark text-white">
        <div className="relative max-w-md mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-5">
          <div className="flex items-center gap-3">
            {!isHome ? (
              <button
                onClick={() => router.back()}
                aria-label="Back"
                className="w-9 h-9 -ml-1 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center transition"
                style={{ boxShadow: "inset 0 0 0 1px rgba(244,241,232,0.14)" }}
              >
                <CaretLeft size={20} weight="bold" />
              </button>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0" style={{ boxShadow: "inset 0 0 0 1px rgba(244,241,232,0.14)" }}>
                <Waves size={24} weight="regular" style={{ color: "var(--ck-amber-bright)" }} />
              </div>
            )}
            <div className="min-w-0">
              <p className="ui-mono-label" style={{ color: "var(--ck-amber-bright)" }}>Field Console</p>
              <h1 className="font-display text-[20px] font-semibold leading-tight truncate" style={{ color: "#F6F3EA" }}>{businessName || "Guide"}</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  );
}
