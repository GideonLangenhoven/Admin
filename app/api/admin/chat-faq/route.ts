import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

// Which business's FAQ list this request operates on. Only SUPER_ADMIN may
// name a business other than their own — that's how the operator switcher
// works everywhere else (weather-cancel, /settings via RLS). Without this,
// a roaming super-admin on atlas.admin silently read and edited their HOME
// tenant's entries while the Atlas bot answered from Atlas's (empty) list.
function resolveTargetBusiness(caller: { role: string; business_id: string }, requested: string | null | undefined): string | null {
  const target = String(requested || "").trim() || caller.business_id;
  if (target !== caller.business_id && caller.role !== "SUPER_ADMIN") return null;
  return target;
}

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const target = resolveTargetBusiness(caller, req.nextUrl.searchParams.get("business_id"));
  if (!target) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = adminClient();
  // `id` is the tiebreaker, not decoration: the seeded entries all share one
  // created_at (bulk insert), and with ties Postgres is free to return them in
  // any order. The list reshuffled on every reload, so saving an edit made the
  // entry you just changed jump somewhere else — it reads as "my edit didn't
  // stick" when it saved fine.
  const { data } = await db.from("chat_faq_entries")
    .select("*")
    .eq("business_id", target)
    .order("intent")
    .order("created_at", { ascending: false })
    .order("id");

  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  let body: { intent?: string; question_pattern?: string; match_keywords?: string[]; answer?: string; business_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const target = resolveTargetBusiness(caller, body.business_id);
  if (!target) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { intent, question_pattern, match_keywords, answer } = body;
  if (!intent || !question_pattern || !match_keywords?.length || !answer) {
    return NextResponse.json({ error: "intent, question_pattern, match_keywords, and answer are required" }, { status: 400 });
  }

  const db = adminClient();
  const { data, error } = await db.from("chat_faq_entries").insert({
    business_id: target,
    intent,
    question_pattern,
    match_keywords: match_keywords.map(k => k.toLowerCase().trim()),
    answer,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
