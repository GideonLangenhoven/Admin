"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bookingRealtimeFilter } from "@/app/lib/bookings-realtime";
import { supabase } from "@/app/lib/supabase";
import { loadSimpleDay, type SimpleDay } from "./simple-data";

export function useSimpleDay(businessId: string, date: string, timeZone: string) {
  const [data, setData] = useState<SimpleDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const scope = useMemo(() => ({ businessId, date, timeZone }), [businessId, date, timeZone]);
  const activeRef = useRef<{ scope: typeof scope; request: number } | null>(null);

  const reload = useCallback(async (quiet = false) => {
    const active = activeRef.current;
    if (!active || active.scope !== scope) return;
    const request = ++active.request;
    const isCurrent = () => activeRef.current === active && active.request === request;
    if (!scope.businessId || !scope.date) {
      if (isCurrent()) {
        setData(null);
        setLoading(false);
        setError("");
      }
      return;
    }
    if (!quiet) setLoading(true);
    setError("");
    try {
      const next = await loadSimpleDay(scope);
      if (isCurrent()) setData(next);
    } catch (cause) {
      if (!isCurrent()) return;
      console.error("Simple view day load failed", cause);
      setError("We couldn’t load this day. Check your connection and try again.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    const active = { scope, request: 0 };
    activeRef.current = active;
    reload();
    return () => {
      if (activeRef.current === active) activeRef.current = null;
    };
  }, [reload, scope]);

  useEffect(() => {
    if (!businessId || !date) return;
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
