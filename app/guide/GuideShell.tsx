"use client";

import { useRouter, usePathname } from "next/navigation";
import { useBusinessContext } from "@/components/BusinessContext";

/**
 * Standalone app chrome for the Guide PWA. Deliberately NOT the admin AppShell —
 * this is the guide's own full-screen mobile experience. Provides the header
 * (brand identity + contextual back button) and the page background; individual
 * screens render their content inside <main>.
 */
export default function GuideShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { businessName } = useBusinessContext();
  const isHome = pathname === "/guide";

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
      {/* Header */}
      <header
        className="relative overflow-hidden text-white"
        style={{ background: "linear-gradient(135deg, #0e7490 0%, #155e75 55%, #0c4a5e 100%)" }}
      >
        {/* subtle wave texture */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-8 h-16 opacity-20"
          style={{ background: "radial-gradient(120% 60% at 50% 0%, #67e8f9 0%, transparent 70%)" }} />
        <div className="relative max-w-md mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-5">
          <div className="flex items-center gap-3">
            {!isHome ? (
              <button
                onClick={() => router.back()}
                aria-label="Back"
                className="w-9 h-9 -ml-1 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 flex items-center justify-center transition"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
              </button>
            ) : (
              <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 13c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M8 8l4-5 4 5" /></svg>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100/80">Guide</p>
              <h1 className="text-[19px] font-extrabold leading-tight truncate">{businessName || "Field Console"}</h1>
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
