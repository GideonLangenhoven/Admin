import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { setAdminAuthPassword } from "../../../lib/admin-password";

// Legacy SHA-256 hash check — matches what the browser admin-auth.ts produces.
// Used only to verify pre-migration passwords; new passwords are stored by Supabase Auth (bcrypt internally).
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function invalidCredentials() {
  return NextResponse.json({ error: "Invalid credentials", code: "AUTH_REQUIRED" }, { status: 401 });
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey || serviceKey.length < 40 || serviceKey.includes("your-")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured on the server");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token && (!email || !password)) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

  let admin;
  try {
    admin = adminClient();
  } catch (e: any) {
    console.error("ADMIN_LOGIN_CONFIG_ERR", e?.message);
    return NextResponse.json(
      { error: e?.message || "Server misconfigured" },
      { status: 500 },
    );
  }

  let authUserId = "";
  if (token) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return invalidCredentials();
    authUserId = data.user.id;
  }

  // Linked accounts are resolved from the verified Auth identity. Email and a
  // duplicate password digest are used only for one-time legacy migration.
  let lookup = admin.from("admin_users").select(
    "id, email, name, role, business_id, password_hash, user_id, must_set_password, suspended, settings_permissions, read_only",
  );
  lookup = token ? lookup.eq("user_id", authUserId) : lookup.eq("email", email);
  const { data: user, error: lookupErr } = await lookup.maybeSingle();

  if (lookupErr) {
    console.error("ADMIN_LOGIN_LOOKUP_ERR", lookupErr.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!user || (!token && (user.user_id || !user.password_hash || user.password_hash !== sha256(password)))) {
    return invalidCredentials();
  }
  if (user.suspended) {
    return NextResponse.json(
      { error: "Account is suspended. Contact support." },
      { status: 403 },
    );
  }
  if (user.must_set_password) {
    return NextResponse.json(
      {
        error: "Password setup required",
        code: "MUST_SET_PASSWORD",
        admin_id: user.id,
        name: user.name,
        business_id: user.business_id,
      },
      { status: 403 },
    );
  }

  if (!token) {
    try {
      authUserId = await setAdminAuthPassword(admin, user, password);
    } catch (error) {
      console.error(
        "ADMIN_LOGIN_AUTH_CREATE_ERR",
        error instanceof Error ? error.message : "Auth provisioning failed",
      );
      return NextResponse.json(
        { error: "Could not prepare sign-in. Please try again." },
        { status: 502 },
      );
    }

    const { error: linkErr } = await admin
      .from("admin_users")
      .update({ user_id: authUserId, password_hash: null })
      .eq("id", user.id);
    if (linkErr) {
      console.error("ADMIN_LOGIN_LINK_ERR", linkErr.message);
      return NextResponse.json({ error: "Could not finish sign-in migration. Please try again." }, { status: 502 });
    }
  }

  if (user.read_only) {
    const { error: refreshError } = await admin.rpc(
      "refresh_claires_hiking_demo_dates",
      { p_business_id: user.business_id },
    );
    if (refreshError) {
      console.error("DEMO_DATE_REFRESH_ERR", refreshError.message);
    }
  }

  return NextResponse.json({
    auth_ready: true,
    admin: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      business_id: user.business_id,
      settings_permissions: user.settings_permissions,
      read_only: user.read_only === true,
    },
  });
}
