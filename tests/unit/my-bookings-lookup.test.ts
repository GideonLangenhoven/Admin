import { describe, expect, it } from "vitest";
import {
  filterBookingsForLookup,
  resolveBusinessFromOrigin,
  type LookupBookingRow,
  type LookupBusinessRow,
} from "../../supabase/functions/_shared/my-bookings-lookup";

const tenantA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

const businesses: LookupBusinessRow[] = [
  {
    id: tenantA,
    subdomain: "tenant-a",
    booking_site_url: "https://tenant-a.booking.bookingtours.co.za",
    manage_bookings_url: null,
  },
  {
    id: tenantB,
    subdomain: "tenant-b",
    booking_site_url: "https://tenant-b.example.com/",
    manage_bookings_url: "https://manage.tenant-b.example.com/my-bookings",
  },
];

const bookings: LookupBookingRow[] = [
  { id: "a1", business_id: tenantA, email: "shared@example.com", phone: "+27 71 111 2222" },
  { id: "b1", business_id: tenantB, email: "shared@example.com", phone: "+27 72 333 4444" },
  { id: "a2", business_id: tenantA, email: "other@example.com", phone: "+27 71 111 2222" },
];

describe("my bookings tenant lookup", () => {
  it("resolves bookingtours subdomains to a business id", () => {
    expect(resolveBusinessFromOrigin(businesses, "https://tenant-a.booking.bookingtours.co.za")?.id).toBe(tenantA);
  });

  it("resolves configured booking and manage origins", () => {
    expect(resolveBusinessFromOrigin(businesses, "https://tenant-b.example.com")?.id).toBe(tenantB);
    expect(resolveBusinessFromOrigin(businesses, "https://manage.tenant-b.example.com")?.id).toBe(tenantB);
  });

  it("filters same-email lookup to the resolved tenant before returning rows", () => {
    const result = filterBookingsForLookup(bookings, {
      businessId: tenantA,
      email: "SHARED@example.com",
      phoneTail: "",
      emailOnly: true,
    });

    expect(result.map((b) => b.id)).toEqual(["a1"]);
  });

  it("applies phone-tail filtering after tenant and email are enforced", () => {
    const result = filterBookingsForLookup(bookings, {
      businessId: tenantB,
      email: "shared@example.com",
      phoneTail: "723334444",
      emailOnly: false,
    });

    expect(result.map((b) => b.id)).toEqual(["b1"]);
  });
});
