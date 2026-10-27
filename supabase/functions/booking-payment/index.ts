import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";
import { verifyPaymentDeadlineToken } from "../_shared/payment-deadline.ts";
const db = createServiceClient();
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" };
Deno.serve(async (req: Request) => {
  const respond = (status: number, message: string) => new Response(message, { status, headers });
  if (req.method !== "GET") return respond(405, "Method not allowed");
  try {
    const url = new URL(req.url);
    const booking = url.searchParams.get("booking") || "", business = url.searchParams.get("business") || "", token = url.searchParams.get("token") || "";
    if (!await verifyPaymentDeadlineToken(token, booking, business)) return respond(410, "This payment link has expired or is invalid. Please contact the operator for help.");
    const { data: b, error } = await db.from("bookings")
      .select("status, total_amount, total_captured, payment_status, payment_deadline, payment_url, source")
      .eq("id", booking).eq("business_id", business).maybeSingle();
    if (error) return respond(503, "Payment details are temporarily unavailable. Please try again.");
    if (!b || b.source !== "ADMIN" || !["PENDING", "HELD", "CONFIRMED"].includes(b.status)
      || (Number(b.total_amount) <= 0 || Number(b.total_captured || 0) > 0) || ["CAPTURED", "MISMATCH_QUARANTINE"].includes(b.payment_status)
      || !b.payment_deadline || Date.parse(b.payment_deadline) <= Date.now()
      || Date.parse(b.payment_deadline) !== Number(token.split(".")[0])) return respond(410, "This booking is no longer awaiting payment through this link. Please contact the operator if you need help.");
    const checkout = new URL(b.payment_url);
    if (checkout.protocol !== "https:" || !(checkout.hostname === "yoco.com" || checkout.hostname.endsWith(".yoco.com")) || checkout.username || checkout.password) return respond(503, "Payment link unavailable. Please contact the operator.");
    return new Response(null, { status: 303, headers: { ...headers, Location: checkout.toString() } });
  } catch {
    return respond(503, "Payment link unavailable. Please try again or contact the operator.");
  }
});
