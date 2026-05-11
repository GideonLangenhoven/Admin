import { describe, expect, it } from "vitest";
import {
  buildTenantHeaders,
  buildVoucherHeaders,
  tenantSubdomainFromHost,
} from "../../booking/app/lib/tenant-headers";

describe("tenant header helpers", () => {
  it("builds tenant and subdomain headers without empty values", () => {
    expect(buildTenantHeaders({ businessId: "biz-123", subdomain: "" })).toEqual({
      "x-tenant-business-id": "biz-123",
    });
    expect(buildTenantHeaders({ subdomain: "aonyx" })).toEqual({
      "x-tenant-subdomain": "aonyx",
    });
  });

  it("normalizes voucher lookup headers", () => {
    expect(buildVoucherHeaders(" ab12 cd34 ", "biz-123")).toEqual({
      "x-tenant-business-id": "biz-123",
      "x-voucher-code": "AB12CD34",
    });
  });

  it("extracts standard booking-site subdomains", () => {
    expect(tenantSubdomainFromHost("aonyx.booking.bookingtours.co.za")).toBe("aonyx");
    expect(tenantSubdomainFromHost("localhost")).toBeNull();
  });
});
