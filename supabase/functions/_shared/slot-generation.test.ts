// deno test _shared/slot-generation.test.ts
// Slot times are the one thing a tour operator cannot tolerate being wrong, and
// the browser version of this logic silently shifts them by a day when the
// operator's machine is not on UTC. These cases lock the zone maths down.
import { buildSlotRows, wallTimeToUtc } from "./slot-generation.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

Deno.test("SAST wall time maps to the right UTC instant", () => {
  const utc = wallTimeToUtc("2026-08-15", "09:00", "Africa/Johannesburg");
  assert(
    utc.toISOString() === "2026-08-15T07:00:00.000Z",
    "expected 2026-08-15T07:00:00.000Z, got " + utc.toISOString(),
  );
});

Deno.test("midnight does not roll to the previous day", () => {
  // The browser version's toISOString() date-shift bit exactly here.
  const utc = wallTimeToUtc("2026-08-15", "00:00", "Africa/Johannesburg");
  assert(
    utc.toISOString() === "2026-08-14T22:00:00.000Z",
    "expected 2026-08-14T22:00:00.000Z, got " + utc.toISOString(),
  );
});

Deno.test("DST zone resolves both sides of the boundary", () => {
  // London: BST (+1) in July, GMT (+0) in December.
  const summer = wallTimeToUtc("2026-07-15", "09:00", "Europe/London");
  const winter = wallTimeToUtc("2026-12-15", "09:00", "Europe/London");
  assert(summer.toISOString() === "2026-07-15T08:00:00.000Z", "BST: got " + summer.toISOString());
  assert(winter.toISOString() === "2026-12-15T09:00:00.000Z", "GMT: got " + winter.toISOString());
});

Deno.test("UTC tenant is unshifted", () => {
  const utc = wallTimeToUtc("2026-08-15", "09:00", "UTC");
  assert(utc.toISOString() === "2026-08-15T09:00:00.000Z", "got " + utc.toISOString());
});

Deno.test("only the requested weekdays are generated", () => {
  // 2026-08-15 is a Saturday; the window covers Sat 15th through Fri 21st.
  const rows = buildSlotRows({
    business_id: "b1",
    tour_id: "t1",
    capacity: 10,
    timezone: "Africa/Johannesburg",
    ranges: [{
      start_date: "2026-08-15",
      end_date: "2026-08-21",
      times: ["09:00"],
      days_of_week: [6], // Saturday only
    }],
  });
  assert(rows.length === 1, "expected 1 Saturday, got " + rows.length);
  assert(rows[0].start_time === "2026-08-15T07:00:00.000Z", "got " + rows[0].start_time);
});

Deno.test("overlapping ranges do not produce duplicate start times", () => {
  const rows = buildSlotRows({
    business_id: "b1",
    tour_id: "t1",
    capacity: 10,
    timezone: "Africa/Johannesburg",
    ranges: [
      { start_date: "2026-08-15", end_date: "2026-08-16", times: ["09:00"], days_of_week: [0, 6] },
      { start_date: "2026-08-15", end_date: "2026-08-16", times: ["09:00"], days_of_week: [0, 6] },
    ],
  });
  const unique = new Set(rows.map((r) => r.start_time));
  assert(rows.length === unique.size, "duplicates emitted: " + rows.length + " rows, " + unique.size + " unique");
  assert(rows.length === 2, "expected Sat+Sun = 2 rows, got " + rows.length);
});

Deno.test("row shape matches the slots table contract", () => {
  const [row] = buildSlotRows({
    business_id: "b1",
    tour_id: "t1",
    capacity: 8,
    timezone: "Africa/Johannesburg",
    ranges: [{ start_date: "2026-08-15", end_date: "2026-08-15", times: ["09:00"], days_of_week: [6] }],
  });
  assert(row.business_id === "b1" && row.tour_id === "t1", "ids");
  assert(row.capacity_total === 8 && row.booked === 0 && row.held === 0, "capacity/counters");
  assert(row.status === "OPEN", "status");
});

Deno.test("empty times or weekdays generate nothing", () => {
  const none = buildSlotRows({
    business_id: "b1", tour_id: "t1", capacity: 10, timezone: "UTC",
    ranges: [
      { start_date: "2026-08-15", end_date: "2026-08-20", times: [], days_of_week: [1] },
      { start_date: "2026-08-15", end_date: "2026-08-20", times: ["09:00"], days_of_week: [] },
    ],
  });
  assert(none.length === 0, "expected 0 rows, got " + none.length);
});
