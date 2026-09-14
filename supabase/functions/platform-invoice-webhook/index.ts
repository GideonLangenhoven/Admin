// Signed callbacks for BookingTours' merchant, not a tenant merchant.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "npm:standardwebhooks";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";

const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||Deno.env.get("SERVICE_ROLE_KEY")!);
Deno.serve(withSentry("platform-invoice-webhook",async req=>{
  if(req.method!=="POST") return new Response("Method not allowed",{status:405});
  const secret=Deno.env.get("PLATFORM_YOCO_WEBHOOK_SECRET");
  if(!secret) return new Response("Webhook unavailable",{status:503});
  const raw=await req.text();
  try {
    await new Webhook(secret).verify(raw,{
      "webhook-id":req.headers.get("webhook-id")||"",
      "webhook-timestamp":req.headers.get("webhook-timestamp")||"",
      "webhook-signature":req.headers.get("webhook-signature")||"",
    });
  } catch{return new Response("Unauthorized",{status:401});}
  let body;
  try{body=JSON.parse(raw);}catch{return new Response("Invalid JSON",{status:400});}
  if(body.type!=="payment.succeeded") return new Response("OK");
  const payload=body.payload||{},meta=payload.metadata||{};
  if(meta.type!=="PLATFORM_INVOICE" || !meta.platform_invoice_id) return new Response("OK");
  const {error}=await db.rpc("platform_record_invoice_payment",{
    p_invoice_id:meta.platform_invoice_id,p_actor_id:null,p_method:"YOCO",p_notes:null,
    p_payment_id:payload.id||null,p_checkout_id:meta.checkoutId||payload.checkoutId||payload.checkout_id||null,
    p_amount_cents:payload.amount,p_currency:payload.currency,
  });
  // No pre-claim: a failed transaction remains retryable by the provider.
  if(error) return new Response("Payment could not be reconciled",{status:503});
  return new Response("OK");
}));
