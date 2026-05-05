import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  const { id } = await params;
  const db = adminClient();

  const { data: request } = await db.from("data_subject_requests")
    .select("id, status, customer_id, business_id, email, request_type")
    .eq("id", id)
    .eq("business_id", caller.business_id)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (!["CONFIRMED", "IN_REVIEW"].includes(request.status)) {
    return NextResponse.json({ error: "Request is not in a fulfillable state (current: " + request.status + ")" }, { status: 400 });
  }

  if (request.request_type !== "DELETION") {
    return NextResponse.json({ error: "Only DELETION requests can be fulfilled via this endpoint" }, { status: 400 });
  }

  if (!request.customer_id) {
    return NextResponse.json({ error: "No customer linked to this request. Manual review required." }, { status: 400 });
  }

  // Run anonymization RPC
  const { data: result, error } = await db.rpc("anonymize_customer", {
    p_customer_id: request.customer_id,
    p_business_id: caller.business_id,
    p_request_id: request.id,
    p_admin_id: caller.id,
  });

  if (error) return NextResponse.json({ error: "Anonymization failed: " + error.message }, { status: 500 });

  // Update request status
  await db.from("data_subject_requests").update({
    status: "FULFILLED",
    fulfilled_at: new Date().toISOString(),
    fulfilled_by: caller.id,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  // Send notification to customer
  await fetch(supabaseUrl + "/functions/v1/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + serviceKey },
    body: JSON.stringify({
      type: "POPIA_REQUEST_FULFILLED",
      data: {
        business_id: caller.business_id,
        email: request.email,
        request_type: "DELETION",
      },
    }),
  });

  return NextResponse.json({ ok: true, affected_tables: result });
}
