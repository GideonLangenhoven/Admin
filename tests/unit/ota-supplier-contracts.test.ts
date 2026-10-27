import { describe, expect, it, vi } from "vitest";
import {
  createGygSupplierHandler,
  gygNotifyAvailability,
} from "../../supabase/functions/_shared/getyourguide";
import {
  createViatorSupplierHandler,
  viatorNotifyEvents,
} from "../../supabase/functions/_shared/viator";
import {
  type Inventory,
  localDateTime,
  type SupplierBackend,
  SupplierError,
} from "../../supabase/functions/_shared/ota-supplier";
const inventory: Inventory = {
  product: "P",
  option: "O",
  supplierOptionId: "opt-a",
  tourId: "tour",
  timezone: "Africa/Johannesburg",
  currency: "ZAR",
  categories: { ADULT: 100, CHILD: 50 },
  slots: [
    {
      id: "open",
      start: "2030-01-02T08:00:00Z",
      status: "OPEN",
      capacity: 5,
      booked: 1,
      held: 1,
    },
    {
      id: "closed",
      start: "2030-01-02T10:00:00Z",
      status: "CLOSED",
      capacity: 5,
      booked: 0,
      held: 0,
    },
    {
      id: "full",
      start: "2030-01-02T12:00:00Z",
      status: "OPEN",
      capacity: 5,
      booked: 5,
      held: 0,
    },
  ],
};
function backend(): SupplierBackend {
  return {
    replay: vi.fn(async () => null),
    inventory: vi.fn(async () => structuredClone(inventory)),
    catalog: vi.fn(async () => []),
    reservation: vi.fn(async () => {
      throw new SupplierError("INVALID_RESERVATION");
    }),
    apply: vi.fn(async () => ({
      reservation_id: "res-fixture",
      expires_at: "2030-01-01T10:00:00Z",
      booking_id: "booking-fixture",
      supplier_reference: "SUPPLIERREF",
    })),
  };
}
const gyg = (db: SupplierBackend) =>
  createGygSupplierHandler(db, { username: "fixture", password: "secret" });
const gygReq = (
  path: string,
  data?: unknown,
  authorization = "Basic " + btoa("fixture:secret"),
) =>
  new Request("https://fixture.invalid/1/" + path, {
    method: data ? "POST" : "GET",
    headers: { authorization },
    ...(data ? { body: JSON.stringify({ data }) } : {}),
  });
const viator = (db: SupplierBackend) =>
  createViatorSupplierHandler(db, { apiKey: "key", supplierId: 1004 });
const vReq = (path: string, data: unknown, authorization = "key") =>
  new Request("https://fixture.invalid/" + path, {
    method: "POST",
    headers: { "X-Api-Key": authorization },
    body: JSON.stringify(data),
  });
