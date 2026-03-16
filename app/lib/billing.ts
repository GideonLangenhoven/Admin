import { supabase } from "./supabase";

export interface UsageSnapshot {
  plan_id: string;
  seat_limit: number;
  admin_count: number;
  remaining_admin_seats: number;
}

export interface PlanRow {
  id: string;
  name: string;
  monthly_price_zar: number;
  setup_fee_zar: number;
  seat_limit: number;
}

export interface SubscriptionRow {
  id: string;
  business_id: string;
  plan_id: string;
  status: "ACTIVE" | "INACTIVE" | "CANCELLED";
  period_start: string;
  period_end: string | null;
  created_at: string;
}

export async function fetchActiveSubscription(businessId: string): Promise<SubscriptionRow | null> {
  if (!businessId) return null;
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, business_id, plan_id, status, period_start, period_end, created_at")
    .eq("business_id", businessId)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as SubscriptionRow | null;
}

export async function fetchPlans(): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, monthly_price_zar, setup_fee_zar, seat_limit")
    .eq("active", true)
    .order("monthly_price_zar", { ascending: true });
  if (error) throw error;
  return (data || []) as PlanRow[];
}

export async function fetchUsageSnapshot(businessId: string): Promise<UsageSnapshot | null> {
  if (!businessId) return null;

  const [subscription, adminCountRes] = await Promise.all([
    fetchActiveSubscription(businessId),
    supabase
      .from("admin_users")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId),
  ]);

  if (adminCountRes.error) {
    throw adminCountRes.error;
  }

  var seatLimit = 1;
  if (subscription?.plan_id) {
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, seat_limit")
      .eq("id", subscription.plan_id)
      .maybeSingle();
    if (planError) throw planError;
    seatLimit = Number(plan?.seat_limit || seatLimit);
  }

  const adminCount = Number(adminCountRes.count || 0);
  return {
    plan_id: subscription?.plan_id || "",
    seat_limit: seatLimit,
    admin_count: adminCount,
    remaining_admin_seats: Math.max(0, seatLimit - adminCount),
  };
}

export function formatZar(amount: number) {
  return "R" + amount.toLocaleString("en-ZA");
}

export function currentPeriodKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}
