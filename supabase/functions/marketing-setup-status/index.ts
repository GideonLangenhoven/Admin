import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireAuth } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/tenant.ts";

// Read-only server-to-server diagnostics, separate from the sending workers.
Deno.serve(async (req: Request) => {
  const headers = { "Cache-Control": "no-store" };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  let auth;
  try { auth = await requireAuth(req); } catch { return reply({ error: "Unauthorized" }, 401); }
  if (!auth.isServiceRole) return reply({ error: "Server access required" }, 403);
  let body;
  try { body = await req.json(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body?.business_id || "")) {
    return reply({ error: "Choose an operator" }, 400);
  }
  try {
    const { data, error } = await createServiceClient().rpc("marketing_policy_reason", { p_business_id: body.business_id });
    if (error || !["eligible", "quiet_hours", "policy_approval_pending", "timezone_unavailable"].includes(data)) {
      return reply({ error: "Email setup could not be checked" }, 503);
    }
    return reply({
      email_service_configured: Boolean(Deno.env.get("RESEND_API_KEY")),
      email_feedback_configured: Boolean(Deno.env.get("RESEND_WEBHOOK_SECRET")),
      operator_status: data,
      // The worker rechecks paid history, permission and reservations at delivery.
      welcome_back_available: true,
    });
  } catch { return reply({ error: "Email setup could not be checked" }, 503); }
});
