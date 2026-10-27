import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";
import { businessDateKey, businessDayRange, isDateKey } from "../../app/lib/simple-view";

const BUSINESS = "operator-a";
type Slot = { id: string; business_id: string; tour_id: string; start_time: string; status: string; booked: number; held: number };
const slot = (id: string, start_time: string, changes: Partial<Slot> = {}): Slot => ({ id, start_time, business_id: BUSINESS, tour_id: "tour-a", status: "OPEN", booked: 2, held: 1, ...changes });
const dates = [
  slot("friday", "2026-10-23T08:00:00Z"), slot("saturday", "2026-10-24T08:00:00Z"), slot("sunday", "2026-10-25T08:00:00Z"),
  slot("monday", "2026-10-26T08:00:00Z"), slot("other-business", "2026-10-26T08:00:00Z", { business_id: "operator-b" }),
  slot("other-tour", "2026-10-26T08:00:00Z", { tour_id: "tour-b" }), slot("already-closed", "2026-10-26T08:00:00Z", { status: "CLOSED" }),
  slot("past", "2026-10-19T08:00:00Z"), slot("after-range", "2026-10-27T08:00:00Z"),
];

function fixture(rows = dates, options: { confirm?: boolean; failRead?: boolean; failWriteAt?: number; tour?: string; timezone?: string; start?: string; end?: string; moveBeforeConfirm?: boolean } = {}) {
  const records = structuredClone(rows), writes: Array<{ table: string; payload: object; ids: string[] }> = [];
  let reads = 0;
  const db = {
    from(table: string) {
      const filters: Array<(row: Slot) => boolean> = [];
      let payload: object | undefined, offset = 0, end = Infinity;
      const query = {
        select: () => query,
        eq: (key: keyof Slot, value: unknown) => { filters.push(row => row[key] === value); return query; },
        gte: (_key: string, value: string) => { filters.push(row => row.start_time >= value); return query; },
        lt: (_key: string, value: string) => { filters.push(row => row.start_time < value); return query; },
        order: () => query,
        range: (from: number, to: number) => { offset = from; end = to; return query; },
        in: (key: keyof Slot, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
        update: (value: object) => { payload = value; return query; },
        then(resolve: (value: unknown) => void) {
          const selected = records.filter(row => filters.every(filter => filter(row))).slice(offset, end + 1);
          if (payload) {
            if (options.failWriteAt === writes.length) return resolve({ error: new Error("Synthetic write failure") });
            writes.push({ table, payload, ids: selected.map(row => row.id) });
            selected.forEach(row => Object.assign(row, payload));
          } else { reads++; if (options.failRead) return resolve({ error: new Error("Synthetic read failure") }); }
          resolve({ data: structuredClone(selected), error: null });
        },
      };
      return query;
    },
  };
  const notify = vi.fn(), confirmAction = vi.fn(async () => {
    if (options.moveBeforeConfirm) records.find(row => row.id === "friday")!.start_time = "2026-10-24T08:00:00Z";
    return options.confirm !== false;
  }), load = vi.fn(), setShowBulkEdit = vi.fn();
  class FixedDate extends Date { static now() { return Date.parse("2026-10-20T05:00:00Z"); } }
  const close = sourceFunction("app/slots/page.tsx", "closeWeekdaySlots", {
    businessId: BUSINESS, bulkForm: { startDate: options.start || "2026-10-19", endDate: options.end || "2026-10-26", tourId: options.tour || "tour-a" },
    tours: [{ id: "tour-a", name: "Harbour paddle" }], supabase: db, getAdminTimezone: () => options.timezone || "Africa/Johannesburg",
    businessDateKey, businessDayRange, isDateKey, notify, confirmAction, load, setShowBulkEdit, setSavingBulk: vi.fn(), Date: FixedDate,
  });
  return { close, records, writes, notify, confirmAction, load, setShowBulkEdit, reads: () => reads };
}

describe("closing weekday availability", () => {
  it("closes future weekdays for the selected operator and tour, preserving weekends, bookings, holds and other records", async () => {
    const f = fixture(); await f.close();
    expect(f.writes.flatMap(write => write.ids)).toEqual(["friday", "monday"]);
    expect(f.writes.every(write => write.table === "slots" && JSON.stringify(write.payload) === '{"status":"CLOSED"}')).toBe(true);
    expect(f.records.map(({ status, ...record }) => record)).toEqual(dates.map(({ status, ...record }) => record));
    expect(f.confirmAction).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Existing bookings and holds remain") }));
    expect(f.notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Weekday slots closed" }));
  });
  it("uses operator-local weekdays and inclusive end dates across UTC midnight", async () => {
    const rows = [slot("saturday-local", "2026-10-23T22:30:00Z"), slot("monday-local", "2026-10-25T22:30:00Z"), slot("monday-late", "2026-10-26T21:59:59Z"), slot("tuesday-local", "2026-10-26T22:00:00Z")];
    const f = fixture(rows); await f.close();
    expect(f.writes.flatMap(write => write.ids)).toEqual(["monday-local", "monday-late"]);
  });
  it("reads every page before updating and closes more than 500 slots in bounded batches", async () => {
    const f = fixture(Array.from({ length: 1001 }, (_, i) => slot(String(i), "2026-10-23T08:00:00Z")));
    await f.close(); expect(f.reads()).toBe(3);
    expect(f.writes.flatMap(write => write.ids)).toHaveLength(1001);
    expect(f.writes.every(write => write.ids.length <= 50)).toBe(true);
  });
  it("supports all tours without crossing business boundaries", async () => {
    const f = fixture(dates, { tour: "ALL" }); await f.close();
    expect(f.writes.flatMap(write => write.ids)).toEqual(["friday", "monday", "other-tour"]);
  });
  it("makes no changes when the operator cancels the preview", async () => {
    const f = fixture(dates, { confirm: false }); await f.close(); expect(f.writes).toEqual([]);
  });
  it("does not close a slot moved to a weekend while the confirmation is open", async () => {
    const f = fixture(dates, { moveBeforeConfirm: true }); await f.close();
    expect(f.records.find(row => row.id === "friday")?.status).toBe("OPEN");
    expect(f.writes.flatMap(write => write.ids)).toEqual(["monday"]);
    expect(f.notify).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "error", message: expect.stringContaining("1 slots closed") }));
  });
  it("does not report success after a partial write failure", async () => {
    const f = fixture(Array.from({ length: 51 }, (_, i) => slot(String(i), "2026-10-23T08:00:00Z")), { failWriteAt: 1 });
    await f.close(); expect(f.writes.flatMap(write => write.ids)).toHaveLength(50);
    expect(f.notify).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "error", message: expect.stringContaining("50 slots closed") }));
    expect(f.setShowBulkEdit).not.toHaveBeenCalled();
  });
  it("does not write after a failed lookup or an invalid date range", async () => {
    for (const options of [{ failRead: true }, { start: "2026-10-27", end: "2026-10-26" }, { start: "2026-02-30" }]) {
      const f = fixture(dates, options); await f.close(); expect(f.writes).toEqual([]); expect(f.confirmAction).not.toHaveBeenCalled();
    }
  });
  it("reports an empty selection without requesting confirmation or updating slots", async () => {
    const f = fixture(dates.filter(row => ["saturday", "sunday"].includes(row.id))); await f.close();
    expect(f.writes).toEqual([]); expect(f.confirmAction).not.toHaveBeenCalled();
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "No open weekday slots" }));
  });
});
