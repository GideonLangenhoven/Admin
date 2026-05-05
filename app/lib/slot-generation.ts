import { supabase } from "./supabase";

export type GenSpec = {
  tour_id: string;
  business_id: string;
  start_date: string;
  end_date: string;
  times: string[];
  days_of_week: number[];
  capacity: number;
};

export type GenResult = {
  tour_id: string;
  slots_created: number;
  slots_skipped: number;
  errors: Array<{ message: string }>;
};

export async function generateSlotsForTour(spec: GenSpec): Promise<GenResult> {
  const start = new Date(spec.start_date + "T00:00:00");
  const end = new Date(spec.end_date + "T00:00:00");
  const rows: any[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (!spec.days_of_week.includes(d.getDay())) continue;
    const localDateStr = d.toISOString().split("T")[0];

    for (const t of spec.times) {
      const localDateTime = localDateStr + "T" + t + ":00";
      const localDate = new Date(localDateTime);
      localDate.setHours(localDate.getHours() - 2);

      rows.push({
        business_id: spec.business_id,
        tour_id: spec.tour_id,
        start_time: localDate.toISOString(),
        capacity_total: spec.capacity,
        booked: 0,
        held: 0,
        status: "OPEN",
      });
    }
  }

  if (rows.length === 0) {
    return { tour_id: spec.tour_id, slots_created: 0, slots_skipped: 0, errors: [] };
  }

  const { data, error } = await supabase.from("slots")
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
