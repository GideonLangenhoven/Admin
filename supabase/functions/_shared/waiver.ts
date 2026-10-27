// The fields this helper reads; keeping the type local lets the browser reuse its URL logic.
type WaiverBusiness = { id: string; name: string; waiver_url?: string | null; booking_site_url?: string | null; timezone: string; currency: string };

function appendQuery(base: string, params: Record<string, string>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function resolveWaiverLink(business: Pick<WaiverBusiness, "waiver_url"> & { booking_site_url?: string | null } | null | undefined, bookingId: string, waiverToken?: string | null) {
  if (!bookingId || !waiverToken) return "";
  const customUrl = String(business?.waiver_url || "").trim();
  if (customUrl) return appendQuery(customUrl, { booking: bookingId, token: waiverToken });
  // Use the booking site URL if available
  const bookingSiteUrl = String(business?.booking_site_url || "").replace(/\/+$/, "");
  if (!bookingSiteUrl) return "";
  return appendQuery(bookingSiteUrl + "/waiver", {
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
  let businessId = options.businessId || "";
  const bookingId = options.bookingId || "";
  let waiverStatus = options.waiverStatus || "";
  let waiverToken = options.waiverToken || "";

  if (bookingId && (!businessId || !waiverStatus || !waiverToken)) {
    let bookingQuery = supabase
      .from("bookings")
      .select("id, business_id, waiver_status, waiver_token")
      .eq("id", bookingId);
    if (businessId) bookingQuery = bookingQuery.eq("business_id", businessId);
    const bookingRes = await bookingQuery.maybeSingle();
    if (bookingRes.error || !bookingRes.data) throw new Error("Booking waiver status could not be loaded");
    if (bookingRes.data) {
      businessId = businessId || bookingRes.data.business_id;
      waiverStatus = waiverStatus || bookingRes.data.waiver_status;
      waiverToken = waiverToken || bookingRes.data.waiver_token;
    }
  }

  let business: WaiverBusiness | null = null;
  if (businessId) {
    const businessRes = await supabase
      .from("businesses")
      .select("id, name, waiver_url, booking_site_url, timezone, currency")
      .eq("id", businessId)
      .maybeSingle();
    business = (businessRes.data || null) as WaiverBusiness | null;
  }

  return {
    business,
    waiverStatus: waiverStatus || "PENDING",
    waiverLink: bookingId && waiverToken ? resolveWaiverLink(business, bookingId, waiverToken) : "",
  };
}
