"use client";

import { supabase } from "./supabase";

export async function getAuthHeaders(): Promise<Record<string, string>> {
  var { data: { session } } = await supabase.auth.getSession();
  var headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers["Authorization"] = "Bearer " + session.access_token;
  return headers;
}

export interface AdminAccountRow {
  id: string;
  email: string;
  name?: string | null;
  role?: string | null;
  business_id?: string | null;
  password_hash?: string | null;
  must_set_password?: boolean | null;
  password_set_at?: string | null;
  setup_token_hash?: string | null;
  setup_token_expires_at?: string | null;
  invite_sent_at?: string | null;
}

export async function sha256(str: string) {
  var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateSecureToken(bytes = 24) {
  var arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function setupUrl(email: string, token: string) {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/change-password?mode=setup&email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

// All three functions below now go through /api/admin/setup-link (server-side, service-role).
// Direct anon-key access to admin_users is closed once the permissive RLS fallback is dropped.

async function setupLinkApi(action: "send" | "validate" | "complete", body: Record<string, any>) {
  var headers = action === "send" ? await getAuthHeaders() : { "Content-Type": "application/json" };
  var res = await fetch("/api/admin/setup-link", {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...body }),
  });
  var data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Setup-link request failed");
  return data;
}

export async function sendAdminSetupLink(
  admin: Pick<AdminAccountRow, "id" | "email" | "name">,
  reason = "ADMIN_INVITE",
  businessId?: string,
) {
  var data = await setupLinkApi("send", {
    admin_id: admin.id,
    reason,
    business_id: businessId || null,
  });
  return { expiresAt: data.expires_at as string };
}

export async function validateAdminSetupToken(email: string, token: string) {
  try {
    var data = await setupLinkApi("validate", {
      email: email.trim().toLowerCase(),
      token,
    });
    return {
      id: data.id,
      email: data.email,
      name: data.name,
    } as Pick<AdminAccountRow, "id" | "email" | "name">;
  } catch {
    return null;
  }
}

export async function completeAdminPasswordSetup(email: string, token: string, newPassword: string) {
  var data = await setupLinkApi("complete", {
    email: email.trim().toLowerCase(),
    token,
    password: newPassword,
  });
  return {
    id: data.id,
    email: data.email,
    name: data.name,
  } as Pick<AdminAccountRow, "id" | "email" | "name">;
}
