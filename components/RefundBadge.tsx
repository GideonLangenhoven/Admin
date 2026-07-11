"use client";
import { useEffect, useState } from "react";
import { supabase } from "../app/lib/supabase";
import { useBusinessContext } from "./BusinessContext";

export default function RefundBadge() {
    const { businessId } = useBusinessContext();
    const [count, setCount] = useState(0);

    useEffect(() => {
        if (!businessId) return;
        fetchCount();

        const channelName = "refund-badge-" + businessId;
        // Remove any stale channel from a previous mount (React StrictMode / re-render)
        supabase.removeChannel(supabase.channel(channelName));

        const channel = supabase.channel(channelName)
            .on(
                "postgres_changes" as any,
                { event: "*", schema: "public", table: "bookings" },
                () => fetchCount()
            )
            // Refetch on (re)connect — covers changes missed while the
            // channel was down; realtime failures are otherwise silent.
            .subscribe((status) => {
                if (status === "SUBSCRIBED") fetchCount();
            });

        // Realtime can silently drop; refetch whenever the tab regains focus.
        const onFocus = () => {
            if (document.visibilityState === "visible") fetchCount();
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onFocus);

        return () => {
            supabase.removeChannel(channel);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onFocus);
        };
    }, [businessId]);

    async function fetchCount() {
        if (!businessId) return;
        // ACTION_REQUIRED excluded: those await the CUSTOMER's choice
        // (refund/voucher/reschedule) and are not operator work yet —
        // mirrors the refunds-page queue filter.
        const { count } = await supabase
            .from("bookings")
            .select("*", { count: "exact", head: true })
            .eq("business_id", businessId)
            .eq("refund_status", "REQUESTED");

        setCount(count || 0);
    }

    if (count === 0) return null;

    return (
        <span className="ml-auto min-w-[20px] rounded-full border border-white/35 bg-[var(--ck-danger)] px-1.5 py-0.5 text-center text-[10px] font-bold text-white shadow-sm">
            {count > 99 ? "99+" : count}
        </span>
    );
}
