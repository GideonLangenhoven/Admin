"use client";

import { supabase } from "@/app/lib/supabase";
import { listAvailableSlots } from "@/app/lib/slot-availability";
import { businessDayRange } from "@/app/lib/simple-view";
import { fetchAllRows } from "@/supabase/functions/_shared/pagination";
import type { MoneyBooking } from "@/app/lib/report-accounting";

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
};

const VISIBLE_STATUSES = ["PENDING", "PENDING PAYMENT", "HELD", "PAID", "CONFIRMED", "COMPLETED"];
const SETTLED_STATUSES = new Set(["PAID", "CONFIRMED", "COMPLETED"]);

export async function loadSimpleDay(params: { businessId: string; date: string; timeZone: string }): Promise<SimpleDay> {
  const { startIso, endIso } = businessDayRange(params.date, params.timeZone);
  const [slotResult, availableSlots, businessResult] = await Promise.all([
    supabase.from("slots")
      .select("id, tour_id, start_time, capacity_total, booked, held, status, tours(name)")
      .eq("business_id", params.businessId)
      .gte("start_time", startIso)
      .lt("start_time", endIso)
      .order("start_time", { ascending: true }),
    listAvailableSlots({ businessId: params.businessId, startIso, endIso }),
    supabase.from("businesses").select("currency").eq("id", params.businessId).maybeSingle(),
  ]);

  if (slotResult.error) throw slotResult.error;
  if (businessResult.error) throw businessResult.error;

  const rawSlots = slotResult.data || [];
  const slotIds = rawSlots.map(slot => slot.id);
  const bookings: SimpleBooking[] = [];

  for (let offset = 0; offset < slotIds.length; offset += 150) {
    const ids = slotIds.slice(offset, offset + 150);
    const rows = await fetchAllRows((from, to) => supabase.from("bookings")
      .select("id, slot_id, customer_name, email, phone, qty, status, waiver_status, checked_in, checked_in_at, arrived_count, total_amount, original_total, total_captured, total_refunded, refund_amount, refund_processed_at, voucher_amount_paid, voucher_code, payment_method, yoco_payment_id, payfast_m_payment_id, ota_channel, allow_unpaid")
      .eq("business_id", params.businessId)
      .in("slot_id", ids)
      .in("status", VISIBLE_STATUSES)
      .order("created_at", { ascending: true })
      .order("id")
      .range(from, to));
    for (const row of rows as Array<Record<string, unknown>>) {
      const qty = Math.max(0, Number(row.qty || 0));
      const arrived = Math.min(qty, Math.max(0, Number(row.arrived_count ?? (row.checked_in ? qty : 0))));
      bookings.push({ ...row, qty, arrived_count: arrived } as SimpleBooking);
    }
  }

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
      settled_guests: slotBookings.filter(booking => SETTLED_STATUSES.has(booking.status)).reduce((sum, booking) => sum + booking.qty, 0),
      arrived_guests: slotBookings.reduce((sum, booking) => sum + booking.arrived_count, 0),
    };
  });

  return {
    date: params.date,
    currency: businessResult.data?.currency || "ZAR",
    departures,
  };
}
