import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function hexToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey || serviceKey.length < 40 || serviceKey.includes("your-")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action || "");
  if (!["send", "validate", "complete"].includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  let admin;
  try {
    admin = adminClient();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server misconfigured" }, { status: 500 });
  }

  // -------- send: generate token, store hash, email setup link --------
  if (action === "send") {
    const adminId = body.admin_id ? String(body.admin_id) : "";
    const adminEmail = body.email ? String(body.email).trim().toLowerCase() : "";
    const reason = String(body.reason || "ADMIN_INVITE");
    const businessId = body.business_id ? String(body.business_id) : null;
    if (!adminId && !adminEmail) return NextResponse.json({ error: "admin_id or email is required" }, { status: 400 });

    let lookupQuery = admin.from("admin_users").select("id, email, name");
    if (adminId) {
      lookupQuery = lookupQuery.eq("id", adminId);
    } else {
      lookupQuery = lookupQuery.eq("email", adminEmail);
    }
    const { data: user, error: lookupErr } = await lookupQuery.maybeSingle();
    if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    if (!user) return NextResponse.json({ error: "Admin not found" }, { status: 404 });

    const rawToken = hexToken(24);
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const shouldForceSetup = reason !== "RESET";

    const updatePayload: Record<string, any> = {
      setup_token_hash: tokenHash,
      setup_token_expires_at: expiresAt,
      invite_sent_at: new Date().toISOString(),
    };
    if (shouldForceSetup) updatePayload.must_set_password = true;

    const { error: updErr } = await admin.from("admin_users").update(updatePayload).eq("id", adminId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    const origin = req.nextUrl.origin || req.headers.get("origin") || "";
    const setupUrl =
      origin +
      "/change-password?mode=setup&email=" +
      encodeURIComponent(user.email as string) +
      "&token=" +
      encodeURIComponent(rawToken);

    const { error: emailErr } = await admin.functions.invoke("send-email", {
      body: {
        type: "ADMIN_WELCOME",
        data: {
          email: user.email,
          name: (user as any).name || "",
          change_password_url: setupUrl,
          expires_at: expiresAt,
          reason,
          ...(businessId ? { business_id: businessId } : {}),
        },
      },
    });
    if (emailErr) {
      let humanMsg = "";
      try {
        const ctx: any = (emailErr as any).context;
        if (ctx && typeof ctx.json === "function") {
          const eb = await ctx.json();
          humanMsg = eb?.providerResponse?.sandboxNote || eb?.error || "";
        }
      } catch {
        /* swallow */
      }
      return NextResponse.json({ error: humanMsg || (emailErr as any).message || "Email failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, expires_at: expiresAt });
  }

  // -------- validate: confirm a setup token is current --------
  if (action === "validate") {
    const email = String(body.email || "").trim().toLowerCase();
    const token = String(body.token || "");
    if (!email || !token) return NextResponse.json({ error: "Email and token are required" }, { status: 400 });

    const tokenHash = sha256(token);
    const { data: user } = await admin
      .from("admin_users")
      .select("id, email, name, setup_token_expires_at")
      .eq("email", email)
      .eq("setup_token_hash", tokenHash)
      .maybeSingle();

    if (!user) return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
    if (
      !(user as any).setup_token_expires_at ||
      new Date((user as any).setup_token_expires_at).getTime() < Date.now()
    ) {
      return NextResponse.json({ error: "Link has expired" }, { status: 401 });
    }
    return NextResponse.json({
      id: (user as any).id,
      email: (user as any).email,
      name: (user as any).name,
      expires_at: (user as any).setup_token_expires_at,
    });
  }

  // -------- complete: validate token, set password, sync to auth.users --------
  if (action === "complete") {
    const email = String(body.email || "").trim().toLowerCase();
    const token = String(body.token || "");
    const newPassword = String(body.password || "");
    if (!email || !token || !newPassword)
      return NextResponse.json({ error: "Email, token, and password are required" }, { status: 400 });
    if (newPassword.length < 8)
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

    const tokenHash = sha256(token);

    let user: any;
    {
      const { data } = await admin
        .from("admin_users")
        .select("id, email, name, setup_token_expires_at, password_set_at, user_id")
        .eq("email", email)
        .eq("setup_token_hash", tokenHash)
        .maybeSingle();
      user = data || null;
    }

    if (!user) {
      // Idempotency: if password was set within the last 5 minutes, treat as success
      const { data: recent } = await admin
        .from("admin_users")
        .select("id, email, name, password_set_at")
        .eq("email", email)
        .maybeSingle();
      if ((recent as any)?.password_set_at) {
        const setAgo = Date.now() - new Date((recent as any).password_set_at).getTime();
        if (setAgo < 5 * 60 * 1000) {
          return NextResponse.json({
            ok: true,
            idempotent: true,
            id: (recent as any).id,
            email: (recent as any).email,
            name: (recent as any).name,
          });
        }
      }
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
    }

    if (
      !(user as any).setup_token_expires_at ||
      new Date((user as any).setup_token_expires_at).getTime() < Date.now()
    ) {
      return NextResponse.json({ error: "Link has expired" }, { status: 401 });
    }

    const newHash = sha256(newPassword);

    const { error: updErr } = await admin
      .from("admin_users")
      .update({
        password_hash: newHash,
        password_set_at: new Date().toISOString(),
        must_set_password: false,
        setup_token_hash: null,
        setup_token_expires_at: null,
      })
      .eq("id", user.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Sync password to auth.users so future supabase.auth.signInWithPassword works.
    let authUserId: string | null = user.user_id;
    if (!authUserId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: newPassword,
        email_confirm: true,
        user_metadata: { admin_id: user.id },
      });
      if (createErr) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existing = list?.users?.find((u: any) => u.email?.toLowerCase() === email);
        if (existing) {
          await admin.auth.admin.updateUserById(existing.id, { password: newPassword, email_confirm: true });
          authUserId = existing.id;
        } else {
          console.error("SETUP_AUTH_CREATE_ERR", createErr.message);
        }
      } else {
        authUserId = created.user.id;
      }
      if (authUserId) {
        await admin.from("admin_users").update({ user_id: authUserId }).eq("id", user.id);
      }
    } else {
      await admin.auth.admin.updateUserById(authUserId, { password: newPassword, email_confirm: true });
    }

    return NextResponse.json({ ok: true, id: user.id, email: user.email, name: user.name });
  }

  return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
}
