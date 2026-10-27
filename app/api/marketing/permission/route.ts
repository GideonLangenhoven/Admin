import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";

export async function POST(req: Request) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) return reply({ error: "Main Admin or Super Admin required" }, 403);
  let body;
  try { body = await req.json(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.contact_id || "") || typeof body.expected_email !== "string"
    || !["granted", "withdrawn"].includes(body.decision)) return reply({ error: "Choose a contact and permission decision" }, 400);
  if (body.decision === "granted" && (typeof body.evidence_at !== "string" || !Number.isFinite(Date.parse(body.evidence_at))
    || Date.parse(body.evidence_at) > Date.now() || typeof body.notice_text !== "string" || body.notice_text.trim().length < 10
    || body.notice_text.length > 2000 || typeof body.evidence_ref !== "string" || body.evidence_ref.trim().length < 3
    || body.evidence_ref.length > 500)) return reply({ error: "Record when permission was given, the notice shown and its evidence reference" }, 400);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("record_marketing_permission", {
    p_business_id: caller.business_id, p_contact_id: body.contact_id, p_admin_id: caller.id,
    p_expected_email: body.expected_email, p_decision: body.decision,
    p_evidence_at: body.decision === "granted" ? body.evidence_at : null,
    p_notice_text: body.decision === "granted" ? body.notice_text.trim() : null,
    p_evidence_ref: body.decision === "granted" ? body.evidence_ref.trim() : null,
  });
  if (error) return reply({ error: error.code === "42501" ? "You cannot change this contact's permission" : "Permission could not be recorded. Reload and check the contact's current status." }, error.code === "42501" ? 403 : 409);
  return reply({ ok: true, eligibility: data });
}
