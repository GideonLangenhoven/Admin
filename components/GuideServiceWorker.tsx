"use client";

import { useEffect } from "react";

export default function GuideServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/guide/sw.js", { scope: "/guide/" }).catch(() => {});
  }, []);
  return null;
}
