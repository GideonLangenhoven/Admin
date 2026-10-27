"use client";

import { supabase } from "@/app/lib/supabase";
import { listAvailableSlots } from "@/app/lib/slot-availability";
import { businessDayRange } from "@/app/lib/simple-view";
import { fetchAllRows } from "@/supabase/functions/_shared/pagination";
import { amountOutstanding, type MoneyBooking } from "@/app/lib/report-accounting";

export type SimpleBooking = MoneyBooking & {
  id: string;
  slot_id: string;
  customer_name: string;
  email: string;
  phone: string;
  qty: number;
  status: string;
  waiver_status: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
  arrived_count: number;
  unpaid_arrival_approved?: boolean;
};

export type SimpleDeparture = {
  id: string;
  tour_id: string;
  tour_name: string;
  start_time: string;
  status: string;
  capacity_total: number;
  available_capacity: number | null;
  can_book: boolean;
  bookings: SimpleBooking[];
  booked_guests: number;
  settled_guests: number;
  arrived_guests: number;
};

export type SimpleDay = {
  date: string;
  currency: string;
  departures: SimpleDeparture[];
  unbooked_departures: SimpleDeparture[];
};

const SETTLED_STATUSES = new Set(["PAID", "CONFIRMED", "COMPLETED"]);

export async function loadSimpleDay(params: { businessId: string; date: string; timeZone: string; guide?: boolean }): Promise<SimpleDay> {
  if (params.guide) {
    const { data, error } = await supabase.rpc("guide_simple_day", { p_date: params.date });
    if (error) throw error;
    if (!data || !Array.isArray(data.departures)) throw new Error("Guide manifest unavailable");
    return data as SimpleDay;
  }
  const { startIso, endIso } = businessDayRange(params.date, params.timeZone);
  const [slotResult, availableSlots, businessResult] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("slots")
      .select("id, tour_id, start_time, capacity_total, booked, held, status, tours(name)")
      .eq("business_id", params.businessId)
      .gte("start_time", startIso)
      .lt("start_time", endIso)
      .order("start_time", { ascending: true }).order("id").range(from, to)),
    listAvailableSlots({ businessId: params.businessId, startIso, endIso }),
    supabase.from("businesses").select("currency").eq("id", params.businessId).maybeSingle(),
  ]);

  if (businessResult.error) throw businessResult.error;
  if (!businessResult.data?.currency) throw new Error("Business currency unavailable");

  const rawSlots = slotResult as Array<{id:string;tour_id:string;start_time:string;status:string;capacity_total:number;tours:{name:string}|Array<{name:string}>}>;
  const slotIds = rawSlots.map(slot => slot.id);
  const { data: manifest, error: manifestError } = await supabase.rpc("operator_departure_manifest", {
    p_business_id: params.businessId, p_range_start: startIso, p_range_end: endIso,
  });
  if (manifestError) throw manifestError;
  if (!Array.isArray(manifest)) throw new Error("Departure manifest unavailable");
  const bookings = (manifest as SimpleBooking[]).filter(booking => slotIds.includes(booking.slot_id));

  const bySlot = new Map<string, SimpleBooking[]>();
  for (const booking of bookings) {
    const list = bySlot.get(booking.slot_id) || [];
    list.push(booking);
    bySlot.set(booking.slot_id, list);
  }

  const availableById = new Map(availableSlots.map(slot => [slot.id, slot]));
  const now = Date.now();
  const departures = rawSlots.map((slot): SimpleDeparture => {
    const slotBookings = bySlot.get(slot.id) || [];
    const available = availableById.get(slot.id);
    const tour = Array.isArray(slot.tours) ? slot.tours[0] : slot.tours;
    const isFuture = new Date(slot.start_time).getTime() > now;
    const canonicalAvailable = available ? Math.max(0, Number(available.available_capacity || 0)) : null;
    return {
      id: slot.id,
      tour_id: slot.tour_id,
      tour_name: tour?.name || available?.tour_name || "Tour",
      start_time: slot.start_time,
      status: slot.status || "OPEN",
      capacity_total: Number(slot.capacity_total || 0),
      available_capacity: canonicalAvailable,
      can_book: slot.status === "OPEN" && isFuture && canonicalAvailable !== null && canonicalAvailable > 0,
      bookings: slotBookings,
      booked_guests: slotBookings.reduce((sum, booking) => sum + booking.qty, 0),
      settled_guests: slotBookings.filter(booking => SETTLED_STATUSES.has(booking.status) && amountOutstanding(booking) <= 0.005).reduce((sum, booking) => sum + booking.qty, 0),
      arrived_guests: slotBookings.reduce((sum, booking) => sum + booking.arrived_count, 0),
    };
  });

  return {
    date: params.date,
    currency: businessResult.data?.currency || "ZAR",
    departures: departures.filter(departure => departure.bookings.length > 0),
    unbooked_departures: departures.filter(departure => departure.bookings.length === 0 && departure.can_book),
  };
}
