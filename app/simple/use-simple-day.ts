"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { restoreReturnPosition } from "@/app/lib/simple-view";
import { bookingRealtimeFilter } from "@/app/lib/bookings-realtime";
import { supabase } from "@/app/lib/supabase";
import { loadSimpleDay, type SimpleDay } from "./simple-data";

export function useSimpleDay(businessId: string, date: string, timeZone: string, guide = false) {
  const [data, setData] = useState<SimpleDay | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedScope, setLoadedScope] = useState<typeof scope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const scope = useMemo(() => ({ businessId, date, timeZone, guide }), [businessId, date, timeZone, guide]);
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
    setRefreshing(true);
    setError("");
    try {
      const next = await loadSimpleDay(scope);
      if (isCurrent()) {
        setLoadedScope(scope);
        setData(next);
        setUpdatedAt(new Date().toISOString());
      }
    } catch (cause) {
      if (!isCurrent()) return;
      void cause;
      setError("Day unavailable. Check your connection and retry.");
    } finally {
      if (isCurrent()) { setLoading(false); setRefreshing(false); }
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
    if (!businessId || !date || guide) return;
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
  }, [businessId, date, reload, guide]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => reload(true);
    const offline = () => setError("Connection lost. Refresh after reconnecting before changing arrivals.");
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("offline", offline);
    const timer = setInterval(refresh, 60_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("offline", offline);
    };
  }, [reload]);

  useEffect(()=>{
    if(typeof window!=="undefined" && data && loadedScope===scope) restoreReturnPosition(businessId,window.location.pathname+window.location.search);
  },[data,loadedScope,scope,businessId]);

  const matches = loadedScope === scope;
  return { data: matches ? data : null, loading: loading || (!matches && !error && !!businessId && !!date), error, reload, updatedAt: matches ? updatedAt : null, refreshing };

}
