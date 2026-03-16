import { supabase } from "./supabase";

export interface AvailableSlotRecord {
  id: string;
  start_time: string;
  capacity_total: number;
  booked: number;
  held: number;
  status: string;
  tour_id: string;
  price_per_person_override: number | null;
  tour_name: string | null;
  base_price_per_person: number | null;
  available_capacity: number;
}

export async function listAvailableSlots(params: {
  businessId: string;
  startIso: string;
  endIso: string;
  tourId?: string | null;
}) {
  const { data, error } = await supabase.rpc("list_available_slots", {
    p_business_id: params.businessId,
    p_range_start: params.startIso,
    p_range_end: params.endIso,
    p_tour_id: params.tourId || null,
  });

  if (error) throw error;
  return (data || []) as AvailableSlotRecord[];
}

export async function fetchSlotAvailableCapacity(slotId: string) {
  const { data, error } = await supabase.rpc("slot_available_capacity", {
    p_slot_id: slotId,
  });
  if (error) throw error;
  return Number(data || 0);
}
