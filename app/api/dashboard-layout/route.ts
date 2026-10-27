import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerAdmin, isPrivilegedRole } from "../../lib/api-auth";
import { readDashboardLayout, validDashboardLayout } from "../../lib/dashboard-layout";

const columns = "tile_order,hidden_tiles,revision";
const noStore = { "Cache-Control": "no-store" };
function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Sign in to view the dashboard layout." }, { status: 401, headers: noStore });
  const { data, error } = await serviceClient().from("operator_dashboard_layouts").select(columns).eq("business_id", caller.business_id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load the saved dashboard layout. Try again." }, { status: 503, headers: noStore });
  return NextResponse.json({ layout: readDashboardLayout(data?.tile_order, data?.hidden_tiles), revision: data?.revision ?? 0 }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) return NextResponse.json({ error: "Only main and super admins can change the dashboard layout." }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid layout." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => key !== "layout" && key !== "revision")
    || !validDashboardLayout(body.layout) || !Number.isInteger(body.revision) || body.revision < 0 || body.revision >= 2147483647) {
    return NextResponse.json({ error: "Invalid layout. Refresh the dashboard and try again." }, { status: 400 });
  }
  const db = serviceClient();
  const values = { tile_order: body.layout.order, hidden_tiles: body.layout.hidden, revision: body.revision + 1, updated_at: new Date().toISOString() };
  const write = body.revision === 0
    ? db.from("operator_dashboard_layouts").insert({ ...values, business_id: caller.business_id })
    : db.from("operator_dashboard_layouts").update(values).eq("business_id", caller.business_id).eq("revision", body.revision);
  const { data, error } = await write.select(columns).maybeSingle();
  if (error?.code === "23505" || (!error && !data)) {
    return NextResponse.json({ error: "Another admin changed this layout. Reload the saved layout before editing again." }, { status: 409 });
  }
  if (error || !data) return NextResponse.json({ error: "The layout was not saved. Your changes are still here; try saving again." }, { status: 503 });
  return NextResponse.json({ layout: readDashboardLayout(data.tile_order, data.hidden_tiles), revision: data.revision }, { headers: noStore });
}
