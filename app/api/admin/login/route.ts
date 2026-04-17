import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

// Legacy SHA-256 hash check — matches what the browser admin-auth.ts produces.
// Used only to verify pre-migration passwords; new passwords are stored by Supabase Auth (bcrypt internally).
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
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
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  let admin;
  try {
    admin = adminClient();
  } catch (e: any) {
    console.error("ADMIN_LOGIN_CONFIG_ERR", e?.message);
    return NextResponse.json({ error: e?.message || "Server misconfigured" }, { status: 500 });
  }

  // 1. Look up admin row in admin_users (service role bypasses RLS)
  const { data: user, error: lookupErr } = await admin
    .from("admin_users")
    .select(
      "id, email, name, role, business_id, password_hash, user_id, must_set_password, suspended, settings_permissions",
    )
    .eq("email", email)
    .maybeSingle();

  if (lookupErr) {
    console.error("ADMIN_LOGIN_LOOKUP_ERR", lookupErr.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (user.suspended) {
    return NextResponse.json({ error: "Account is suspended. Contact support." }, { status: 403 });
  }
  if (user.must_set_password || !user.password_hash) {
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

  // 2. Verify password against legacy SHA-256 hash.
  // After this passes, we lazy-migrate the user into Supabase Auth (which uses bcrypt internally).
  const incomingHash = sha256(password);
  if (user.password_hash !== incomingHash) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // 3. Ensure admin has matching auth.users entry; create + link if not.
  let authUserId: string | null = user.user_id;
  if (!authUserId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { admin_id: user.id, business_id: user.business_id, role: user.role },
    });

    if (createErr) {
      // Possibly already exists in auth.users from a prior partial migration — find and update.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);
      if (existing) {
        await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
        authUserId = existing.id;
      } else {
        console.error("ADMIN_LOGIN_AUTH_CREATE_ERR", createErr.message);
        return NextResponse.json(
          { error: "Auth provisioning failed: " + createErr.message },
          { status: 500 },
        );
      }
    } else {
      authUserId = created.user.id;
    }

    const { error: linkErr } = await admin
      .from("admin_users")
      .update({ user_id: authUserId })
      .eq("id", user.id);
    if (linkErr) {
      console.error("ADMIN_LOGIN_LINK_ERR", linkErr.message);
      // Non-fatal — auth.users exists, we'll keep going. Future logins will retry.
    }
  }

  // 4. Sign in via Supabase Auth (anon-key client) to mint a session.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signin, error: signinErr } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signinErr || !signin?.session) {
    console.error("ADMIN_LOGIN_SIGNIN_ERR", signinErr?.message);
    return NextResponse.json(
      { error: "Sign-in failed" + (signinErr ? ": " + signinErr.message : "") },
      { status: 500 },
    );
  }

  return NextResponse.json({
    session: {
      access_token: signin.session.access_token,
      refresh_token: signin.session.refresh_token,
      expires_at: signin.session.expires_at,
    },
    admin: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      business_id: user.business_id,
      settings_permissions: user.settings_permissions,
    },
  });
}
