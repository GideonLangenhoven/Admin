import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";
import { businessDateKey, isDateKey } from "../../app/lib/simple-view";
import { amountReceived } from "../../app/lib/report-accounting";

const bookingId = "00000000-0000-0000-0000-000000000099";
const saved = { ok: true, id: bookingId, start_time: "2026-10-21T22:30:00Z", status: "CONFIRMED" };

function creation(response: unknown) {
  const openCreatedBooking = vi.fn();
  const rpc = vi.fn().mockResolvedValue(response);
  const invoke = vi.fn(() => { throw new Error("Unexpected guest message"); });
  const setResult = vi.fn();
  const submittingRef = { current: false };
  const create = sourceFunction("app/new-booking/page.tsx", "createBooking", {
    submittingRef, readOnly: false, blockingDataError: "", priceUnavailable: false, bookingCreated: false,
    setMissingField: vi.fn(), selectedTour: { name: "Walk" }, isDateKey, bookingDate: "2026-10-22",
    bespoke: false, selectedSlot: { available_capacity: 10 }, availableSlots: [{ id: "slot-a" }], selectedSlotId: "slot-a",
    adults: "1", children: "0", qty: 1, customerName: "Guest", mobile: "", email: "guest@example.invalid",
    discountType: "none", discountReason: "", questionConfig: {}, customFieldDefinitions: [], customFieldValues: {},
    validateQuestionAnswers: () => ({ answers: {}, errors: [] }), normalizePhone: (value: string) => value,
    reviewing: true, setSubmitting: vi.fn(), setResult, requestIdRef: { current: bookingId }, setAttemptedBookingId: vi.fn(),
    selectedTourId: "tour-a", status: "CONFIRMED", holdHours: "168", discountNum: 0, selectedAddOns: {},
    captureQuestionFields: () => ({}), businessId: "tenant-a", totalAmount: 750, sendNotifications: false,
    supabase: { rpc, functions: { invoke } }, openCreatedBooking, getAdminTimezone: () => "Africa/Johannesburg",
    bizMeetingPoint: "", notify: vi.fn(),
  });
  return { create, openCreatedBooking, rpc, invoke, setResult, submittingRef };
}

describe("return to Bookings after creation", () => {
  it("clears the saved draft and opens the departure's local date instead of a receipt", () => {
    const setBookingCreated = vi.fn();
    const clearOperatorBookingDrafts = vi.fn();
    const removeItem = vi.fn();
    const replace = vi.fn();
    const open = sourceFunction("app/new-booking/page.tsx", "openCreatedBooking", {
      setBookingCreated, clearOperatorBookingDrafts, sessionStorage: { removeItem }, draftOwner: "staff:tenant:launch",
      dateKey: (iso: string) => businessDateKey("Africa/Johannesburg", new Date(iso)), router: { replace },
    });
    open(saved);
    expect(setBookingCreated).toHaveBeenCalledWith(true);
    expect(clearOperatorBookingDrafts).toHaveBeenCalledWith("staff:tenant:launch");
    expect(removeItem).toHaveBeenCalledWith("operator-booking-request:staff:tenant:launch");
    expect(replace).toHaveBeenCalledWith(`/bookings?date=2026-10-22&booking=${bookingId}`);
  });

  it.each([false, true])("opens the saved booking, including an idempotent replay (%s)", async replay => {
    const result = { ...saved, replay };
    const fixture = creation({ data: result, error: null });
    await fixture.create();
    expect(fixture.openCreatedBooking).toHaveBeenCalledExactlyOnceWith(result);
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(fixture.submittingRef.current).toBe(false);
  });

  it("keeps an unconfirmed save on the form for a safe retry", async () => {
    const fixture = creation({ data: null, error: { message: "Save unconfirmed" } });
    await fixture.create();
    expect(fixture.openCreatedBooking).not.toHaveBeenCalled();
    expect(fixture.setResult).toHaveBeenCalledWith("Save unconfirmed");
    expect(fixture.submittingRef.current).toBe(false);
  });
});

