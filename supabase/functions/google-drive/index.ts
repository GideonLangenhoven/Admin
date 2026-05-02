import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!;
var GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
var GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
var SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";

var supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function getCors(req: any) {
  var origin = req?.headers?.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function ok(req: any, data: any) {
  return new Response(JSON.stringify(data), { status: 200, headers: getCors(req) });
}

function fail(req: any, msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: getCors(req) });
}

// ── Google OAuth helpers ──

function buildAuthUrl(businessId: string, redirectUri: string, returnTo?: string) {
  var params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file email",
    access_type: "offline",
    prompt: "consent",
    state: btoa(JSON.stringify({ business_id: businessId, return_to: returnTo })),
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

async function exchangeCode(code: string, redirectUri: string) {
  var res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  return await res.json();
}

async function refreshAccessToken(refreshToken: string) {
  var res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  return await res.json();
}

async function getUserEmail(accessToken: string) {
  var res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  var data = await res.json();
  return data.email || "";
}

// ── Google Drive helpers ──

async function createFolder(accessToken: string, name: string, parentId?: string) {
  var metadata: Record<string, any> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) metadata.parents = [parentId];

  var res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });
  return await res.json();
}

async function shareFolder(accessToken: string, folderId: string) {
  await fetch("https://www.googleapis.com/drive/v3/files/" + folderId + "/permissions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  return "https://drive.google.com/drive/folders/" + folderId;
}

async function getBusinessDrive(businessId: string) {
  if (!SETTINGS_ENCRYPTION_KEY || SETTINGS_ENCRYPTION_KEY.length < 32) {
    throw new Error("Missing or too-short SETTINGS_ENCRYPTION_KEY (must be 32+ chars)");
  }
  var { data, error } = await supabase.rpc("get_gdrive_credentials", {
    p_business_id: businessId,
    p_key: SETTINGS_ENCRYPTION_KEY,
  });
  if (error) throw new Error("Credential lookup failed: " + error.message);
  var row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    google_drive_refresh_token: row.refresh_token || null,
    google_drive_folder_id: row.folder_id || null,
    google_drive_email: row.email || null,
  };
}

// ── Main handler ──

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return fail(req, "Google Drive integration is not configured. Contact support.", 503);
    }

    var body = await req.json();
    var action = String(body.action || "");
    var businessId = String(body.business_id || "");

    if (!businessId) return fail(req, "business_id required");

    // ── Generate OAuth URL ──
    if (action === "auth_url") {
      var redirectUri = String(body.redirect_uri || "");
      if (!redirectUri) return fail(req, "redirect_uri required");
      var returnTo = String(body.return_to || "/settings");
      return ok(req, { url: buildAuthUrl(businessId, redirectUri, returnTo) });
    }

    // ── Exchange auth code for tokens ──
    if (action === "exchange") {
      var code = String(body.code || "");
      var redirectUri = String(body.redirect_uri || "");
      if (!code) return fail(req, "code required");
      if (!redirectUri) return fail(req, "redirect_uri required");

      if (!SETTINGS_ENCRYPTION_KEY || SETTINGS_ENCRYPTION_KEY.length < 32) {
        return fail(req, "Encryption key not configured. Contact support.", 503);
      }

      var tokens = await exchangeCode(code, redirectUri);
      if (tokens.error) {
        console.error("GOOGLE_TOKEN_ERR:", tokens);
        return fail(req, "Google auth failed: " + (tokens.error_description || tokens.error));
      }

      var email = await getUserEmail(tokens.access_token);

      var rootFolder = await createFolder(tokens.access_token, "Trip Photos");
      if (rootFolder.error) {
        console.error("GOOGLE_FOLDER_ERR:", rootFolder);
        return fail(req, "Failed to create Drive folder: " + (rootFolder.error.message || rootFolder.error));
      }

      var { error: dbErr } = await supabase.rpc("set_gdrive_credentials", {
        p_business_id: businessId,
        p_key: SETTINGS_ENCRYPTION_KEY,
        p_refresh_token: tokens.refresh_token,
        p_folder_id: rootFolder.id,
        p_email: email,
      });

      if (dbErr) {
        console.error("GOOGLE_DB_ERR:", dbErr);
        return fail(req, "Failed to save credentials: " + dbErr.message, 500);
      }

      return ok(req, { success: true, email, folder_id: rootFolder.id });
    }

    // ── Get fresh access token (for client-side uploads) ──
    if (action === "token") {
      var biz = await getBusinessDrive(businessId);
      if (!biz?.google_drive_refresh_token) return fail(req, "Google Drive not connected", 401);

      var tokenRes = await refreshAccessToken(biz.google_drive_refresh_token);
      if (tokenRes.error) {
        console.error("GOOGLE_REFRESH_ERR:", tokenRes);
        return fail(req, "Session expired. Please reconnect Google Drive in Settings.", 401);
      }

      return ok(req, {
        access_token: tokenRes.access_token,
        folder_id: biz.google_drive_folder_id,
      });
    }

    // ── Create trip subfolder + share it ──
    if (action === "create_folder") {
      var folderName = String(body.folder_name || "");
      if (!folderName) return fail(req, "folder_name required");

      var biz = await getBusinessDrive(businessId);
      if (!biz?.google_drive_refresh_token) return fail(req, "Google Drive not connected", 401);

      var tokenRes = await refreshAccessToken(biz.google_drive_refresh_token);
      if (tokenRes.error) return fail(req, "Session expired. Reconnect Google Drive.", 401);

      var folder = await createFolder(tokenRes.access_token, folderName, biz.google_drive_folder_id);
      if (folder.error) return fail(req, "Failed to create folder: " + (folder.error.message || folder.error));

      var shareUrl = await shareFolder(tokenRes.access_token, folder.id);

      return ok(req, { folder_id: folder.id, folder_url: shareUrl });
    }

    // ── Check connection status (no decrypt needed — just check bytea IS NOT NULL) ──
    if (action === "status") {
      var { data: statusData } = await supabase
        .from("businesses")
        .select("google_drive_refresh_token_encrypted, google_drive_folder_id, google_drive_email")
        .eq("id", businessId)
        .maybeSingle();
      return ok(req, {
        connected: statusData?.google_drive_refresh_token_encrypted != null,
        email: statusData?.google_drive_email || null,
        folder_id: statusData?.google_drive_folder_id || null,
      });
    }

    // ── Disconnect ──
    if (action === "disconnect") {
      var biz = await getBusinessDrive(businessId);
      if (biz?.google_drive_refresh_token) {
        try {
          await fetch("https://oauth2.googleapis.com/revoke?token=" + biz.google_drive_refresh_token, { method: "POST" });
        } catch (_) { /* best effort */ }
      }

      await supabase.from("businesses").update({
        google_drive_refresh_token_encrypted: null,
        google_drive_folder_id: null,
        google_drive_email: null,
      }).eq("id", businessId);

      return ok(req, { success: true });
    }

    return fail(req, "Unknown action. Use: auth_url, exchange, token, create_folder, status, disconnect");
  } catch (err: any) {
    console.error("GOOGLE_DRIVE_ERR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: getCors(req),
    });
  }
});
