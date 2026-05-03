// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  try {
    var auth = await requireAuth(req);
    if (!auth.businessId && !auth.isServiceRole) {
      return new Response(JSON.stringify({ error: "business_id required" }), { status: 400 });
    }

    var body: any = {};
    try { body = await req.json(); } catch (_) {}
    var businessId = auth.isServiceRole ? (body.business_id || "") : auth.businessId;
    if (!businessId) {
      return new Response(JSON.stringify({ error: "business_id required" }), { status: 400 });
    }

    const { data: logs } = await supabase.from('logs').select('*').eq("business_id", businessId).order('created_at', { ascending: false }).limit(5);
    const { data: bookings } = await supabase.from('bookings').select('id,customer_name,email,created_at,status').eq("business_id", businessId).order('created_at', { ascending: false }).limit(5);
    return new Response(JSON.stringify({ logs, bookings }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Unauthorized" }), { status: 401 });
  }
});
