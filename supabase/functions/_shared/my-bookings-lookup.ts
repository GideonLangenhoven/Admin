export type LookupBusinessRow = {
  id: string;
  subdomain?: string | null;
  booking_site_url?: string | null;
  manage_bookings_url?: string | null;
};

export type LookupBookingRow = {
  id: string;
  business_id: string;
  email: string;
  phone?: string | null;
  [key: string]: unknown;
};

export type BookingLookupCriteria = {
  businessId: string;
  email: string;
  phoneTail: string;
  emailOnly?: boolean;
};

function trimTrailingSlash(value?: string | null) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function originOf(value?: string | null) {
  const raw = trimTrailingSlash(value);
  if (!raw) return "";
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return "";
  }
}

export function normalizePhoneTail(value?: string | null, length = 9) {
  return String(value || "").replace(/\D/g, "").slice(-length);
}

export function resolveBusinessFromOrigin(
  businesses: LookupBusinessRow[],
  origin: string,
  localhostBusinessId?: string | null,
) {
  const normalizedOrigin = originOf(origin);
  if (!normalizedOrigin) return null;

  const host = new URL(normalizedOrigin).hostname.toLowerCase();
  const bookingSubdomainMatch = host.match(/^([a-z0-9-]+)\.booking\.bookingtours\.co\.za$/i);
  const subdomain = bookingSubdomainMatch ? bookingSubdomainMatch[1].toLowerCase() : "";

  for (const business of businesses) {
    if (subdomain && String(business.subdomain || "").toLowerCase() === subdomain) return business;
    if (originOf(business.booking_site_url) === normalizedOrigin) return business;
    if (originOf(business.manage_bookings_url) === normalizedOrigin) return business;
  }

  if ((host === "localhost" || host === "127.0.0.1") && localhostBusinessId) {
    return businesses.find((business) => business.id === localhostBusinessId) || null;
  }

  return null;
}

export function filterBookingsForLookup<T extends LookupBookingRow>(
  bookings: T[],
  criteria: BookingLookupCriteria,
) {
  const email = String(criteria.email || "").trim().toLowerCase();
  const phoneTail = normalizePhoneTail(criteria.phoneTail);

  return bookings.filter((booking) => {
    if (booking.business_id !== criteria.businessId) return false;
    if (String(booking.email || "").trim().toLowerCase() !== email) return false;
    if (criteria.emailOnly) return true;

    const bookingPhoneTail = normalizePhoneTail(booking.phone);
    if (!bookingPhoneTail) return true;
    return bookingPhoneTail === phoneTail;
  });
}
