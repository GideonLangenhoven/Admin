import type { TenantBusiness } from "./tenant.ts";

function appendQuery(base: string, params: Record<string, string>) {
  var url = new URL(base);
  for (var [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function resolveWaiverLink(business: Pick<TenantBusiness, "waiver_url"> | null | undefined, bookingId: string, waiverToken?: string | null) {
  if (!bookingId || !waiverToken) return "";
  var customUrl = String(business?.waiver_url || "").trim();
  if (customUrl) return appendQuery(customUrl, { booking: bookingId, token: waiverToken });
  var supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!supabaseUrl) return "";
  return appendQuery(supabaseUrl.replace(/\/+$/, "") + "/functions/v1/waiver-form", {
    booking: bookingId,
    token: waiverToken,
  });
}

export async function getWaiverContext(supabase: any, options: {
  businessId?: string | null;
  bookingId?: string | null;
  waiverStatus?: string | null;
  waiverToken?: string | null;
}) {
  var businessId = options.businessId || "";
  var bookingId = options.bookingId || "";
  var waiverStatus = options.waiverStatus || "";
  var waiverToken = options.waiverToken || "";

  if (bookingId && (!businessId || !waiverStatus || !waiverToken)) {
    var bookingRes = await supabase
      .from("bookings")
      .select("id, business_id, waiver_status, waiver_token")
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingRes.data) {
      businessId = businessId || bookingRes.data.business_id;
      waiverStatus = waiverStatus || bookingRes.data.waiver_status;
      waiverToken = waiverToken || bookingRes.data.waiver_token;
    }
  }

  var business: TenantBusiness | null = null;
  if (businessId) {
    var businessRes = await supabase
      .from("businesses")
      .select("id, name, waiver_url, timezone, currency")
      .eq("id", businessId)
      .maybeSingle();
    business = (businessRes.data || null) as TenantBusiness | null;
  }

  return {
    business,
    waiverStatus: waiverStatus || "PENDING",
    waiverLink: bookingId && waiverToken ? resolveWaiverLink(business, bookingId, waiverToken) : "",
  };
}
