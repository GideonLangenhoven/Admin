"use client";

import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/app/lib/admin-auth";
import { useBusinessContext } from "./BusinessContext";

export default function DataRequestBadge() {
  const { businessId, role, readOnly } = useBusinessContext();
  const [count, setCount] = useState(0);
  const canReview = !readOnly && (role === "MAIN_ADMIN" || role === "SUPER_ADMIN");

  useEffect(() => {
    if (!businessId || !canReview) return;
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/admin/data-requests?summary=actionable", { headers: await getAuthHeaders(businessId) });
        if (!response.ok) return;
        const data = await response.json();
        if (active) setCount(data.count ?? 0);
      } catch { /* Keep the last count until the next refresh. */ }
    }
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("data-requests-updated", refresh);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("data-requests-updated", refresh);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [businessId, canReview]);

  if (!canReview || count === 0) return null;
  return <span aria-live="polite" aria-label={`${count} data requests need review`}
    className="ml-auto min-w-[20px] rounded-full border border-white/35 bg-[var(--ck-danger)] px-1.5 py-0.5 text-center text-[10px] font-bold text-white shadow-sm">
    {count > 99 ? "99+" : count}
  </span>;
}
