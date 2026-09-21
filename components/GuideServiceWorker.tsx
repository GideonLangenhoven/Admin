"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import type { GuideQueueStatus } from "@/app/lib/guide-offline";
import {
  acknowledgeGuideQueueIssue,
  currentGuideQueueAuthority,
  currentGuideQueueAuthGeneration,
  GUIDE_QUEUE_UPDATE_EVENT,
  guideQueueAuthContext,
  isCurrentGuideQueueAuthContext,
  postGuideQueueAuthContext,
  registerGuideCheckInSync,
  requestGuideQueueStatus,
  retryGuideQueueIssue,
  type GuideQueueUpdate,
} from "@/app/lib/guide-offline";
import { useBusinessContext } from "@/components/BusinessContext";

function isCurrentGuideQueueStatus(
  message: Record<string, unknown>,
  authority: ReturnType<typeof currentGuideQueueAuthority>,
  businessId: string,
) {
  return !!authority
    && message.type === "GUIDE_QUEUE_STATUS"
    && message.generation === authority.generation
    && message.authorityId === authority.authorityId
    && message.userId === authority.userId
    && message.businessId === authority.businessId
    && message.businessId === businessId;
}

export default function GuideServiceWorker() {
  const { businessId, readOnly } = useBusinessContext();
  const [status, setStatus] = useState<GuideQueueStatus>({
    pending: 0, needsReauth: 0, failed: 0, blocked: 0, exhausted: 0,
    autoRetriesRemaining: 0, nextAttemptAt: null, issues: [],
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let active = true;
    const publishAuth = async (knownSession?: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) => {
      const generation = currentGuideQueueAuthGeneration();
      const session = knownSession === undefined
        ? (await supabase.auth.getSession()).data.session
        : knownSession;
      if (!active) return;
      const context = guideQueueAuthContext(session, readOnly ? "" : businessId);
      if (context && !isCurrentGuideQueueAuthContext(context, generation)) return;
      if (!context && currentGuideQueueAuthority()) return;
      const published = await postGuideQueueAuthContext(context, generation, () => active);
      if (!active || !published) return;
      await requestGuideQueueStatus();
      if (context && navigator.onLine) await registerGuideCheckInSync();
    };
    const onMessage = (event: MessageEvent) => {
      if (!active || event.data?.type !== "GUIDE_QUEUE_STATUS") return;
      const authority = currentGuideQueueAuthority();
      if (!authority || !isCurrentGuideQueueStatus(event.data, authority, businessId)) return;
      const counts = event.data.counts || {};
      const issues: GuideQueueStatus["issues"] = Array.isArray(event.data.issues)
        ? event.data.issues.filter((issue: Record<string, unknown>) => issue.legacy === true
          || (issue.userId === authority.userId && issue.businessId === authority.businessId))
        : [];
      const updates = Array.isArray(event.data.updates) ? event.data.updates as GuideQueueUpdate[] : [];
      updates.forEach(update => {
        if (update.userId !== authority.userId || update.businessId !== authority.businessId) return;
        window.dispatchEvent(new CustomEvent(GUIDE_QUEUE_UPDATE_EVENT, { detail: update }));
      });
      setStatus({
        pending: Number(counts.pending) || 0,
        needsReauth: Number(counts.needsReauth) || 0,
        failed: Number(counts.failed) || 0,
        blocked: Number(counts.blocked) || 0,
        exhausted: Number(counts.exhausted) || 0,
        autoRetriesRemaining: event.data.autoRetriesRemaining === undefined
          ? Number(counts.pending) > 0 ? 1 : 0
          : Math.max(0, Number(event.data.autoRetriesRemaining) || 0),
        nextAttemptAt: Number(event.data.nextAttemptAt) || null,
        issues,
      });
    };
    const onOnline = () => {
      publishAuth().catch(() => {});
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "guide-queue-authority-v2") publishAuth().catch(() => {});
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    window.addEventListener("online", onOnline);
    window.addEventListener("storage", onStorage);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      publishAuth(session).catch(() => {});
    });
    navigator.serviceWorker.register("/guide/sw.js", { scope: "/guide/" })
      .then(() => publishAuth())
      .catch(() => {});

    return () => {
      active = false;
      subscription.unsubscribe();
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("storage", onStorage);
    };
  }, [businessId, readOnly]);

  useEffect(() => {
    if (status.pending === 0 || status.autoRetriesRemaining === 0) return;
    if (typeof navigator === "undefined" || !navigator.onLine) return;
    const dueDelay = status.nextAttemptAt ? Math.max(0, status.nextAttemptAt - Date.now()) : 0;
    const timer = window.setTimeout(() => {
      registerGuideCheckInSync().catch(() => {});
    }, Math.max(1_000, dueDelay));
    return () => window.clearTimeout(timer);
  }, [businessId, status.pending, status.autoRetriesRemaining, status.nextAttemptAt]);

  const total = status.pending + status.needsReauth + status.failed + status.blocked + status.exhausted;
  if (total === 0) return null;
  const needsAttention = status.failed + status.blocked + status.exhausted;
  const firstIssue = status.issues[0];
  const message = needsAttention > 0
    ? firstIssue?.retryable
      ? `${status.exhausted} offline check-in${status.exhausted === 1 ? " is" : "s are"} paused after repeated failures. Retry when the connection is stable.`
      : firstIssue?.reason === "STALE" || firstIssue?.reason === "STALE_SLOT"
      ? `${needsAttention} offline check-in conflict${needsAttention === 1 ? " needs" : "s need"} review. Check the current trip before retrying.`
      : firstIssue?.reason === "missing_owner"
        ? `${needsAttention} legacy offline check-in${needsAttention === 1 ? " cannot" : "s cannot"} be verified. Review the trip and check in again if needed.`
        : `${needsAttention} offline check-in${needsAttention === 1 ? " needs" : "s need"} attention. Review the trip and retry deliberately.`
    : status.needsReauth > 0
      ? `${status.needsReauth} check-in${status.needsReauth === 1 ? " is" : "s are"} waiting. Sign in again to retry.`
      : `${status.pending} check-in${status.pending === 1 ? " is" : "s are"} waiting to sync.`;
  const resolveIssue = async () => {
    const authority = currentGuideQueueAuthority();
    if (!authority || !firstIssue || firstIssue.legacy) return;
    if (firstIssue.retryable) await retryGuideQueueIssue(authority, firstIssue.id);
    else await acknowledgeGuideQueueIssue(authority, firstIssue.id);
  };

  return (
    <div role={needsAttention > 0 ? "alert" : "status"} aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-md rounded-xl border px-4 py-3 text-sm font-semibold"
      style={{ background: "var(--ck-surface)", borderColor: needsAttention > 0 ? "var(--ck-danger)" : "var(--ck-warning)", color: "var(--ck-text-strong)", boxShadow: "var(--ck-shadow-lg)" }}>
      <span>{message}</span>
      {needsAttention > 0 && firstIssue && !firstIssue.legacy && (
        <button type="button" onClick={resolveIssue}
          className="ml-3 underline underline-offset-2">
          {firstIssue.retryable ? "Retry check-in" : "Dismiss reviewed issue"}
        </button>
      )}
    </div>
  );
}
