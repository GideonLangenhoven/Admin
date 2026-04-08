"use client";

import { supabase } from "./supabase";

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

export async function sendAdminSetupLink(
  admin: Pick<AdminAccountRow, "id" | "email" | "name">,
  reason = "ADMIN_INVITE",
  businessId?: string,
) {
  var rawToken = generateSecureToken(24);
  var tokenHash = await sha256(rawToken);
  var now = new Date();
  var expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  var shouldForceSetup = reason !== "RESET";
  var updatePayload: Record<string, string | boolean | null> = {
    setup_token_hash: tokenHash,
    setup_token_expires_at: expiresAt,
    invite_sent_at: now.toISOString(),
  };
  if (shouldForceSetup) updatePayload.must_set_password = true;

  var { error: updateError } = await supabase
    .from("admin_users")
    .update(updatePayload)
    .eq("id", admin.id);

  if (updateError) throw updateError;

  var { error: emailError } = await supabase.functions.invoke("send-email", {
    body: {
      type: "ADMIN_WELCOME",
      data: {
        email: admin.email,
        name: admin.name || "",
        change_password_url: setupUrl(admin.email, rawToken),
        expires_at: expiresAt,
        reason,
        ...(businessId ? { business_id: businessId } : {}),
      },
    },
  });

  if (emailError) {
    // Try to extract the human-readable reason from the edge-function response body.
    // FunctionsHttpError carries a `context` property that is the raw Response object.
    var humanMsg = "";
    try {
      var ctx: any = (emailError as any).context;
      if (ctx && typeof ctx.json === "function") {
        var body = await ctx.json();
        humanMsg =
          body?.providerResponse?.sandboxNote ||
          body?.error ||
          "";
      }
    } catch (_) {
      // ignore JSON parse failures
    }
    throw new Error(humanMsg || emailError.message);
  }

  return { expiresAt };
}

export async function validateAdminSetupToken(email: string, token: string) {
  var tokenHash = await sha256(token);
  var { data, error } = await supabase
    .from("admin_users")
    .select("id, email, name, setup_token_expires_at")
    .eq("email", email.trim().toLowerCase())
    .eq("setup_token_hash", tokenHash)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (!data.setup_token_expires_at || new Date(data.setup_token_expires_at).getTime() < Date.now()) return null;
  return data as Pick<AdminAccountRow, "id" | "email" | "name">;
}

export async function completeAdminPasswordSetup(email: string, token: string, newPassword: string) {
  var admin = await validateAdminSetupToken(email, token);

  if (!admin) {
    // Token may have already been consumed by a prior submit — check if password was recently set
    var { data: recentlySet } = await supabase
      .from("admin_users")
      .select("id, email, name, password_set_at")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (recentlySet?.password_set_at) {
      var setAgo = Date.now() - new Date(recentlySet.password_set_at).getTime();
      if (setAgo < 5 * 60 * 1000) {
        // Password was set within the last 5 minutes — treat as success (likely double-submit)
        return recentlySet as Pick<AdminAccountRow, "id" | "email" | "name">;
      }
    }
    throw new Error("This password setup link is invalid or has expired.");
  }

  var passwordHash = await sha256(newPassword);
  var { error } = await supabase
    .from("admin_users")
    .update({
      password_hash: passwordHash,
      password_set_at: new Date().toISOString(),
      must_set_password: false,
      setup_token_hash: null,
      setup_token_expires_at: null,
    })
    .eq("id", admin.id);

  if (error) throw error;
  return admin;
}
