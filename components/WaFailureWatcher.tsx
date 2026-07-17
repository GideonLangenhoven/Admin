"use client";

// Item 21: replaces the standalone Notifications tab. Instead of an operator
// having to open a page to discover a failed WhatsApp send, this quietly polls
// for new failures and pops an in-the-moment toast the instant one happens.
// Pairs with the guaranteed email fallback in the send paths — the toast tells
// the operator WA failed; the fallback ensures the customer was still reached.
import { useEffect, useRef } from "react";
import { getAuthHeaders } from "../app/lib/admin-auth";
import { notify } from "../app/lib/app-notify";
import { useBusinessContext } from "./BusinessContext";

const POLL_MS = 45_000;

type WaFailure = { id: string; to_phone: string; kind: string; error: string | null; created_at: string };

export default function WaFailureWatcher() {
  const { businessId } = useBusinessContext();
  const seen = useRef<Set<string>>(new Set());
  const since = useRef<string>(new Date().toISOString());
  const primed = useRef(false);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;

    async function poll() {
      try {
        const headers = await getAuthHeaders();
        if (!headers.Authorization) return; // not signed in yet
        const res = await fetch("/api/admin/wa-failures?since=" + encodeURIComponent(since.current), { headers });
        if (!res.ok) return;
        const data = await res.json();
        const failures: WaFailure[] = data.failures || [];
        if (data.now) since.current = data.now;

        // First successful poll only primes the "seen" set — we don't want to
        // blast toasts for failures that happened before the operator opened
        // the dashboard. From then on, only genuinely new failures alert.
        if (!primed.current) {
          failures.forEach((f) => seen.current.add(f.id));
          primed.current = true;
          return;
        }

        for (const f of failures) {
          if (seen.current.has(f.id)) continue;
          seen.current.add(f.id);
          if (cancelled) return;
          // 131047/131026 = outside the 24h window. wa-webhook auto-recovers
          // these: it sends the pre-approved reopener template and queues the
          // original message to deliver the moment the customer replies — so
          // tell the operator that, not that delivery failed outright.
          const windowClosed = /131047|131026/.test(f.error || "");
          notify(windowClosed ? {
            title: "WhatsApp queued (outside 24h window)",
            message: "The customer at " + (f.to_phone || "this number") + " hasn't messaged recently, so WhatsApp blocks direct texts. We sent them a pre-approved \"please reply\" message; your full message delivers automatically as soon as they respond.",
            tone: "info",
            duration: 9000,
          } : {
            title: "WhatsApp couldn't be delivered",
            message: "A WhatsApp message to " + (f.to_phone || "a customer") + " failed"
              + (f.error ? " (" + f.error.slice(0, 80) + ")" : "")
              + ". We've automatically sent the email version where possible.",
            tone: "warning",
            duration: 9000,
          });
        }
      } catch { /* transient — next tick retries */ }
    }

    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [businessId]);

  return null;
}
