"use client";

import { useCallback, useEffect, useState } from "react";
import { bookingRealtimeFilter } from "@/app/lib/bookings-realtime";
import { supabase } from "@/app/lib/supabase";
import { loadSimpleDay, type SimpleDay } from "./simple-data";

export function useSimpleDay(businessId: string, date: string, timeZone: string) {
  const [data, setData] = useState<SimpleDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async (quiet = false) => {
    if (!businessId || !date) return;
    if (!quiet) setLoading(true);
    setError("");
    try {
      setData(await loadSimpleDay({ businessId, date, timeZone }));
    } catch (cause) {
      console.error("Simple view day load failed", cause);
      setError("We couldn’t load this day. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [businessId, date, timeZone]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!businessId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reload(true), 150);
    };
    const channel = supabase.channel("simple-day-" + businessId + "-" + date)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "bookings", filter: bookingRealtimeFilter(businessId) }, refreshSoon)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "slots", filter: bookingRealtimeFilter(businessId) }, refreshSoon)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [businessId, date, reload]);

  return { data, loading, error, reload };
}
