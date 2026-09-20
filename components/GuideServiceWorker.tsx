"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import type { GuideQueueStatus } from "@/app/lib/guide-offline";
import {
  beginGuideQueueAuthGeneration,
  guideQueueAuthContext,
  postGuideQueueAuthContext,
  registerGuideCheckInSync,
  requestGuideQueueStatus,
} from "@/app/lib/guide-offline";
import { useBusinessContext } from "@/components/BusinessContext";

export default function GuideServiceWorker() {
  const { businessId } = useBusinessContext();
  const [status, setStatus] = useState<GuideQueueStatus>({ pending: 0, needsReauth: 0, failed: 0, blocked: 0 });
  const [statusRevision, setStatusRevision] = useState(0);
  const foregroundRetries = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let active = true;
    let authGeneration = beginGuideQueueAuthGeneration();
    const publishAuth = async () => {
      const generation = authGeneration;
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      const context = guideQueueAuthContext(session, businessId);
      const published = await postGuideQueueAuthContext(context, generation);
      if (!active || !published) return;
      await requestGuideQueueStatus();
      if (context && navigator.onLine) await registerGuideCheckInSync();
    };
    const onMessage = (event: MessageEvent) => {
      if (!active || event.data?.type !== "GUIDE_QUEUE_STATUS") return;
      const counts = event.data.counts || {};
      if ((Number(event.data.progressed) || 0) > 0) foregroundRetries.current = 0;
      setStatus({
        pending: Number(counts.pending) || 0,
        needsReauth: Number(counts.needsReauth) || 0,
        failed: Number(counts.failed) || 0,
        blocked: Number(counts.blocked) || 0,
      });
      setStatusRevision((revision) => revision + 1);
    };
    const onOnline = () => {
      foregroundRetries.current = 0;
      publishAuth().catch(() => {});
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    window.addEventListener("online", onOnline);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authGeneration = beginGuideQueueAuthGeneration();
      foregroundRetries.current = 0;
      const context = guideQueueAuthContext(session, businessId);
      postGuideQueueAuthContext(context, authGeneration).then((published) => {
        if (active && published && context && navigator.onLine) return registerGuideCheckInSync();
      }).catch(() => {});
    });
    navigator.serviceWorker.register("/guide/sw.js", { scope: "/guide/" })
      .then(() => publishAuth())
      .catch(() => {});

    return () => {
      active = false;
      subscription.unsubscribe();
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("online", onOnline);
    };
  }, [businessId]);

  useEffect(() => {
    if (status.pending === 0) {
      foregroundRetries.current = 0;
      return;
    }
    if (typeof navigator === "undefined" || !navigator.onLine || foregroundRetries.current >= 3) return;
    const delays = [1_000, 5_000, 15_000];
    const timer = window.setTimeout(() => {
      foregroundRetries.current += 1;
      registerGuideCheckInSync().catch(() => {});
    }, delays[foregroundRetries.current]);
    return () => window.clearTimeout(timer);
  }, [businessId, status.pending, statusRevision]);

  const total = status.pending + status.needsReauth + status.failed + status.blocked;
  if (total === 0) return null;
  const needsAttention = status.failed + status.blocked;
  const message = needsAttention > 0
    ? `${needsAttention} offline check-in${needsAttention === 1 ? " needs" : "s need"} attention. Reopen the trip with the original account.`
    : status.needsReauth > 0
      ? `${status.needsReauth} check-in${status.needsReauth === 1 ? " is" : "s are"} waiting. Sign in again to retry.`
      : `${status.pending} check-in${status.pending === 1 ? " is" : "s are"} waiting to sync.`;

  return (
    <div role={needsAttention > 0 ? "alert" : "status"} aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-md rounded-xl border px-4 py-3 text-sm font-semibold"
      style={{ background: "var(--ck-surface)", borderColor: needsAttention > 0 ? "var(--ck-danger)" : "var(--ck-warning)", color: "var(--ck-text-strong)", boxShadow: "var(--ck-shadow-lg)" }}>
      {message}
    </div>
  );
}
