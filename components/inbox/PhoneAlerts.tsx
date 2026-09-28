"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getAuthHeaders } from "@/app/lib/admin-auth";
import { useBusinessContext } from "@/components/BusinessContext";

type Status = "checking" | "off" | "on" | "denied" | "unsupported";
const noChanges = () => () => {};

function applicationServerKey(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(bytes, (char) => char.charCodeAt(0));
}

export default function PhoneAlerts() {
  const { businessId, readOnly } = useBusinessContext();
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (readOnly) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    let active = true;
    (async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!active) return;
      setStatus(Notification.permission === "denied" ? "denied" : subscription ? "on" : "off");
      if (subscription && businessId && Notification.permission === "granted") {
        const headers = await getAuthHeaders(businessId);
        if (headers.Authorization) {
          const response = await fetch("/api/admin/web-push", {
            method: "POST", headers, body: JSON.stringify(subscription.toJSON()),
          });
          if (!response.ok) throw new Error("Could not restore phone alerts");
        }
      }
    })().catch(() => { if (active) { setStatus("off"); setError("Could not restore phone alerts. Please enable them again."); } });
    return () => { active = false; };
  }, [businessId, readOnly]);

  async function enable() {
    setBusy(true);
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(permission === "denied" ? "denied" : "off"); return; }
      const headers = await getAuthHeaders(businessId);
      const response = await fetch("/api/admin/web-push", { headers });
      if (!response.ok) throw new Error("Could not load phone alert settings");
      const { publicKey } = await response.json();
      if (!publicKey) throw new Error("Phone alerts are not configured yet");
      const registration = await navigator.serviceWorker.register("/admin-sw.js", { scope: "/" });
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey),
      });
      const save = await fetch("/api/admin/web-push", {
        method: "POST", headers, body: JSON.stringify(subscription.toJSON()),
      });
      if (!save.ok) throw new Error("Could not save phone alerts");
      setStatus("on");
    } catch (e) { setError((e as Error).message || "Could not enable phone alerts"); }
    finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/admin/web-push", {
          method: "DELETE", headers: await getAuthHeaders(businessId),
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error("Could not turn off phone alerts");
        await subscription.unsubscribe();
      }
      setStatus("off");
    } catch (e) { setError((e as Error).message || "Could not turn off phone alerts"); }
    finally { setBusy(false); }
  }

  const needsHomeScreen = useSyncExternalStore(noChanges,
    () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches,
    () => false);
  if (readOnly) return null;
  return (
    <div className="ui-card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>Phone alerts for web chat</p>
        <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
          {status === "on" ? "On for this phone. Alerts open the guest conversation here." :
            status === "denied" ? "Notifications are blocked. Allow them in your phone settings." :
            needsHomeScreen ? "Add BookingTours to your Home Screen, open it there, then enable alerts." :
            status === "unsupported" ? "This browser does not support phone alerts." :
            "Get a phone notification when a guest needs a human reply."}
        </p>
        {error && <p role="alert" className="mt-1 text-xs text-[var(--ck-danger)]">{error}</p>}
      </div>
      {status === "on" ? <button type="button" className="ui-btn ui-btn-soft !h-9 text-xs" disabled={busy} onClick={disable}>Turn off</button> :
        status !== "denied" && status !== "unsupported" && !needsHomeScreen &&
        <button type="button" className="ui-btn ui-btn-primary !h-9 text-xs" disabled={busy || status === "checking"} onClick={enable}>Enable alerts</button>}
    </div>
  );
}
