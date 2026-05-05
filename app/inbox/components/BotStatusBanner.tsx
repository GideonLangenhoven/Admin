"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function BotStatusBanner() {
  const [bannerText, setBannerText] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("ck_bot_banner_dismissed")) {
      setDismissed(true);
      return;
    }
    (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/admin/whatsapp/bot-mode", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return;
      const data = await r.json();
      if (data.mode === "OFF") {
        setBannerText("WhatsApp bot is off — every message goes to this inbox.");
      } else if (data.mode === "OUTSIDE_HOURS" && !data.currentlyActive) {
        setBannerText("WhatsApp bot is paused during business hours.");
      }
    })();
  }, []);

  if (dismissed || !bannerText) return null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mb-3">
      <p className="text-xs font-medium text-amber-800">
        {bannerText}{" "}
        <a href="/settings" className="underline hover:text-amber-900">Change setting →</a>
      </p>
      <button
        onClick={() => { setDismissed(true); sessionStorage.setItem("ck_bot_banner_dismissed", "1"); }}
        className="text-amber-600 hover:text-amber-800 text-xs font-bold"
      >
        ✕
      </button>
    </div>
  );
}
