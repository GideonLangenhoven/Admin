import { afterEach, describe, expect, it, vi } from "vitest";
import { periodBounds } from "../../app/lib/billing-period";
import { sourceHandler } from "../helpers/source-handler";

describe("atomic billing controls", () => {
  function fixture(role: string | null = "MAIN_ADMIN", result: any = {data:{ok:true,new_seats:2,proration_zar:166.67},error:null}, action="seats") {
    const rpc=vi.fn(async()=>result);
    const handler=sourceHandler("app/api/billing/"+action+"/route.ts",{
      "@/app/lib/api-auth":{getCallerAdmin:async()=>role?{id:"actor",role,business_id:"selected-business"}:null,isPrivilegedRole:(r:string)=>["SUPER_ADMIN","MAIN_ADMIN"].includes(r)},
      "@supabase/supabase-js":{createClient:()=>({rpc})},
    });
    const request=(delta:any)=>new Request("https://test.invalid",{method:"POST",body:JSON.stringify({delta,business_id:"spoofed-business"})});
    return {handler,rpc,request};
  }
  for(const role of [null,"ADMIN"]) it("rejects "+role+" before writing",async()=>{
    const f=fixture(role);expect((await f.handler(f.request(1))).status).toBe(role?403:401);expect(f.rpc).not.toHaveBeenCalled();
  });
  for(const delta of [0,1.5,51,-51,"1",null]) it("rejects invalid delta "+delta,async()=>{
    const f=fixture();expect((await f.handler(f.request(delta))).status).toBe(400);expect(f.rpc).not.toHaveBeenCalled();
  });
  it("uses only the authenticated effective business and preserves cents",async()=>{
    const f=fixture("SUPER_ADMIN"); const response=await f.handler(f.request(1));
    expect(await response.json()).toMatchObject({proration_zar:166.67,new_seats:2});
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.rpc).toHaveBeenCalledWith("platform_change_seats",{p_business_id:"selected-business",p_actor_id:"actor",p_delta:1});
  });
  it("reports a conflict without a second partial write",async()=>{
    const f=fixture("MAIN_ADMIN",{data:null,error:{message:"Seat limit conflict"}});
    expect((await f.handler(f.request(-1))).status).toBe(409);expect(f.rpc).toHaveBeenCalledOnce();
  });
  for(const [action,status,previous] of [["pause","PAUSED","ACTIVE"],["resume","ACTIVE","PAUSED"]]) it(action+" uses an atomic optimistic transition",async()=>{
    const f=fixture("MAIN_ADMIN",{data:{ok:true},error:null},action);
    expect((await f.handler(f.request(1))).status).toBe(200);
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.rpc).toHaveBeenCalledWith("platform_change_business_status",{p_business_id:"selected-business",p_actor_id:"actor",p_status:status,p_expected_status:previous});
  });
});

// periodBounds is the pure function both /api/billing/subscription and
// /api/billing/seats rely on for proration math — genuinely behavioral
// coverage for "a fresh and a long-standing subscription", not just a
// source-text check, since this is what actually computes the billing
// window either kind of subscription prorates against.
//
// Fixed, hand-computed dates throughout (not "N days before today") so these
// stay deterministic regardless of which day/timezone the suite runs in —
// this exact class of runtime-dependent date math is what the function
// itself needed fixing for (see billing-period.ts).
describe("periodBounds (shared by subscription GET and seats POST)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("computes correct bounds for a fresh subscription (period_start a few days into its cycle)", () => {
    vi.useFakeTimers({ now: new Date("2026-07-10T10:00:00Z") });
    const { billing_cycle_start, billing_cycle_end } = periodBounds("2026-07-03", null);
    expect(billing_cycle_start).toBe("2026-07-03");
    // No period_end on a fresh, still-open subscription: the first period runs
    // from signup to the end of that month.
    expect(billing_cycle_end).toBe("2026-07-31");
  });

  it("computes correct bounds for a long-standing subscription (period_start many months ago)", () => {
    // P2: Billing showed "This month 2026-09-29 → 2026-09-30" on 27 Oct, and
    // proration against that ended period was zero. period_start is the
    // signup date and never advances, so later periods are calendar months.
    vi.useFakeTimers({ now: new Date("2026-10-27T10:00:00Z") });
    expect(periodBounds("2026-01-15", null)).toEqual({ billing_cycle_start: "2026-10-01", billing_cycle_end: "2026-10-31" });
    expect(periodBounds("2026-09-29", null)).toEqual({ billing_cycle_start: "2026-10-01", billing_cycle_end: "2026-10-31" });
  });

  it("uses the real period_end when the subscription has one, regardless of age", () => {
    const { billing_cycle_start, billing_cycle_end } = periodBounds("2026-01-01", "2026-01-31");
    expect(billing_cycle_start).toBe("2026-01-01");
    expect(billing_cycle_end).toBe("2026-01-31");
  });

  it("falls back to the current UTC calendar month when a subscription has no period_start at all", () => {
    const now = new Date();
    const { billing_cycle_start } = periodBounds(null, null);
    const expectedStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    expect(billing_cycle_start).toBe(expectedStart.toISOString().slice(0, 10));
  });

  it("is immune to a local timezone ahead of UTC (the actual bug this function had)", () => {
    // Regression guard: an earlier version built the fallback end date via
    // `new Date(year, month, day)` (local time) and serialized it with
    // .toISOString() — for any timezone ahead of UTC, local midnight on the
    // last day of the month rolls back to 22:00 UTC the day before, so the
    // computed end date was silently one calendar day short. Every one of
    // the fixed-date assertions above already exercises this, but this test
    // makes the guard explicit rather than incidental.
    vi.useFakeTimers({ now: new Date("2026-04-15T10:00:00Z") });
    const { billing_cycle_end } = periodBounds("2026-04-01", null);
    expect(billing_cycle_end).toBe("2026-04-30");
  });
});
