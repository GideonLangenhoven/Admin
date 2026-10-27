import { NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { isMarketingSetup } from "@/app/lib/marketing-setup";

export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
  const caller = await getCallerAdmin(req);
  if (!caller) return reply({ error: "Operator access required" }, 401);
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const response = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/marketing-setup-status", {
      method: "POST", headers: { Authorization: "Bearer " + key, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: caller.business_id }), cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok || !isMarketingSetup(data)) return reply({ error: "Email setup could not be checked" }, 503);
    // Return only known status fields, never credentials or provider responses.
    return reply({
      email_service_configured: data.email_service_configured,
      email_feedback_configured: data.email_feedback_configured,
      operator_status: data.operator_status,
      welcome_back_available: data.welcome_back_available,
    });
  } catch { return reply({ error: "Email setup could not be checked" }, 503); }
}
