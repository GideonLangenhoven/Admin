import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { setAdminAuthPassword } from "@/app/lib/admin-password";
import { guideAuthEmail } from "@/app/lib/guide-access";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
function dbClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) return reply({ error: "Operator owner access required" }, 403);
  const { data, error } = await dbClient().from("guide_accounts")
    .select("id, login_name, suspended, password_set_at, must_set_password").eq("business_id", caller.business_id).maybeSingle();
  return error ? reply({ error: "Guide access could not be loaded" }, 503) : reply({ guide: data });
}

export async function POST(req: NextRequest) {
  let body;
  try { body = await req.json(); } catch { return reply({ error: "Invalid request" }, 400); }
  const db = dbClient();
  if (body.action === "issue" || body.action === "suspend") {
    const caller = await getCallerAdmin(req);
    if (!caller || !isPrivilegedRole(caller.role)) return reply({ error: "Operator owner access required" }, 403);
    if (body.action === "suspend") {
      if (typeof body.suspended !== "boolean") return reply({ error: "Choose an access status" }, 400);
      const { error } = await db.from("guide_accounts").update({ suspended: body.suspended }).eq("business_id", caller.business_id);
      return error ? reply({ error: "Guide access could not be updated" }, 503) : reply({ ok: true });
    }
    const { data: business, error: lookupError } = await db.from("businesses").select("subdomain").eq("id", caller.business_id).maybeSingle();
    const { data: existing, error: guideError } = await db.from("guide_accounts").select("login_name")
      .eq("business_id", caller.business_id).maybeSingle();
    if (guideError) return reply({ error: "Guide access could not be loaded" }, 503);
    const login = existing?.login_name || (business?.subdomain ? `guide@${business.subdomain}` : "");
    const email = guideAuthEmail(login);
    if (lookupError || !email) return reply({ error: "Set an operator subdomain before creating guide access" }, 400);
    const { data: office, error: officeError } = await db.from("admin_users").select("id").eq("email", email).maybeSingle();
    if (officeError || office) return reply({ error: "This guide identity is already linked to an office account. Contact support." }, 409);
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { data: guide, error } = await db.from("guide_accounts").upsert({
      business_id: caller.business_id, login_name: login, email, must_set_password: true,
      setup_token_hash: digest(token), setup_token_expires_at: expiresAt, setup_claim_id: null,
    }, { onConflict: "business_id" }).select("id, login_name, suspended, password_set_at, must_set_password").single();
    if (error) return reply({ error: "Guide setup link could not be created" }, 503);
    const url = new URL("/guide-setup", req.nextUrl.origin);
    url.searchParams.set("login", login); url.searchParams.set("token", token);
    return reply({ guide, setup_url: url.toString(), expires_at: expiresAt });
  }

  const email = guideAuthEmail(String(body.login || ""));
  const token = String(body.token || "");
  if (!email || !/^[a-f0-9]{48}$/.test(token)) return reply({ error: "Invalid or expired guide setup link" }, 401);
  if (body.action === "validate") {
    const { data, error } = await db.from("guide_accounts").select("login_name")
      .eq("email", email).eq("setup_token_hash", digest(token)).eq("suspended", false)
      .gt("setup_token_expires_at", new Date().toISOString()).maybeSingle();
    return error || !data ? reply({ error: "Invalid or expired guide setup link" }, 401) : reply({ login: data.login_name });
  }
  if (body.action !== "complete") return reply({ error: "Unknown action" }, 400);
  const password = String(body.password || "");
  if (password.length < 8 || password.length > 128) return reply({ error: "Choose a password of 8 to 128 characters" }, 400);
  const claimId = randomUUID();
  const { data: guide, error } = await db.rpc("claim_guide_setup", { p_email: email, p_token_hash: digest(token), p_claim_id: claimId });
  if (error) return reply({ error: "Guide setup is temporarily unavailable" }, 503);
  if (!guide) return reply({ error: "This setup link is expired, already used or being completed" }, 409);
  try {
    const userId = await setAdminAuthPassword(db, guide, password);
    const completed = await db.rpc("complete_guide_setup", { p_id: guide.id, p_claim_id: claimId, p_user_id: userId });
    if (completed.error || completed.data !== true) throw new Error("Setup could not be finalized. Ask your operator for a new link.");
    return reply({ ok: true, email, login: String(body.login).toLowerCase() });
  } catch {
    await db.from("guide_accounts").update({ setup_claim_id: null }).eq("id", guide.id).eq("setup_claim_id", claimId);
    return reply({ error: "Password setup could not finish. Try again, or ask your operator for a fresh setup link." }, 502);
  }
}