describe("official supplier contract fixtures", () => {
  it("requires GYG HTTP Basic and rejects OAuth/bearer without inventory writes", async () => {
    const db = backend();
    const response = await gyg(db)(
      gygReq("reserve/", { productId: "P" }, "Bearer token"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).errorCode).toBe("AUTHORIZATION_FAILURE");
    expect(db.inventory).not.toHaveBeenCalled();
  });
  it("GYG exports every slot including closures, offsets, categories and minor-unit operator currency", async () => {
    const db = backend();
    const response = await gyg(db)(
      gygReq(
        "get-availabilities/?productId=P&fromDateTime=2030-01-02T00:00:00Z&toDateTime=2030-01-02T23:59:59Z",
      ),
    );
    const payload = await response.json();
    expect(
      payload.data.availabilities.map((s: { vacancies: number }) =>
        s.vacancies
      ),
    ).toEqual([3, 0, 0]);
    expect(payload.data.availabilities[0]).toMatchObject({
      dateTime: "2030-01-02T10:00:00+02:00",
      currency: "ZAR",
      pricesByCategory: {
        retailPrices: [{ category: "ADULT", price: 10000 }, {
          category: "CHILD",
          price: 5000,
        }],
      },
    });
  });
  it("malformed JSON and zero counts fail as validation errors before mutation", async () => {
    const db = backend();
    const malformed = new Request("https://fixture.invalid/1/reserve/", {
      method: "POST",
      headers: { authorization: "Basic " + btoa("fixture:secret") },
      body: "{",
    });
    expect((await (await gyg(db)(malformed)).json()).errorCode).toBe(
      "VALIDATION_FAILURE",
    );
    const response = await gyg(db)(
      gygReq("reserve/", {
        gygBookingReference: "GYG-ref",
        productId: "P",
        dateTime: "2030-01-02T10:00:00+02:00",
        bookingItems: [{ category: "ADULT", count: 0 }],
      }),
    );
    expect((await response.json()).errorCode).toBe("VALIDATION_FAILURE");
    expect(db.apply).not.toHaveBeenCalled();
  });
  it("does not disguise unsupported group inventory as per-person seats", async () => {
    const db = backend();
    const response = await gyg(db)(
      gygReq("reserve/", {
        gygBookingReference: "GYG-ref",
        productId: "P",
        dateTime: "2030-01-02T10:00:00+02:00",
        bookingItems: [{ category: "GROUP", count: 1, groupSize: 5 }],
      }),
    );
    expect((await response.json()).errorCode).toBe("INVALID_TICKET_CATEGORY");
    expect(db.apply).not.toHaveBeenCalled();
  });
  it("reserves one hour and uses +00:00 expiration; activity zero fractions normalize", async () => {
    const db = backend();
    const response = await gyg(db)(
      gygReq("reserve/", {
        gygBookingReference: "GYG-ref",
        productId: "P",
        dateTime: "2030-01-02T10:00:00.000+02:00",
        bookingItems: [{ category: "ADULT", count: 2 }],
      }),
    );
    expect((await response.json()).data.reservationExpiration).toBe(
      "2030-01-01T10:00:00+00:00",
    );
    expect(db.apply).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        quantity: 2,
        date_time: "2030-01-02T10:00:00+02:00",
      }),
    );
  });
  it("database failure propagates to a retryable supplier error without success data", async () => {
    const db = backend();
    db.apply = vi.fn(async () => {
      throw new SupplierError("INTERNAL_SYSTEM_FAILURE");
    });
    const response = await gyg(db)(
      gygReq("reserve/", {
        gygBookingReference: "GYG-ref",
        productId: "P",
        dateTime: "2030-01-02T10:00:00+02:00",
        bookingItems: [{ category: "ADULT", count: 2 }],
      }),
    );
    expect(await response.json()).toEqual({
      errorCode: "INTERNAL_SYSTEM_FAILURE",
      errorMessage: "INTERNAL_SYSTEM_FAILURE",
    });
  });
  it("Viator authenticates X-Api-Key and separately validates supplier ownership", async () => {
    const db = backend();
    expect(
      (await viator(db)(vReq("v2/reserve", { supplierId: 1004 }, "wrong")))
        .status,
    ).toBe(401);
    const response = await viator(db)(vReq("v2/reserve", { supplierId: 123 }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("INVALID_SUPPLIER");
    expect(db.apply).not.toHaveBeenCalled();
  });
  it.each([["14:00", "SOLD_OUT"], ["12:00", "NO_EVENT"]])(
    "Viator reserve %s returns contract NOT_RESERVED %s",
    async (startTime, reason) => {
      const db = backend();
      const response = await viator(db)(
        vReq("v2/reserve", {
          supplierId: 1004,
          productOptionId: "opt-a",
          travelDate: "2030-01-02",
          startTime,
          tickets: [{ type: "ADULT", quantity: 1 }],
          totalTravelers: 1,
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "NOT_RESERVED", reason });
      expect(db.apply).not.toHaveBeenCalled();
    },
  );
  it("Viator unspecified startTimes returns all real-time events and omits closed events", async () => {
    const db = backend();
    const response = await viator(db)(
      vReq("v2/availability/check", {
        supplierId: 1004,
        productOptions: [{ productOptionId: "opt-a" }],
        travelDate: "2030-01-02",
        tickets: [{ type: "ADULT", quantity: 1 }],
        totalTravelers: 1,
      }),
    );
    const result = await response.json();
    expect(
      result.productOptions[0].events.map((e: { startTime: string }) =>
        e.startTime
      ),
    ).toEqual(["10:00", "14:00"]);
    expect(db.inventory).toHaveBeenCalledWith("", "", "opt-a", {
      from: "2030-01-02T00:00:00+14:00",
      to: "2030-01-02T23:59:59-14:00",
    });
  });
  it("formats operator local date across DST transitions and UTC date boundaries", () => {
    expect(localDateTime("2030-06-01T23:00:00Z", "Africa/Johannesburg")).toBe(
      "2030-06-02T01:00:00+02:00",
    );
    expect(localDateTime("2030-03-31T00:30:00Z", "Europe/London")).toBe(
      "2030-03-31T00:30:00+00:00",
    );
    expect(localDateTime("2030-03-31T01:30:00Z", "Europe/London")).toBe(
      "2030-03-31T02:30:00+01:00",
    );
  });
  it("uses documented outbound auth/path and propagates notification errors", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { message: "Availability Update Accepted" } }),
        { status: 202 },
      )
    );
    await gygNotifyAvailability(
      "https://supplier-api.getyourguide.com",
      { username: "issued", password: "secret" },
      { data: { productId: "P", availabilities: [] } },
      fetcher,
    );
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://supplier-api.getyourguide.com/1/notify-availability-update",
    );
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Basic " + btoa("issued:secret"),
    );
    await expect(
      gygNotifyAvailability(
        "https://supplier-api.getyourguide.com",
        { username: "issued", password: "secret" },
        {},
        async () =>
          new Response(JSON.stringify({ errorCode: "INVALID_PRODUCT" }), {
            status: 400,
          }),
      ),
    ).rejects.toThrow();
    await expect(
      viatorNotifyEvents(
        "https://api.viator.com",
        "key",
        {},
        async () => new Response(null, { status: 500 }),
      ),
    ).rejects.toThrow();
  });
});
