import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
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

  const { data: lineItems } = await db.from("billing_line_items")
    .select("id, invoice_period_start, invoice_period_end, line_type, quantity, unit_amount_zar, total_amount_zar, billing_status, created_at")
    .eq("business_id", caller.business_id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ line_items: lineItems ?? [] });
}
