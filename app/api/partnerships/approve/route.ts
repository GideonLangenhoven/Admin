import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isComboEnabledServer } from "../../../lib/feature-flags";

function serviceClient() {
  var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

// GET /api/partnerships/approve?token=xxx
// Called when partner clicks the approve link in their email
export async function GET(req: NextRequest) {
  if (!isComboEnabledServer()) {
    return new Response(
      htmlPage("Coming Soon", "Combo deals are not available yet. Please check back later."),
      { status: 503, headers: { "Content-Type": "text/html" } }
    );
  }
  var token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return new Response(htmlPage("Invalid Link", "No invite token provided."), { status: 400, headers: { "Content-Type": "text/html" } });
  }

  var supabase = serviceClient();

  // Find and activate the partnership
  var { data: partnership, error } = await supabase
    .from("business_partnerships")
    .select("*, business_a:businesses!business_partnerships_business_a_id_fkey(business_name, name), business_b:businesses!business_partnerships_business_b_id_fkey(business_name, name)")
    .eq("invite_token", token)
    .maybeSingle();

  if (error || !partnership) {
    return new Response(htmlPage("Invalid Link", "This partnership invite link is not valid or has expired."), { status: 404, headers: { "Content-Type": "text/html" } });
  }

  if (partnership.status === "ACTIVE") {
    var partnerName = partnership.business_a?.business_name || partnership.business_b?.business_name || "your partner";
    return new Response(htmlPage("Already Accepted", "This partnership with " + partnerName + " is already active. You can close this page."), { status: 200, headers: { "Content-Type": "text/html" } });
  }

  if (partnership.status !== "PENDING") {
    return new Response(htmlPage("Expired", "This partnership invite has been revoked or is no longer valid."), { status: 400, headers: { "Content-Type": "text/html" } });
  }

  // Accept the partnership
  var { error: updateErr } = await supabase
    .from("business_partnerships")
    .update({ status: "ACTIVE", accepted_at: new Date().toISOString() })
    .eq("id", partnership.id)
    .eq("status", "PENDING");

  if (updateErr) {
    return new Response(htmlPage("Error", "Something went wrong accepting the partnership. Please try again or contact support."), { status: 500, headers: { "Content-Type": "text/html" } });
  }

  var bizA = partnership.business_a?.business_name || partnership.business_a?.name || "Business A";
  var bizB = partnership.business_b?.business_name || partnership.business_b?.name || "Business B";

  return new Response(
    htmlPage("Partnership Accepted!", "The partnership between <strong>" + bizA + "</strong> and <strong>" + bizB + "</strong> is now active. You can now create combo offers together from your admin dashboard."),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

function htmlPage(title: string, message: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — BookingTours</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f7f7f6;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:16px;padding:48px;max-width:480px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.08)}
h1{color:#1b3b36;font-size:24px;margin:0 0 16px}p{color:#555;line-height:1.6;margin:0}</style>
</head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}
