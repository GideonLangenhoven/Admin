
"use client";
import { useEffect, useState } from "react";
import { supabase } from "../app/lib/supabase";
import { useBusinessContext } from "./BusinessContext";

export default function NotificationBadge() {
    const { businessId } = useBusinessContext();
    const [count, setCount] = useState(0);
    const [dismissedCount, setDismissedCount] = useState(0);

    useEffect(() => {
        if (!businessId) return;
        fetchCount();

        // Remove stale channel from previous mount (React StrictMode)
        supabase.removeChannel(supabase.channel("inbox-badge"));

        const channel = supabase
            .channel("inbox-badge")
            .on(
                "postgres_changes" as any,
                { event: "*", schema: "public", table: "conversations" },
                () => fetchCount()
            )
            .subscribe();

        const handleLocalUpdate = () => fetchCount();
        window.addEventListener("inbox-updated", handleLocalUpdate);

        return () => {
            supabase.removeChannel(channel);
            window.removeEventListener("inbox-updated", handleLocalUpdate);
        };
    }, [businessId]);

    async function fetchCount() {
        if (!businessId) return;
        const { count } = await supabase
            .from("conversations")
            .select("*", { count: "exact", head: true })
            .eq("business_id", businessId)
            .eq("status", "HUMAN");

        const nextCount = count || 0;
        setCount(nextCount);
        if (nextCount > dismissedCount) {
            setDismissedCount(0);
        }
    }

    const visibleCount = Math.max(count - dismissedCount, 0);

    if (visibleCount === 0) return null;

    return (
        <button
            type="button"
            title="Dismiss unread badge until the count changes"
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDismissedCount(count);
            }}
            className="ml-auto min-w-[20px] rounded-full border border-white/35 bg-[var(--ck-danger)] px-1.5 py-0.5 text-center text-[10px] font-bold text-white shadow-sm"
        >
            {visibleCount > 99 ? "99+" : visibleCount}
        </button>
    );
}
