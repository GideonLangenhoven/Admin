import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as managePartnership } from "../route";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function page(title: string, message: string, status = 200, token?: string) {
  const form = token ? `<form method="post" action="/api/partnerships/approve">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <label for="invite-email">Email address this invitation was sent to</label>
    <input id="invite-email" name="invite_email" type="email" autocomplete="email" required>
    <button type="submit">Accept partnership</button>
  </form>` : '<p><a href="/partnerships">Open Partners</a></p>';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | BookingTours</title>
    <style>body{font-family:system-ui,sans-serif;background:#f7f7f6;display:grid;place-items:center;min-height:100vh;margin:0;color:#1b3b36}.card{box-sizing:border-box;background:#fff;border:1px solid #dde1e6;border-radius:16px;padding:32px;width:calc(100% - 32px);max-width:480px}h1{font-size:24px;margin:0 0 16px}p{line-height:1.6}label{display:block;margin-top:24px;font-size:14px}input,button{box-sizing:border-box;width:100%;min-height:44px;font:inherit;border-radius:8px;margin-top:8px;padding:10px}input{border:1px solid #858d99}button{border:0;background:#1b3b36;color:#fff;cursor:pointer}a{color:inherit}:focus-visible{outline:2px solid #1b3b36;outline-offset:3px}</style>
    </head><body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${form}</main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" },
  });
}

// Email scanners may open this URL. Only an explicit form POST accepts it.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return page("Invalid link", "This invitation link is invalid or has expired.", 400);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
  const { data, error } = await db.from("business_partnerships")
    .select("business_a:businesses!business_partnerships_business_a_id_fkey(business_name,name),business_b:businesses!business_partnerships_business_b_id_fkey(business_name,name)")
    .eq("invite_token", token).eq("status", "PENDING").maybeSingle();
  if (error) return page("Could not load invitation", "Please try again shortly.", 503);
  if (!data) return page("Invalid link", "This invitation was already accepted, revoked, or has expired.", 404);
  const a = data.business_a as unknown as { business_name?: string; name?: string } | null;
  const b = data.business_b as unknown as { business_name?: string; name?: string } | null;
  return page("Confirm partnership", `Accept the partnership between ${a?.business_name || a?.name || "Business A"} and ${b?.business_name || b?.name || "Business B"}? This allows the operators to create joint combo offers.`, 200, token);
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return page("Invalid request", "Open your invitation link and try again.", 400); }
  const token = form.get("token"), email = form.get("invite_email");
  if (typeof token !== "string" || typeof email !== "string") return page("Invalid request", "Enter the email address that received the invitation.", 400);
  const result = await managePartnership(new NextRequest(new URL("/api/partnerships", req.url), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accept_token", token, invite_email: email }),
  }));
  if (!result.ok) {
    const data = await result.json();
    return page("Partnership not accepted", data.error || "Please try again.", result.status, /^[0-9a-f]{64}$/.test(token) ? token : undefined);
  }
  return page("Partnership accepted", "Your partnership is now active. You can create joint combo offers from Partners in your dashboard.");
}
