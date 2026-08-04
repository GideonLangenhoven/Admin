import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  // A suspended tenant must still see their billing history to reactivate.
  const caller = await getCallerAdmin(req, { skipSubscriptionCheck: true });
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = adminClient();

  const { data: lineItems } = await db.from("billing_line_items")
    // Every column here was renamed out from under this route, so the select
    // errored and the endpoint always answered with an empty history.
    .select("id, period_key, kind, description, amount_zar, currency, status, source_type, source_id, created_at")
    .eq("business_id", caller.business_id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ line_items: lineItems ?? [] });
}
