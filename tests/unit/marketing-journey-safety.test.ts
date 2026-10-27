import { describe, expect, it, vi } from "vitest";
import { marketingCalendarDate } from "../../supabase/functions/_shared/marketing-calendar";
import { marketingDeliveryOutcome, reserveMarketingDelivery, finishMarketingDelivery } from "../../supabase/functions/_shared/marketing-delivery";
import { journeyContract, simulateMarketingGoal, syntheticMarketingContacts } from "../../app/lib/marketing-journey";

describe("marketing safety and truthful simulation", () => {
 it("keeps unknown and suppressed people out and stops booked prospects", () => {
   const result=simulateMarketingGoal("welcome",syntheticMarketingContacts);
   expect(result.map(r=>r.reason)).toEqual(["eligible","permission_unknown","suppressed","already_booked"]);
   expect(simulateMarketingGoal("reviews",[])).toEqual([]);
   expect(simulateMarketingGoal("vouchers",syntheticMarketingContacts).filter(p=>p.reason==="eligible")).toEqual([]);
 });
 it("does not equate an email open with review completion", () => {
   const contract=journeyContract({trigger_type:"tag_added",trigger_config:{tag:"completed-tour"}},[{step_type:"condition",config:{condition_type:"opened_email"}}],"Africa/Johannesburg");
   expect(contract.goal).toBe("Completed reviews cannot be tracked.");
   expect(contract.steps[0]).toContain("any recorded email open");
 });
 it("handles local calendar day/year and DST boundaries", () => {
   expect(marketingCalendarDate(new Date("2026-12-31T22:30:00Z"),"Africa/Johannesburg")).toEqual({year:2027,month:1,day:1});
   expect(marketingCalendarDate(new Date("2026-03-08T06:30:00Z"),"America/New_York",1)).toEqual({year:2026,month:3,day:9});
   expect(marketingCalendarDate(new Date("2026-11-01T05:30:00Z"),"America/New_York")).toEqual(marketingCalendarDate(new Date("2026-11-01T06:30:00Z"),"America/New_York"));
   expect(()=>marketingCalendarDate(new Date(),"Unknown/Zone")).toThrow();
 });
 it("requires reconciliation for ambiguous success, network failure and server errors", () => {
   expect(marketingDeliveryOutcome(true,200,"fixture-provider-id")).toBe("sent");
   for(const [ok,status] of [[true,200],[false,0],[false,500],[false,409]] as const) expect(marketingDeliveryOutcome(ok,status)).toBe("reconcile");
   expect(marketingDeliveryOutcome(false,429)).toBe("failed");
 });
 it("fails closed when reservation storage fails and passes tenant identity explicitly", async () => {
   const rpc=vi.fn().mockResolvedValue({error:{message:"offline"}});
   await expect(reserveMarketingDelivery({rpc},{businessId:"tenant",contactId:"person",key:"queue/1",queueId:"1",payload:{}})).rejects.toThrow("unavailable");
   expect(rpc.mock.calls[0][1]).toMatchObject({p_business_id:"tenant",p_contact_id:"person",p_queue_id:"1",p_enrollment_id:null});
 });
 it("does not pretend a provider outcome was saved when the write fails", async () => {
   const chain:any={update:()=>chain,eq:()=>chain,then:(resolve:any)=>resolve({error:{message:"offline"}})};
   await expect(finishMarketingDelivery({from:()=>chain},"tenant","delivery","sent","provider")).rejects.toThrow("reconciliation");
 });
});
