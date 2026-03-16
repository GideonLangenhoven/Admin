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

        const channel = supabase
            .channel("refund-badge")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "bookings" },
                () => fetchCount()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [businessId]);

    async function fetchCount() {
        if (!businessId) return;
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
