import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "npm:standardwebhooks";
import { createServiceClient } from "../_shared/tenant.ts";

// Verify provider signatures before accepting delivery feedback.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) return new Response("Webhook unavailable", { status: 503 });
  const raw = await req.text();
  const eventId = req.headers.get("svix-id") || "";
  try {
    await new Webhook(secret).verify(raw, {
      "webhook-id": eventId, "webhook-timestamp": req.headers.get("svix-timestamp") || "",
      "webhook-signature": req.headers.get("svix-signature") || "",
    });
  } catch { return new Response("Unauthorized", { status: 401 }); }
  let event;
  try { event = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!["email.bounced", "email.complained", "email.suppressed"].includes(event.type)) return new Response("OK");
  if (typeof event.data?.email_id !== "string") return new Response("Invalid event", { status: 400 });
  const { data, error } = await createServiceClient().rpc("record_marketing_provider_event", {
    p_event_id: eventId, p_provider_id: event.data.email_id, p_type: event.type,
  });
  // Acknowledgement means durably stored; late send identities are matched in the database.
  if (error || data !== true) return new Response("Reconciliation required", { status: 503 });
  return new Response("OK");
});
