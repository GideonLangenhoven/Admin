// Server-side slot generation for the onboarding wizard.
//
// This is a port of app/lib/slot-generation.ts with the timezone handling
// fixed. The browser version does:
//
//   new Date(start_date + "T00:00:00")      // parsed in the BROWSER's zone
//   d.toISOString().split("T")[0]           // shifted back to UTC -> off by a day
//   localDate.setHours(getHours() - 2)      // SAST hardcoded
//
// which is only correct when the operator's machine is set to UTC. Run from a
// browser in Africa/Johannesburg, "09:00 on 2026-08-15" is stored as
// 2026-08-14T05:00:00Z — a day and two hours early. Here the tenant's own
// timezone is the input and no ambient zone is consulted, so the result is the
// same whoever runs it.

export type SlotRange = {
  start_date: string;   // "YYYY-MM-DD"
  end_date: string;     // "YYYY-MM-DD"
  times: string[];      // ["09:00", "14:00"] — wall time in the tenant's zone
  days_of_week: number[]; // 0=Sunday .. 6=Saturday
};

export type SlotSpec = {
  business_id: string;
  tour_id: string;
  capacity: number;
  timezone: string;     // IANA zone from businesses.timezone
  ranges: SlotRange[];
};

export type SlotResult = {
  tour_id: string;
  slots_created: number;
  slots_skipped: number;
  errors: Array<{ message: string }>;
};

// An anonymous caller drives this, so the row count is a trust boundary: a
// 10-year range across 24 times would otherwise be one request.
const MAX_ROWS = 5000;

// Offset of `timeZone` from UTC at a given instant, in milliseconds. Formats the
// instant in the target zone, reads the wall-clock parts back as though they
// were UTC, and takes the difference.
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  // hour12:false yields 24 for midnight on some ICU builds.
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asIfUtc - instant.getTime();
}

// "2026-08-15" + "09:00" in Africa/Johannesburg -> 2026-08-15T07:00:00Z.
export function wallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);

  const asIfUtc = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  // Subtract the zone's offset to get the real instant. The offset is evaluated
  // twice because the first guess can land on the wrong side of a DST change.
  let ts = asIfUtc - tzOffsetMs(new Date(asIfUtc), timeZone);
  ts = asIfUtc - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

// Calendar dates are zone-independent facts, so walking them in UTC is safe and
// avoids DST arithmetic entirely.
function eachDate(startDate: string, endDate: string): Array<{ date: string; dow: number }> {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  let cursor = Date.UTC(sy, (sm || 1) - 1, sd || 1);
  const end = Date.UTC(ey, (em || 1) - 1, ed || 1);

  const out: Array<{ date: string; dow: number }> = [];
  while (cursor <= end && out.length <= MAX_ROWS) {
    const d = new Date(cursor);
    out.push({ date: d.toISOString().slice(0, 10), dow: d.getUTCDay() });
    cursor += 86_400_000;
  }
  return out;
}

export function buildSlotRows(spec: SlotSpec): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];

  for (const range of spec.ranges || []) {
    if (!range?.start_date || !range?.end_date) continue;
    const times = (range.times || []).filter(Boolean);
    const dows = range.days_of_week || [];
    if (!times.length || !dows.length) continue;

    for (const { date, dow } of eachDate(range.start_date, range.end_date)) {
      if (!dows.includes(dow)) continue;
      for (const time of times) {
        const startTime = wallTimeToUtc(date, time, spec.timezone).toISOString();
        // Ranges are allowed to overlap; the upsert would dedupe them anyway,
        // but a payload with repeats inside it errors on some PostgREST paths.
        if (seen.has(startTime)) continue;
        seen.add(startTime);

        rows.push({
          business_id: spec.business_id,
          tour_id: spec.tour_id,
          start_time: startTime,
          capacity_total: spec.capacity,
          booked: 0,
          held: 0,
          status: "OPEN",
        });
        if (rows.length >= MAX_ROWS) return rows;
      }
    }
  }

  return rows;
}

export async function generateSlots(supabase: any, spec: SlotSpec): Promise<SlotResult> {
  const rows = buildSlotRows(spec);
  if (rows.length === 0) {
    return { tour_id: spec.tour_id, slots_created: 0, slots_skipped: 0, errors: [] };
  }

  const { data, error } = await supabase
    .from("slots")
    .upsert(rows, { onConflict: "business_id,tour_id,start_time", ignoreDuplicates: true })
    .select("id");

  if (error) {
    return { tour_id: spec.tour_id, slots_created: 0, slots_skipped: 0, errors: [{ message: error.message }] };
  }

  const created = (data ?? []).length;
  return {
    tour_id: spec.tour_id,
    slots_created: created,
    slots_skipped: rows.length - created,
    errors: [],
  };
}
