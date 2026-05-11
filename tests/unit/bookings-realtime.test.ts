import { describe, expect, it } from "vitest";
import { bookingRealtimeFilter, shouldRefreshBookingsForPayload } from "../../app/lib/bookings-realtime";

describe("booking realtime helpers", () => {
  it("scopes booking updates to the current business", () => {
    expect(bookingRealtimeFilter("biz-123")).toBe("business_id=eq.biz-123");
  });

  it("ignores updates for other businesses before refetching bookings", () => {
    expect(shouldRefreshBookingsForPayload({ new: { business_id: "biz-123" } }, "biz-123")).toBe(true);
    expect(shouldRefreshBookingsForPayload({ new: { business_id: "other-biz" } }, "biz-123")).toBe(false);
  });
});
