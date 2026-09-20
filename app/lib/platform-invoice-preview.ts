import { SupabaseClient } from "@supabase/supabase-js";
import { AI_QUOTA_FNS, computeActiveDays, computeAiOverage, computeEmailOverage, monthBounds, type PauseEvent } from "./platform-billing";

export type SeatEvent = { created_at: string; after_state: { delta?: number } | null };
// Reverse later changes from today's count to recover each billed day's seats.
// Seat adjustments are represented here, never added again from the ledger.
export function seatPriceForDay(day: string, currentSeats: number, events: SeatEvent[], included: number, price: number) {
  const laterDelta = events.filter(e => e.created_at.slice(0,10) > day).reduce((n,e) => n + Number(e.after_state?.delta || 0),0);
  return Math.max(0,currentSeats-laterDelta-included)*price;
}

export async function platformInvoicePreview(db: SupabaseClient, businessId: string, period: string) {
  const { periodStart, periodEnd } = monthBounds(period);
  const [year, month] = period.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString();
  const today = new Date().toISOString().slice(0,10);
  const [subResult,bizResult,usageResult,aiResult] = await Promise.all([
    db.from("subscriptions").select("plan_id,status,period_start,period_end").eq("business_id",businessId).maybeSingle(),
    db.from("businesses").select("max_admin_seats,marketing_included_emails,marketing_overage_rate_zar,ai_included_replies,ai_overage_rate_zar").eq("id",businessId).single(),
    db.from("marketing_usage_monthly").select("emails_sent").eq("business_id",businessId).eq("period",period).maybeSingle(),
    db.from("llm_usage").select("id",{count:"exact",head:true}).eq("business_id",businessId).in("fn",AI_QUOTA_FNS).gte("created_at",periodStart).lt("created_at",nextMonth),
  ]);
  for (const result of [subResult,bizResult,usageResult,aiResult]) if(result.error) throw new Error(result.error.message);
  const sub = subResult.data, biz = bizResult.data!;
  if(!sub) return null;
  const planResult = await db.from("plans").select("name,monthly_price_zar,seat_limit,extra_seat_price_zar").eq("id",sub.plan_id).single();
  if(planResult.error) throw new Error(planResult.error.message);
  const plan=planResult.data;
  const events: Array<PauseEvent & SeatEvent> = [];
  for(let from=0;;from+=1000) {
    const result=await db.from("audit_logs").select("action_type,created_at,after_state").eq("business_id",businessId)
      .in("action_type",["BILLING_PAUSED","BILLING_RESUMED","BILLING_SEATS_ADDED","BILLING_SEATS_REMOVED"]).order("created_at").order("id").range(from,from+999);
    if(result.error) throw new Error(result.error.message);
    events.push(...(result.data as typeof events));
    if(result.data.length<1000) break;
  }
  const pauses=events.filter(e=>e.action_type==="BILLING_PAUSED"||e.action_type==="BILLING_RESUMED");
  const seatEvents=events.filter(e=>e.after_state?.delta !== undefined);
  const active=computeActiveDays(periodStart,periodEnd,sub.period_start,sub.period_end,pauses,sub.status,today);
  let seatTotal=0;
  for(let day=1;day<=active.totalDays;day++) {
    const date=period+"-"+String(day).padStart(2,"0");
    const billable=computeActiveDays(date,date,sub.period_start,sub.period_end,pauses,sub.status,today).activeDays;
    seatTotal+=billable*seatPriceForDay(date,Number(biz.max_admin_seats??1),seatEvents,Number(plan.seat_limit??1),Number(plan.extra_seat_price_zar??0))/active.totalDays;
  }
  const subscriptionZar=Math.round((Number(plan.monthly_price_zar)*active.activeDays/active.totalDays+seatTotal)*100)/100;
  const email=computeEmailOverage(Number(usageResult.data?.emails_sent??0),Number(biz.marketing_included_emails??0),Number(biz.marketing_overage_rate_zar??0));
  const ai=computeAiOverage(Number(aiResult.count??0),Number(biz.ai_included_replies??0),Number(biz.ai_overage_rate_zar??0));
  const nominal=Number(plan.monthly_price_zar)+Math.max(0,Number(biz.max_admin_seats??1)-Number(plan.seat_limit??1))*Number(plan.extra_seat_price_zar??0);
  return {
    business_id:businessId,period_start:periodStart,period_end:periodEnd,plan_id:sub.plan_id,plan_name:plan.name,
    monthly_price_zar:nominal,active_days:active.activeDays,total_days:active.totalDays,
    pro_rated:active.activeDays!==active.totalDays || Math.abs(subscriptionZar-nominal)>0.01,
    pause_note:active.pauseWindows.length ? "Paused "+active.pauseWindows.map(w=>w.start+" to "+w.end).join(", ") : seatEvents.some(e=>e.created_at.startsWith(period)) ? "Seat changes prorated by day" : null,
    email_overage_count:email.overageEmails,email_overage_zar:email.overageZar,
    ai_overage_count:ai.overageReplies,ai_overage_zar:ai.overageZar,
    amount_zar:Math.round((subscriptionZar+email.overageZar+ai.overageZar)*100)/100,
  };
}
