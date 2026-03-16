"use client";

export function getAdminTimezone() {
  if (typeof window === "undefined") return "UTC";
  return localStorage.getItem("ck_admin_timezone") || "UTC";
}
