"use client";

import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export async function reauthenticateAdminPassword(email: string, password: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Admin authentication is not configured");

  // Password confirmation must not replace the shared browser session. That
  // session is coordinated with the selected tenant and offline guide queue by
  // AuthGate; this short-lived client exists only long enough to obtain a fresh
  // password-authenticated access token for the password-change request.
  const reauth = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await reauth.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error || !data.session) return null;
  return data.session.access_token;
}

export async function getAuthHeaders(businessId?: string): Promise<Record<string, string>> {
  // Capture the target before awaiting the session: switching operator while
  // auth refreshes must not redirect an in-flight action to the new operator.
  const target = businessId ?? (typeof window === "undefined" ? "" : localStorage.getItem("ck_admin_business_id") || "");
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers["Authorization"] = "Bearer " + session.access_token;
  if (target) headers["x-admin-business-id"] = target;
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
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateSecureToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
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
  const headers = action === "send" ? await getAuthHeaders(typeof body.business_id === "string" ? body.business_id : undefined) : { "Content-Type": "application/json" };
  const res = await fetch("/api/admin/setup-link", {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...body }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Setup-link request failed");
  return data;
}

export async function sendAdminSetupLink(
  admin: Pick<AdminAccountRow, "id" | "email" | "name">,
  reason = "ADMIN_INVITE",
  businessId?: string,
) {
  const data = await setupLinkApi("send", {
    admin_id: admin.id,
    reason,
    business_id: businessId || null,
  });
  return { expiresAt: data.expires_at as string };
}

export async function validateAdminSetupToken(email: string, token: string) {
  try {
    const data = await setupLinkApi("validate", {
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
  const data = await setupLinkApi("complete", {
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
