import { supabase } from "./supabase";

export interface UsageSnapshot {
  seat_limit: number;
  admin_count: number;
  remaining_admin_seats: number;
}

export async function fetchUsageSnapshot(businessId: string): Promise<UsageSnapshot | null> {
  if (!businessId) return null;

  const [bizRes, adminCountRes] = await Promise.all([
    supabase
      .from("businesses")
      .select("max_admin_seats")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("admin_users")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId),
  ]);

  if (adminCountRes.error) throw adminCountRes.error;

  const seatLimit = Number(bizRes.data?.max_admin_seats || 3);
  const adminCount = Number(adminCountRes.count || 0);

  return {
    seat_limit: seatLimit,
    admin_count: adminCount,
    remaining_admin_seats: Math.max(0, seatLimit - adminCount),
  };
}

export function formatZar(amount: number) {
  return "R" + amount.toLocaleString("en-ZA");
}