function listFixture(rows: any[], target: any, date = "2026-10-22") {
  const setBookings = vi.fn();
  const setHasMore = vi.fn();
  const eq = vi.fn().mockReturnThis();
  const maybeSingle = vi.fn().mockResolvedValue({ data: target, error: null });
  const query = {
    select: vi.fn().mockReturnThis(), eq, maybeSingle,
    in: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  const list = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) };
  const loadRequestRef = { current: 0 };
  const load = sourceFunction("app/bookings/page.tsx", "loadBookings", {
    businessId: "tenant-a", loadRequestRef, setLoading: vi.fn(), page: 0, PAGE_SIZE: 50,
    rangeStart: new Date("2026-10-21T22:00Z"), rangeEnd: new Date("2026-10-22T21:59:59.999Z"),
    rangeDate: date, createdBooking: { id: bookingId, date: "2026-10-22" }, timezone: "Africa/Johannesburg",
    BOOKING_COLUMNS: "id,slots(start_time)", businessDateKey,
    supabase: { rpc: (name: string) => name === "list_operator_bookings" ? list : Promise.resolve({ data: [], error: null }),
      from: (table: string) => { if (table !== "bookings") throw new Error("Unexpected table: " + table); return query; } },
    fetchAllRows: async () => [], setHasMore, setBookings, notify: vi.fn(),
  });
  return { load, setBookings, setHasMore, eq, maybeSingle, loadRequestRef };
}

describe("showing a newly created booking in the list", () => {
  const row = { ...saved, slots: { start_time: saved.start_time }, tours: null };
  const firstPage = Array.from({ length: 51 }, (_, i) => ({ ...row, id: `existing-${i}` }));

  it("includes a new booking beyond page one and preserves further pagination", async () => {
    const fixture = listFixture(firstPage, { ...row, slots: [row.slots] });
    await fixture.load();
    expect(fixture.eq.mock.calls.slice(0, 2)).toEqual([["business_id", "tenant-a"], ["id", bookingId]]);
    expect(fixture.setBookings.mock.calls[0][0]).toHaveLength(51);
    expect(fixture.setBookings.mock.calls[0][0].at(-1)).toMatchObject({ id: bookingId, slots: row.slots });
    expect(fixture.setHasMore).toHaveBeenCalledWith(true);
  });

  it("does not duplicate a booking already in the visible page", async () => {
    const fixture = listFixture([row], row);
    await fixture.load();
    expect(fixture.maybeSingle).not.toHaveBeenCalled();
    expect(fixture.setBookings.mock.calls[0][0]).toHaveLength(1);
    expect(fixture.setHasMore).toHaveBeenCalledWith(false);
  });

  it("does not insert a booking from a different departure date", async () => {
    const fixture = listFixture([], { ...row, slots: { start_time: "2026-10-23T10:00Z" } });
    await fixture.load();
    expect(fixture.setBookings).toHaveBeenCalledWith([]);
  });

  it("stops pinning the booking when the operator changes the selected date", async () => {
    const fixture = listFixture([], row, "2026-10-23");
    await fixture.load();
    expect(fixture.maybeSingle).not.toHaveBeenCalled();
    expect(fixture.setBookings).toHaveBeenCalledWith([]);
  });

  it("ignores a late target lookup after the list context changes", async () => {
    const fixture = listFixture([], row);
    fixture.maybeSingle.mockImplementation(async () => {
      fixture.loadRequestRef.current++;
      return { data: row, error: null };
    });
    await fixture.load();
    expect(fixture.setBookings).not.toHaveBeenCalled();
  });
});

describe("payment amounts in the destination Bookings list", () => {
  const isPaid = sourceFunction("app/bookings/page.tsx", "isPaid", { amountReceived });
  const paidAmount = sourceFunction("app/bookings/page.tsx", "bookingPaidAmount", { amountReceived });

  it("keeps a confirmed unpaid booking due and its payment actions available", () => {
    const booking = { status: "CONFIRMED", total_amount: 750, total_captured: 0 };
    expect(isPaid(booking)).toBe(false);
    expect(paidAmount(booking)).toBe(0);
  });

  it("uses the recorded amount for full and partial payments", () => {
    expect(isPaid({ status: "CONFIRMED", total_amount: 750, total_captured: 750 })).toBe(true);
    expect(isPaid({ status: "CONFIRMED", total_amount: 750, total_captured: 200 })).toBe(false);
    expect(paidAmount({ status: "CONFIRMED", total_amount: 750, total_captured: 200 })).toBe(200);
    expect(paidAmount({ status: "PAID", total_amount: 750, total_captured: 750 })).toBe(750);
  });

  it("preserves legacy paid bookings and counts voucher value once", () => {
    expect(isPaid({ status: "PAID", total_amount: 750 })).toBe(true);
    expect(paidAmount({ status: "PAID", total_amount: 500, voucher_amount_paid: 250 })).toBe(750);
    expect(paidAmount({ status: "CONFIRMED", total_amount: 500, total_captured: 200, voucher_amount_paid: 250 })).toBe(450);
    expect(paidAmount({ status: "PAID", total_amount: 0, voucher_amount_paid: 750 })).toBe(750);
  });
});
