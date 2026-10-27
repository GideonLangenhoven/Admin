import type { SupabaseClient } from "@supabase/supabase-js";
import { operatorDashboardRange } from "./operator-day";

export const RECOVERY_PAGE_SIZE = 10;
export type RecoveryDay = "today" | "tomorrow" | "all";

export async function loadPaymentRecovery(client: SupabaseClient, input: { businessId: string; timezone: string; day: RecoveryDay; page: number; dashboard: boolean; instant?: Date }) {
  const fields = "id, customer_name, email, phone, status, total_amount, total_captured, amount_due, payment_url, payment_status, created_at, payment_failed_at, payment_failure_reason, payment_recovery_emailed_at, slot_id, departure_at, tour_name, departure_passed";
  // List and exact counts share the established invoker view and eligibility.
  const eligible = (head = false) => client.from("payment_recovery_bookings")
    .select(fields, input.dashboard ? { count: "exact", head } : undefined)
    .eq("business_id", input.businessId)
    .not("status", "in", "(PAID,COMPLETED,CANCELLED,EXPIRED)")
    .or("payment_status.is.null,payment_status.neq.CAPTURED")
    .gt("amount_due", 0);
  const range = operatorDashboardRange(input.timezone, input.instant);
  const forDay = (day: "today" | "tomorrow", head = false) => eligible(head)
    .gte("departure_at", day === "today" ? range.p_today_start : range.p_tomorrow_start)
    .lt("departure_at", day === "today" ? range.p_tomorrow_start : range.p_day_after);
  const query = input.dashboard && input.day !== "all" ? forDay(input.day) : eligible();
  const [result, today, tomorrow] = await Promise.all([
    query.order("departure_passed", { ascending: true, nullsFirst: false })
      .order("departure_at", { ascending: true, nullsFirst: false }).order("slot_id").order("id")
      .range(input.page * RECOVERY_PAGE_SIZE, (input.page + 1) * RECOVERY_PAGE_SIZE),
    input.dashboard ? forDay("today", true) : null,
    input.dashboard ? forDay("tomorrow", true) : null,
  ]);
  return { result, today, tomorrow };
}
