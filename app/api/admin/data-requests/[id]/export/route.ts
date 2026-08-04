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
  if (!request.customer_id) {
    return NextResponse.json({ error: "No customer linked to this request" }, { status: 400 });
  }

  // Build export JSON
  const [customerRes, bookingsRes, marketingRes] = await Promise.all([
    db.from("customers")
      .select("*")
      .eq("id", request.customer_id)
      .eq("business_id", caller.business_id)
      .maybeSingle(),
    db.from("bookings")
      .select("id, ref_code, status, qty, total_amount, customer_name, email, phone, slot_id, created_at, cancellation_reason, refund_notes")
      .eq("customer_id", request.customer_id)
      .eq("business_id", caller.business_id)
      .order("created_at", { ascending: false }),
    db.from("marketing_contacts")
      .select("*")
      .eq("business_id", caller.business_id)
      .ilike("email", request.email),
  ]);

  // A POPIA subject access request that quietly returns an incomplete export is
  // worse than one that fails: the operator sends it believing it complete.
  // This select previously asked for ref/total_price/notes/updated_at and
  // matched marketing_contacts on email_lower — none of which exist on those
  // tables — so both queries errored and `?? []` turned that into "no data".
  if (customerRes.error || bookingsRes.error || marketingRes.error) {
    const detail = [customerRes.error?.message, bookingsRes.error?.message, marketingRes.error?.message]
      .filter(Boolean).join("; ");
    console.error("POPIA_EXPORT_QUERY_ERR request=" + request.id + ": " + detail);
    return NextResponse.json({ error: "Could not assemble a complete export: " + detail }, { status: 500 });
  }

  const exportData = {
    exported_at: new Date().toISOString(),
    request_id: request.id,
    customer: customerRes.data,
    bookings: bookingsRes.data ?? [],
    marketing_contacts: marketingRes.data ?? [],
  };

  const exportJson = JSON.stringify(exportData, null, 2);
  const fileName = `popia-export-${request.id.slice(0, 8)}-${Date.now()}.json`;

  // Upload to Supabase Storage
  const { data: uploadData, error: uploadErr } = await db.storage
    .from("popia-exports")
    .upload(fileName, exportJson, { contentType: "application/json", upsert: true });

  let exportUrl = "";
  let exportExpiresAt = "";

  if (uploadErr) {
    // If bucket doesn't exist, return inline JSON instead
    exportUrl = "inline";
  } else {
    const expiresIn = 7 * 24 * 60 * 60; // 7 days
    const { data: signed } = await db.storage
      .from("popia-exports")
      .createSignedUrl(fileName, expiresIn);
    exportUrl = signed?.signedUrl || "inline";
    exportExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  // Update request
  await db.from("data_subject_requests").update({
    export_url: exportUrl === "inline" ? null : exportUrl,
    export_expires_at: exportExpiresAt || null,
    status: request.request_type === "ACCESS" && ["CONFIRMED", "IN_REVIEW"].includes(request.status) ? "FULFILLED" : request.status,
    fulfilled_at: request.request_type === "ACCESS" ? new Date().toISOString() : null,
    fulfilled_by: request.request_type === "ACCESS" ? caller.id : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  // Notify customer
  if (exportUrl !== "inline") {
    await fetch(supabaseUrl + "/functions/v1/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + serviceKey },
      body: JSON.stringify({
        type: "POPIA_EXPORT_READY",
        data: {
          business_id: caller.business_id,
          email: request.email,
          export_url: exportUrl,
          expires_at: exportExpiresAt,
        },
      }),
    });
  }

  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: caller.business_id,
    action_type: "POPIA_EXPORT",
    target_entity: "data_subject_requests",
    target_id: id,
    after_state: { customer_id: request.customer_id, file: fileName },
  });

  return NextResponse.json({
    ok: true,
    export_url: exportUrl === "inline" ? undefined : exportUrl,
    export_data: exportUrl === "inline" ? exportData : undefined,
    expires_at: exportExpiresAt || undefined,
  });
}
