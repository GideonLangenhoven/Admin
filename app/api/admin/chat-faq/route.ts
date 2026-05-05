import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = adminClient();
  const { data } = await db.from("chat_faq_entries")
    .select("*")
    .eq("business_id", caller.business_id)
    .order("intent")
    .order("created_at", { ascending: false });

  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  let body: { intent?: string; question_pattern?: string; match_keywords?: string[]; answer?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { intent, question_pattern, match_keywords, answer } = body;
  if (!intent || !question_pattern || !match_keywords?.length || !answer) {
    return NextResponse.json({ error: "intent, question_pattern, match_keywords, and answer are required" }, { status: 400 });
  }

  const db = adminClient();
  const { data, error } = await db.from("chat_faq_entries").insert({
    business_id: caller.business_id,
    intent,
    question_pattern,
    match_keywords: match_keywords.map(k => k.toLowerCase().trim()),
    answer,
  }).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
