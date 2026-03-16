import { supabase } from "./supabase";

export interface UsageSnapshot {
  plan_id: string;
  seat_limit: number;
  monthly_paid_booking_limit: number | null;
  uncapped_flag: boolean;
  paid_bookings_count: number;
  topup_quota_count: number;
  total_quota: number | null;
  remaining: number | null;
}

export interface PlanRow {
  id: string;
  name: string;
  monthly_price_zar: number;
  setup_fee_zar: number;
  seat_limit: number;
  monthly_paid_booking_limit: number | null;
  uncapped_flag: boolean;
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

export async function fetchUsageSnapshot(businessId: string): Promise<UsageSnapshot | null> {
  if (!businessId) return null;
  const { data, error } = await supabase.rpc("ck_usage_snapshot", { p_business_id: businessId });
  if (error) return null;
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0] as UsageSnapshot;
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
    .select("id, name, monthly_price_zar, setup_fee_zar, seat_limit, monthly_paid_booking_limit, uncapped_flag")
    .eq("active", true)
    .order("monthly_price_zar", { ascending: true });
  if (error) throw error;
  return (data || []) as PlanRow[];
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
